require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { makeChapter, makeProject } = require('./helpers');
const errorLog = require('../src/components/controllers/error-log');
const exportPath = require.resolve('../src/components/controllers/export');
const { exportProject } = require(exportPath);

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
