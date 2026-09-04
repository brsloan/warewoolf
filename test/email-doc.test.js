require('./quill-dom-setup');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const nodemailer = require('nodemailer');

const errorLog = require('../src/components/controllers/error-log');
const epubModule = require('../src/components/controllers/epub');
const newProject = require('../src/components/models/project');
const emailDocPath = require.resolve('../src/components/controllers/email-doc');
const { prepareAndEmail, emailFile } = require(emailDocPath);

//epub.js's htmlChaptersToEpub is destructured by email-doc.js at require-time, so a test that
//mocks it must re-require email-doc.js afterward for the fresh destructure to see it - same
//reasoning as battery-monitor.test.js and delta-to-docx.test.js.
function freshEmailDoc(){
  delete require.cache[emailDocPath];
  return require(emailDocPath);
}

function mockTransport(t, sendMailImpl){
  return t.mock.method(nodemailer, 'createTransport', function(){
    return { sendMail: sendMailImpl };
  });
}

function fakeEditorQuill(){
  return { getContents: function(){ return { ops: [{ insert: 'Hello world\n' }] }; } };
}

//Builds a project using the real model so getActiveChapter() behaves exactly as it does in the
//app, with the "currently open document" living in one of chapters/reference/trash.
function makeProjectWithActiveDoc(bucket, title){
  const project = newProject();
  project[bucket] = [{ title: title }];
  project.activeChapterIndex = 0;
  return project;
}

//Regression: emailing "this document" read the active document via
//project.chapters[project.activeChapterIndex] instead of project.getActiveChapter(). Since
//activeChapterIndex is a single counter spanning chapters/reference/trash (see
//render.js:displayChapterByIndex), opening a reference document and then emailing it indexed
//into the (empty) chapters array and threw "Cannot read properties of undefined (reading 'title')".
test('prepareAndEmail does not crash when the active document is a reference item, and uses its title', async function(t){
  const project = makeProjectWithActiveDoc('reference', 'Ref Title');
  let capturedMail;
  mockTransport(t, function(mailOptions, cb){
    capturedMail = mailOptions;
    cb(null, { response: '250 OK' });
  });

  const resp = await new Promise(function(resolve){
    prepareAndEmail(project, {}, fakeEditorQuill(), 'me@example.com', 'pw', 'you@example.com',
      '.txt', { compile: false }, resolve);
  });

  assert.strictEqual(resp, 'Email sent successfully.');
  assert.strictEqual(capturedMail.attachments[0].filename, 'Ref Title.txt');
});

test('prepareAndEmail does not crash when the active document is a trashed item, and uses its title', async function(t){
  const project = makeProjectWithActiveDoc('trash', 'Trashed Title');
  let capturedMail;
  mockTransport(t, function(mailOptions, cb){
    capturedMail = mailOptions;
    cb(null, { response: '250 OK' });
  });

  const resp = await new Promise(function(resolve){
    prepareAndEmail(project, {}, fakeEditorQuill(), 'me@example.com', 'pw', 'you@example.com',
      '.md', { compile: false }, resolve);
  });

  assert.strictEqual(resp, 'Email sent successfully.');
  assert.strictEqual(capturedMail.attachments[0].filename, 'Trashed Title.md');
});

test('emailing a single chapter as HTML uses the active reference document\'s title, not project.chapters[activeChapterIndex]', async function(t){
  const project = makeProjectWithActiveDoc('reference', 'Ref Title');
  let capturedMail;
  mockTransport(t, function(mailOptions, cb){
    capturedMail = mailOptions;
    cb(null, { response: '250 OK' });
  });

  const resp = await new Promise(function(resolve){
    prepareAndEmail(project, {}, fakeEditorQuill(), 'me@example.com', 'pw', 'you@example.com',
      '.html', { compile: false, generateTitlePage: false }, resolve);
  });

  assert.strictEqual(resp, 'Email sent successfully.');
  const html = capturedMail.attachments[0].content;
  assert.match(html, /<title>Ref Title<\/title>/);
});

test('emailing a single chapter as EPUB uses the active reference document\'s title and cleans up the temp file', async function(t){
  const project = makeProjectWithActiveDoc('reference', 'Ref Title');
  let capturedMail;
  mockTransport(t, function(mailOptions, cb){
    capturedMail = mailOptions;
    cb(null, { response: '250 OK' });
  });

  const resp = await new Promise(function(resolve){
    prepareAndEmail(project, {}, fakeEditorQuill(), 'me@example.com', 'pw', 'you@example.com',
      '.epub', { compile: false, generateTitlePage: false }, resolve);
  });
  //Safety net in case an assertion below throws before the temp file is ever created/cleaned up.
  t.after(function(){
    if(capturedMail && fs.existsSync(capturedMail.attachments[0].path))
      fs.unlinkSync(capturedMail.attachments[0].path);
  });

  assert.strictEqual(resp, 'Email sent successfully.');
  assert.strictEqual(capturedMail.attachments[0].filename, 'Ref Title.epub');
  assert.ok(!fs.existsSync(capturedMail.attachments[0].path), 'temp epub file should be removed after sending');
});

//Regression: htmlChaptersToEpub reports failure by calling back with the string 'error'
//(epub.js). emailAsEpub only handled the success branch, so on failure the outer callback was
//never invoked - the "Sending..." UI stayed stuck with the Send button disabled forever.
test('emailing as EPUB reports an error instead of hanging when EPUB generation fails', async function(t){
  t.mock.method(epubModule, 'htmlChaptersToEpub', function(title, author, htmlChapters, filepath, insertTitle, cb){
    cb('error');
  });
  const sendMailMock = t.mock.fn();
  mockTransport(t, sendMailMock);

  const { prepareAndEmail: prepareAndEmailFresh } = freshEmailDoc();
  const project = makeProjectWithActiveDoc('reference', 'Ref Title');

  const resp = await new Promise(function(resolve){
    prepareAndEmailFresh(project, {}, fakeEditorQuill(), 'me@example.com', 'pw', 'you@example.com',
      '.epub', { compile: false, generateTitlePage: false }, resolve);
  });

  assert.strictEqual(typeof resp, 'string');
  assert.match(resp, /error/i);
  assert.strictEqual(sendMailMock.mock.calls.length, 0, 'no email should be sent when EPUB generation failed');
});

//Regression: on failure emailFile called back with the raw Error object (callback(error)) while
//success called back with a plain string (callback('Email sent successfully.')) - an inconsistent,
//ambiguous contract for callers like the email dialog that do `responseText.innerText = resp`.
test('emailFile reports send failures as a plain string message, matching the success contract', async function(t){
  const sendError = new Error('Invalid login: 535-5.7.8 Username and Password not accepted');
  mockTransport(t, function(mailOptions, cb){
    cb(sendError, null);
  });
  //email-doc.js destructures `logError` from error-log.js at require-time, so the mock above
  //must be in place before a fresh require for the module to pick it up - see freshEmailDoc().
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  const { emailFile: emailFileFresh } = freshEmailDoc();

  const resp = await new Promise(function(resolve){
    emailFileFresh('me@example.com', 'pw', 'you@example.com', [{ filename: 'a.txt', content: 'x' }], resolve);
  });

  assert.strictEqual(typeof resp, 'string');
  assert.match(resp, /Invalid login/);
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
  assert.strictEqual(logErrorMock.mock.calls[0].arguments[0], sendError);
});

test('emailing the whole project as a zip reports archiveProject failures as a plain string message', async function(t){
  //Project with an active chapter (not reference/trash) so this exercises the zip-specific
  //archiveProject error path rather than the getActiveChapter regression covered above.
  const project = newProject();
  project.chapters = [{ title: 'Chap 1' }];
  project.activeChapterIndex = 0;
  project.filename = ''; //archiveProject refuses to back up a project with no filename

  const sendMailMock = t.mock.fn();
  mockTransport(t, sendMailMock);

  const resp = await new Promise(function(resolve){
    prepareAndEmail(project, {}, fakeEditorQuill(), 'me@example.com', 'pw', 'you@example.com',
      '.zip', { compile: false }, resolve);
  });

  assert.strictEqual(typeof resp, 'string');
  assert.match(resp, /no filename/i);
  assert.strictEqual(sendMailMock.mock.calls.length, 0);
});

test('emailing the whole project as a zip cleans up the temp archive after sending', async function(t){
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wwemail-src-'));
  t.after(function(){ fs.rmSync(sourceDir, { recursive: true, force: true }); });

  const projectFilename = 'my-project.woolf';
  fs.writeFileSync(path.join(sourceDir, projectFilename), '{}', 'utf8');
  fs.mkdirSync(path.join(sourceDir, 'chapters'));
  fs.writeFileSync(path.join(sourceDir, 'chapters', 'chap1.txt'), 'chapter one', 'utf8');

  const project = newProject();
  project.filename = projectFilename;
  project.directory = sourceDir;
  project.chapsDirectory = 'chapters';
  project.chapters = [{ title: 'Chap 1' }];
  project.activeChapterIndex = 0;

  let capturedMail;
  mockTransport(t, function(mailOptions, cb){
    capturedMail = mailOptions;
    cb(null, { response: '250 OK' });
  });

  const resp = await new Promise(function(resolve){
    prepareAndEmail(project, {}, fakeEditorQuill(), 'me@example.com', 'pw', 'you@example.com',
      '.zip', { compile: false }, resolve);
  });
  t.after(function(){
    if(capturedMail && fs.existsSync(capturedMail.attachments[0].path))
      fs.unlinkSync(capturedMail.attachments[0].path);
  });

  assert.strictEqual(resp, 'Email sent successfully.');
  assert.ok(!fs.existsSync(capturedMail.attachments[0].path), 'temp zip archive should be removed after sending');
});
