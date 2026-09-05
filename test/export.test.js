require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const unzipper = require('unzipper');

const { makeChapter, makeProject } = require('./helpers');
const errorLog = require('../src/components/controllers/error-log');
const exportPath = require.resolve('../src/components/controllers/export');
const { exportProject } = require(exportPath);

//Epub is written via a zip archive stream, so the file can exist on disk before the archive's
//central directory is fully flushed - same helper as compile.test.js's waitForEpub. Retry opening
//it as a zip until that succeeds.
async function waitForEpub(filepath, timeoutMs){
  const start = Date.now();
  while(true){
    if(fs.existsSync(filepath)){
      try{
        return await unzipper.Open.file(filepath);
      }
      catch(err){ /* not fully written yet */ }
    }
    if(Date.now() - start > timeoutMs)
      throw new Error('timed out waiting for epub: ' + filepath);
    await new Promise(function(r){ setTimeout(r, 20); });
  }
}

//export.js destructures `logError` from error-log.js at require-time, so a test that mocks it
//must re-require export.js afterward for the fresh destructure to see it - same reasoning as
//email-doc.test.js's freshEmailDoc.
function freshExport(){
  delete require.cache[exportPath];
  return require(exportPath);
}

function textDelta(text){
  return { ops: [ { insert: text }, { insert: '\n' } ] };
}

function tempDir(t){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-test-'));
  t.after(function(){
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

//The controllers under test only touch title/author/chapters/reference/trash/notesChap/
//directory/chapsDirectory/getActiveChapter, so the fake project needs nothing else.
function makeTestProject(chapters, reference){
  chapters.forEach(function(chap, i){
    if(chap.title === 'new')
      chap.title = 'Chapter ' + (i + 1);
  });
  var project = makeProject(chapters, reference);
  project.title = 'Test Project';
  project.author = 'Test Author';
  project.directory = '';
  project.chapsDirectory = '';
  project.trash = [];
  project.notesChap = makeChapter(null);
  project.activeChapterIndex = 0;
  project.getActiveChapter = function(){
    return this.chapters[this.activeChapterIndex];
  };
  return project;
}

test('exportProject writes one sequentially numbered file per chapter when exporting the whole project', function(t){
  var chap1 = makeChapter(textDelta('First chapter text.'));
  var chap2 = makeChapter(textDelta('Second chapter text.'));
  var project = makeTestProject([chap1, chap2]);
  var dir = tempDir(t);
  var options = { type: '.txt', what: 'project', styleHeadingAsChapter: true, generateTitlePage: false };

  exportProject(project, {}, options, dir);

  var outDir = path.join(dir, 'Test Project');
  assert.match(fs.readFileSync(path.join(outDir, '0001_Chapter 1.txt'), 'utf8'), /First chapter text\./);
  assert.match(fs.readFileSync(path.join(outDir, '0002_Chapter 2.txt'), 'utf8'), /Second chapter text\./);
});

test('exportProject prefixes reference-chapter filenames with "-ref_"', function(t){
  var chap = makeChapter(textDelta('Body.'));
  var ref = makeChapter(textDelta('Reference body.'));
  ref.title = 'Appendix';
  var project = makeTestProject([chap], [ref]);
  var dir = tempDir(t);
  var options = { type: '.txt', what: 'project', styleHeadingAsChapter: true, generateTitlePage: false };

  exportProject(project, {}, options, dir);

  var outDir = path.join(dir, 'Test Project');
  assert.ok(fs.existsSync(path.join(outDir, '0001_Chapter 1.txt')), 'expected the regular chapter file');
  assert.match(fs.readFileSync(path.join(outDir, '-ref_0001_Appendix.txt'), 'utf8'), /Reference body\./);
});

test('exportProject writes a chapter\'s notes alongside it with the "-notes_" prefix', function(t){
  var chap = makeChapter(textDelta('Body.'));
  chap.notes = textDelta('Some chapter notes.');
  var project = makeTestProject([chap]);
  var dir = tempDir(t);
  var options = { type: '.txt', what: 'project', styleHeadingAsChapter: true, generateTitlePage: false };

  exportProject(project, {}, options, dir);

  var outDir = path.join(dir, 'Test Project');
  assert.match(fs.readFileSync(path.join(outDir, '-notes_0001_Chapter 1.txt'), 'utf8'), /Some chapter notes\./);
});

//Regression: exportChapter read options.compileGenTitlePage, a field export_display.js never
//sets (it sets options.generateTitlePage), so the title page was silently never inserted into
//.html/.epub exports regardless of what the caller asked for.
test('exportProject inserts a title page into .html output when generateTitlePage is true', function(t){
  var chap = makeChapter(textDelta('Body text.'));
  chap.title = 'Chapter One';
  var project = makeTestProject([chap]);
  var dir = tempDir(t);
  var options = { type: '.html', what: 'project', styleHeadingAsChapter: true, generateTitlePage: true };

  exportProject(project, {}, options, dir);

  var html = fs.readFileSync(path.join(dir, 'Test Project', '0001_Chapter One.html'), 'utf8');
  assert.match(html, /<h1 class="center">/, 'expected a title-page heading to be inserted');
});

test('exportProject omits the title page from .html output when generateTitlePage is false', function(t){
  var chap = makeChapter(textDelta('Body text.'));
  chap.title = 'Chapter One';
  var project = makeTestProject([chap]);
  var dir = tempDir(t);
  var options = { type: '.html', what: 'project', styleHeadingAsChapter: true, generateTitlePage: false };

  exportProject(project, {}, options, dir);

  var html = fs.readFileSync(path.join(dir, 'Test Project', '0001_Chapter One.html'), 'utf8');
  assert.doesNotMatch(html, /<h1 class="center">/);
});

test('exportProject prefixes a trashed chapter export with "-trash_"', function(t){
  var trashedChap = makeChapter(textDelta('Deleted content.'));
  trashedChap.title = 'Deleted Chapter';
  var project = makeTestProject([]);
  project.trash = [trashedChap];
  project.getActiveChapter = function(){ return trashedChap; };
  var dir = tempDir(t);
  var options = { type: '.txt', what: 'chapter', styleHeadingAsChapter: true, generateTitlePage: false };

  exportProject(project, {}, options, dir);

  var outDir = path.join(dir, 'Test Project');
  assert.match(fs.readFileSync(path.join(outDir, '-trash_Deleted Chapter.txt'), 'utf8'), /Deleted content\./);
});

//Regression: the whole chapter loop used to share one try/catch, so a single bad chapter (a
//corrupt file, a parse failure) aborted every chapter after it instead of just being logged and
//skipped.
test('exportProject keeps exporting later chapters after an earlier one throws', function(t){
  var logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  var freshExportProject = freshExport().exportProject;

  var badChap = makeChapter(textDelta('Bad.'));
  badChap.getContentsOrFile = function(){ throw new Error('boom'); };
  var goodChap = makeChapter(textDelta('Good chapter text.'));
  var project = makeTestProject([badChap, goodChap]);
  var dir = tempDir(t);
  var options = { type: '.txt', what: 'project', styleHeadingAsChapter: true, generateTitlePage: false };

  assert.doesNotThrow(function(){
    freshExportProject(project, {}, options, dir);
  });

  var outDir = path.join(dir, 'Test Project');
  assert.ok(!fs.existsSync(path.join(outDir, '0001_Chapter 1.txt')), 'the throwing chapter should not have produced a file');
  assert.match(fs.readFileSync(path.join(outDir, '0002_Chapter 2.txt'), 'utf8'), /Good chapter text\./);
  assert.strictEqual(logErrorMock.mock.calls.length, 1, 'expected the thrown error to be logged exactly once');
});

//Regression: exportProject had no way to signal completion at all, so export_display.js had to
//call exportProject then immediately close its popup - fine for the synchronous formats, but wrong
//for .docx (docx.Packer's promise) and .epub (an archive stream), both of which finish writing
//asynchronously. It now takes a completion callback that only fires once every write, sync or
//async, has actually finished, and reports how many failed.
test('exportProject invokes its callback with an error count of 0 once a synchronous export has fully written', function(t){
  var chap = makeChapter(textDelta('Body text.'));
  var project = makeTestProject([chap]);
  var dir = tempDir(t);
  var options = { type: '.txt', what: 'project', styleHeadingAsChapter: true, generateTitlePage: false };

  var cbackCalls = [];
  exportProject(project, {}, options, dir, function(errorCount){ cbackCalls.push(errorCount); });

  assert.deepStrictEqual(cbackCalls, [0]);
  assert.ok(fs.existsSync(path.join(dir, 'Test Project', '0001_Chapter 1.txt')));
});

test('exportProject does not throw when called without a completion callback (legacy call shape)', function(t){
  var chap = makeChapter(textDelta('Body text.'));
  var project = makeTestProject([chap]);
  var dir = tempDir(t);
  var options = { type: '.txt', what: 'project', styleHeadingAsChapter: true, generateTitlePage: false };

  assert.doesNotThrow(function(){
    exportProject(project, {}, options, dir);
  });
});

test('exportProject reports a nonzero error count when an earlier chapter throws', function(t){
  t.mock.method(errorLog, 'logError', function(){});
  var freshExportProject = freshExport().exportProject;

  var badChap = makeChapter(textDelta('Bad.'));
  badChap.getContentsOrFile = function(){ throw new Error('boom'); };
  var goodChap = makeChapter(textDelta('Good chapter text.'));
  var project = makeTestProject([badChap, goodChap]);
  var dir = tempDir(t);
  var options = { type: '.txt', what: 'project', styleHeadingAsChapter: true, generateTitlePage: false };

  var cbackCalls = [];
  freshExportProject(project, {}, options, dir, function(errorCount){ cbackCalls.push(errorCount); });

  assert.deepStrictEqual(cbackCalls, [1]);
});

test('exportProject\'s callback only fires once an async .docx write has actually finished, not synchronously', async function(t){
  var chap = makeChapter(textDelta('Docx text.'));
  var project = makeTestProject([chap]);
  var dir = tempDir(t);
  var options = { type: '.docx', what: 'project', styleHeadingAsChapter: true, generateTitlePage: false };

  var callbackFired = false;
  exportProject(project, { addressInfo: null }, options, dir, function(){ callbackFired = true; });

  assert.strictEqual(callbackFired, false, '.docx callback should not fire synchronously');

  var filepath = path.join(dir, 'Test Project', '0001_Chapter 1.docx');
  var start = Date.now();
  while(!fs.existsSync(filepath)){
    if(Date.now() - start > 2000)
      throw new Error('timed out waiting for file: ' + filepath);
    await new Promise(function(r){ setTimeout(r, 20); });
  }

  assert.strictEqual(callbackFired, true, '.docx callback should have fired by the time the file exists');
});

test('exportProject\'s callback only fires once an async .epub write has actually finished, not synchronously', async function(t){
  var chap = makeChapter(textDelta('Epub text.'));
  chap.title = 'Chapter One';
  var project = makeTestProject([chap]);
  var dir = tempDir(t);
  var options = { type: '.epub', what: 'project', styleHeadingAsChapter: true, generateTitlePage: false };

  var callbackFired = false;
  exportProject(project, {}, options, dir, function(){ callbackFired = true; });

  assert.strictEqual(callbackFired, false, '.epub callback should not fire synchronously');

  await waitForEpub(path.join(dir, 'Test Project', '0001_Chapter One.epub'), 2000);
  assert.strictEqual(callbackFired, true, '.epub callback should have fired by the time the archive is readable');
});
