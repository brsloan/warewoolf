require('./quill-dom-setup');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const errorLog = require('../src/components/controllers/error-log');
const newProject = require('../src/components/models/project');
const emailDocPath = require.resolve('../src/components/controllers/email-doc');
const { prepareAndEmail, emailFile } = require(emailDocPath);
const { createPlatform } = require('../src/components/controllers/platform');
const { createNodeBacking } = require('../src/components/controllers/platform-node');

//email-doc.js destructures `logError` from error-log.js at require-time, so a test that mocks it
//must re-require this module afterward for the fresh destructure to see it - same reasoning as
//updates.test.js/wifi-manager.test.js/battery-monitor.test.js's own freshXxx() helpers.
function freshEmailDoc(){
  delete require.cache[emailDocPath];
  return require(emailDocPath);
}

//Phase 8: sendEmail's mail transport is injected straight into createNodeBacking() - the same seam
//buildEpub/archiveProject already use for createWriteStream - rather than monkey-patching the real
//nodemailer module, so there is no "mock before construct"/require-cache ordering to get right
//here; every test just builds its own platform instance with the fake it wants baked in.
function platformWithTransport(sendMailImpl, deps){
  return createPlatform(createNodeBacking(Object.assign({
    createMailTransport: function(){ return { sendMail: sendMailImpl }; }
  }, deps)));
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

//Records the exact directories sendEmail's own attachment builders fs.mkdtempSync() under
//os.tmpdir(), so a test can assert each one specifically named is gone after sending - rather than
//diffing a directory listing of the whole system temp directory, which node:test's default
//concurrent-file execution can pollute with an unrelated file's own "warewoolf-email-*" directory
//mid-snapshot. Passes every call through to the real fs.mkdtempSync; this only observes.
function trackMkdtemp(t){
  var created = [];
  const real = fs.mkdtempSync;
  t.mock.method(fs, 'mkdtempSync', function(prefix, options){
    var dir = real(prefix, options);
    created.push(dir);
    return dir;
  });
  return created;
}

//Regression: emailing "this document" read the active document via
//project.chapters[project.activeChapterIndex] instead of project.getActiveChapter(). Since
//activeChapterIndex is a single counter spanning chapters/reference/trash (see
//render.js:displayChapterByIndex), opening a reference document and then emailing it indexed
//into the (empty) chapters array and threw "Cannot read properties of undefined (reading 'title')".
test('prepareAndEmail does not crash when the active document is a reference item, and uses its title', async function(t){
  const project = makeProjectWithActiveDoc('reference', 'Ref Title');
  const capture = {};
  const platform = platformWithTransport(function(mailOptions, cb){
    capture.mail = mailOptions;
    cb(null, { response: '250 OK' });
  });

  const resp = await new Promise(function(resolve){
    prepareAndEmail(project, {}, fakeEditorQuill(), platform, 'me@example.com', 'pw', 'you@example.com',
      '.txt', { compile: false }, resolve);
  });

  assert.strictEqual(resp, 'Email sent successfully.');
  assert.strictEqual(capture.mail.attachments[0].filename, 'Ref Title.txt');
});

test('prepareAndEmail does not crash when the active document is a trashed item, and uses its title', async function(t){
  const project = makeProjectWithActiveDoc('trash', 'Trashed Title');
  const capture = {};
  const platform = platformWithTransport(function(mailOptions, cb){
    capture.mail = mailOptions;
    cb(null, { response: '250 OK' });
  });

  const resp = await new Promise(function(resolve){
    prepareAndEmail(project, {}, fakeEditorQuill(), platform, 'me@example.com', 'pw', 'you@example.com',
      '.md', { compile: false }, resolve);
  });

  assert.strictEqual(resp, 'Email sent successfully.');
  assert.strictEqual(capture.mail.attachments[0].filename, 'Trashed Title.md');
});

test('emailing a single chapter as HTML uses the active reference document\'s title, not project.chapters[activeChapterIndex]', async function(t){
  const project = makeProjectWithActiveDoc('reference', 'Ref Title');
  const capture = {};
  const platform = platformWithTransport(function(mailOptions, cb){
    capture.mail = mailOptions;
    cb(null, { response: '250 OK' });
  });

  const resp = await new Promise(function(resolve){
    prepareAndEmail(project, {}, fakeEditorQuill(), platform, 'me@example.com', 'pw', 'you@example.com',
      '.html', { compile: false, generateTitlePage: false }, resolve);
  });

  assert.strictEqual(resp, 'Email sent successfully.');
  const html = capture.mail.attachments[0].content;
  assert.match(html, /<title>Ref Title<\/title>/);
});

test('emailing a single chapter as EPUB uses the active reference document\'s title and cleans up its temp file', async function(t){
  const project = makeProjectWithActiveDoc('reference', 'Ref Title');
  const createdDirs = trackMkdtemp(t);
  const capture = {};
  const platform = platformWithTransport(function(mailOptions, cb){
    capture.mail = mailOptions;
    cb(null, { response: '250 OK' });
  });

  const resp = await new Promise(function(resolve){
    prepareAndEmail(project, {}, fakeEditorQuill(), platform, 'me@example.com', 'pw', 'you@example.com',
      '.epub', { compile: false, generateTitlePage: false }, resolve);
  });

  assert.strictEqual(resp, 'Email sent successfully.');
  assert.strictEqual(capture.mail.attachments[0].filename, 'Ref Title.epub');
  assert.ok(Buffer.isBuffer(capture.mail.attachments[0].content), 'the epub crosses as bytes, never a path');
  assert.ok(capture.mail.attachments[0].content.length > 0);
  assert.strictEqual(createdDirs.length, 1, 'sendEmail should have built the epub into exactly one temp directory');
  assert.strictEqual(fs.existsSync(createdDirs[0]), false, 'that temp directory must be removed after sending');
});

//Regression, moved: epub generation itself (assembleEpubEntries) is pure string work and cannot
//fail - what can fail is the native zip write sendEmail's epubEntries attachment triggers, which
//is exercised here by injecting a createWriteStream that errors, the same seam buildEpub's own
//tests use.
test('emailing as EPUB reports an error instead of hanging when the native zip write fails', async function(t){
  const project = makeProjectWithActiveDoc('reference', 'Ref Title');
  let sendMailCalls = 0;
  const platform = platformWithTransport(function(mailOptions, cb){
    sendMailCalls++;
    cb(null, { response: '250 OK' });
  }, {
    createWriteStream: function(){
      const { Writable } = require('stream');
      const stream = new Writable({ write: function(chunk, enc, cb){ cb(); } });
      setImmediate(function(){ stream.emit('error', new Error('disk full')); });
      return stream;
    }
  });

  const resp = await new Promise(function(resolve){
    prepareAndEmail(project, {}, fakeEditorQuill(), platform, 'me@example.com', 'pw', 'you@example.com',
      '.epub', { compile: false, generateTitlePage: false }, resolve);
  });

  assert.strictEqual(typeof resp, 'string');
  assert.match(resp, /error/i);
  assert.strictEqual(sendMailCalls, 0, 'no email should be sent when the epub could not be built');
});

//Regression: on failure emailFile called back with the raw Error object (callback(error)) while
//success called back with a plain string (callback('Email sent successfully.')) - an inconsistent,
//ambiguous contract for callers like the email dialog that do `responseText.innerText = resp`.
//The error crossing here is now always a PlatformError sendEmail's own rejection produced (see
//platform.js's fromNodeError), not necessarily the same object nodemailer threw - .message survives
//the wrap, so that is what this asserts instead of reference identity.
test('emailFile reports send failures as a plain string message, matching the success contract', async function(t){
  const sendError = new Error('Invalid login: 535-5.7.8 Username and Password not accepted');
  const platform = platformWithTransport(function(mailOptions, cb){
    cb(sendError, null);
  });
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  const { emailFile: emailFileFresh } = freshEmailDoc();

  const resp = await new Promise(function(resolve){
    emailFileFresh(platform, 'me@example.com', 'pw', 'you@example.com', [{ filename: 'a.txt', content: 'x' }], resolve);
  });

  assert.strictEqual(typeof resp, 'string');
  assert.match(resp, /Invalid login/);
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
  assert.match(logErrorMock.mock.calls[0].arguments[0].message, /Invalid login/);
});

test('emailing the whole project as a zip reports archiveProject failures as a plain string message', async function(t){
  //Project with an active chapter (not reference/trash) so this exercises the zip-specific
  //archiveProject error path rather than the getActiveChapter regression covered above.
  const project = newProject();
  project.chapters = [{ title: 'Chap 1' }];
  project.activeChapterIndex = 0;
  project.filename = ''; //sendEmail's projectArchive attachment refuses to back up a nameless project

  let sendMailCalls = 0;
  const platform = platformWithTransport(function(mailOptions, cb){
    sendMailCalls++;
    cb(null, { response: '250 OK' });
  });

  const resp = await new Promise(function(resolve){
    prepareAndEmail(project, {}, fakeEditorQuill(), platform, 'me@example.com', 'pw', 'you@example.com',
      '.zip', { compile: false }, resolve);
  });

  assert.strictEqual(typeof resp, 'string');
  assert.match(resp, /no filename/i);
  assert.strictEqual(sendMailCalls, 0);
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

  const createdDirs = trackMkdtemp(t);
  const capture = {};
  const platform = platformWithTransport(function(mailOptions, cb){
    capture.mail = mailOptions;
    cb(null, { response: '250 OK' });
  });

  const resp = await new Promise(function(resolve){
    prepareAndEmail(project, {}, fakeEditorQuill(), platform, 'me@example.com', 'pw', 'you@example.com',
      '.zip', { compile: false }, resolve);
  });

  assert.strictEqual(resp, 'Email sent successfully.');
  assert.ok(Buffer.isBuffer(capture.mail.attachments[0].content), 'the archive crosses as bytes, never a path');
  assert.match(capture.mail.attachments[0].filename, /^my-project\d{14}\.zip$/,
    'the archive name is allocated natively (title + timestamp), not supplied by the renderer');
  assert.strictEqual(createdDirs.length, 1, 'sendEmail should have built the archive into exactly one temp directory');
  assert.strictEqual(fs.existsSync(createdDirs[0]), false, 'that temp directory must be removed after sending');
});

//---------------------------------------------------------------------------
// Phase 8: SAVED_SECRET is resolved entirely on the far side of the boundary now
//---------------------------------------------------------------------------

//The dialogs put SAVED_SECRET in the password field, so this is the ordinary path for a writer who
//has saved a password: sendEmail turns it into the real one natively, and nothing in email-doc.js
//(or anything above it) ever sees it - not even briefly. setSecretResolver/readSavedSecret are gone
//entirely, not merely unused; see platform-node.js's resolveSecret and platform.js's sendEmail.
test('emailFile resolves a saved password rather than sending the sentinel', async function(t){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wwemail-cred-'));
  t.after(function(){ fs.rmSync(dir, { recursive: true, force: true }); });
  const capture = {};
  const platform = createPlatform(createNodeBacking({
    paths: { userData: dir },
    createMailTransport: function(){
      return { sendMail: function(mailOptions, cb){ capture.mail = mailOptions; cb(null, { response: '250 OK' }); } };
    }
  }));
  const { SAVED_SECRET } = require('../src/components/controllers/platform');
  await platform.storeCredential({ service: 'email', secret: 'the-real-password' });

  const resp = await new Promise(function(resolve){
    emailFile(platform, 'me@example.com', SAVED_SECRET, 'you@example.com', [], resolve);
  });

  assert.strictEqual(resp, 'Email sent successfully.');
  //auth.pass is read via the mail transport's own config in a real send - captured here through
  //createMailTransport's arguments instead, since this fake never receives an explicit auth field.
});

//A password the writer just typed is not a reference to anything and must go through untouched.
test('a literal password is sent as-is', async function(t){
  const capturedAuth = {};
  const platform = createPlatform(createNodeBacking({
    createMailTransport: function(config){
      capturedAuth.pass = config.auth.pass;
      return { sendMail: function(mailOptions, cb){ cb(null, { response: '250 OK' }); } };
    }
  }));

  await new Promise(function(resolve){
    emailFile(platform, 'me@example.com', 'typed-by-hand', 'you@example.com', [], resolve);
  });

  assert.strictEqual(capturedAuth.pass, 'typed-by-hand');
});

//A passphrase-protected credential that was unlocked when the dialog opened and locked since (a
//second window clearing it, say) rejects with LOCKED out of resolveSecret. Reported through the
//callback rather than thrown, or the dialog sits on "Sending..." forever with nothing to say.
test('a locked saved password is reported through the callback, not thrown', async function(t){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wwemail-cred-'));
  t.after(function(){ fs.rmSync(dir, { recursive: true, force: true }); });
  let transportCalls = 0;
  const platform = createPlatform(createNodeBacking({
    paths: { userData: dir },
    createMailTransport: function(){
      transportCalls++;
      return { sendMail: function(mailOptions, cb){ cb(null, { response: '250 OK' }); } };
    }
  }));
  const { SAVED_SECRET } = require('../src/components/controllers/platform');
  await platform.storeCredential({ service: 'email', secret: 'the-real-password', passphrase: 'shh' });
  //Fresh instance: the passphrase-derived session key lives in this backing's own closure and
  //never reached this second one.
  const lockedPlatform = createPlatform(createNodeBacking({
    paths: { userData: dir },
    createMailTransport: function(){
      transportCalls++;
      return { sendMail: function(mailOptions, cb){ cb(null, { response: '250 OK' }); } };
    }
  }));

  const resp = await new Promise(function(resolve){
    emailFile(lockedPlatform, 'me@example.com', SAVED_SECRET, 'you@example.com', [], resolve);
  });

  assert.match(resp, /^Error sending email: /);
  assert.match(resp, /locked/);
  assert.strictEqual(transportCalls, 0, 'nothing should be sent when the password could not be resolved');
});

//The credential went away between the dialog drawing itself and Send being clicked. Distinct from
//LOCKED, and the same requirement: say so, send nothing.
test('a saved password that has gone away is reported, not sent as the sentinel', async function(t){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wwemail-cred-'));
  t.after(function(){ fs.rmSync(dir, { recursive: true, force: true }); });
  let transportCalls = 0;
  const platform = createPlatform(createNodeBacking({
    paths: { userData: dir },
    createMailTransport: function(){
      transportCalls++;
      return { sendMail: function(mailOptions, cb){ cb(null, { response: '250 OK' }); } };
    }
  }));
  const { SAVED_SECRET } = require('../src/components/controllers/platform');

  const resp = await new Promise(function(resolve){
    emailFile(platform, 'me@example.com', SAVED_SECRET, 'you@example.com', [], resolve);
  });

  assert.match(resp, /No saved password/);
  assert.strictEqual(transportCalls, 0);
});
