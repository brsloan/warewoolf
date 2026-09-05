const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const errorLog = require('../src/components/controllers/error-log');
const chapterPath = require.resolve('../src/components/models/chapter');
const newChapter = require(chapterPath);

//chapter.js destructures `logError` from error-log.js at require-time, so a test that mocks it
//must re-require chapter.js afterward for the fresh destructure to see the mock - same reasoning
//as utils.test.js/wifi-manager.test.js.
function freshChapter(){
  delete require.cache[chapterPath];
  return require(chapterPath);
}

test.before(function(){
  errorLog.setLogDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-chapter-log-')));
});

function textDelta(text){
  return { ops: [ { insert: text }, { insert: '\n' } ] };
}

//chapter.js resolves its file paths through the project it was built with, so each chapter under
//test is handed one standing for a project whose chapter files sit directly in `directory`.
function projectIn(directory){
  return { directory: directory, chapsDirectory: '' };
}

function tempDir(t){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chapter-test-')) + path.sep;
  t.after(function(){
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

//---------------------------------------------------------------------------
// deleteChapterFile
//---------------------------------------------------------------------------

test('deleteChapterFile removes both the chapter file and its notes file', function(t){
  const dir = tempDir(t);
  const chap = newChapter(projectIn(dir));
  chap.filename = 'chap1.txt';
  fs.writeFileSync(dir + 'chap1.txt', 'chapter text', 'utf8');
  fs.writeFileSync(dir + '-notes_chap1.txt', 'notes text', 'utf8');

  chap.deleteFile();

  assert.ok(!fs.existsSync(dir + 'chap1.txt'));
  assert.ok(!fs.existsSync(dir + '-notes_chap1.txt'), 'notes file should be deleted along with the chapter file');
});

test('deleteChapterFile does not throw when there is no notes file', function(t){
  const dir = tempDir(t);
  const chap = newChapter(projectIn(dir));
  chap.filename = 'chap1.txt';
  fs.writeFileSync(dir + 'chap1.txt', 'chapter text', 'utf8');

  assert.doesNotThrow(function(){ chap.deleteFile(); });
  assert.ok(!fs.existsSync(dir + 'chap1.txt'));
});

//---------------------------------------------------------------------------
// saveFile
//---------------------------------------------------------------------------

test('saveFile writes the chapter under a new-title-derived filename and cleans up the old one', function(t){
  const dir = tempDir(t);
  const chap = newChapter(projectIn(dir));
  chap.title = 'My Chapter';
  chap.filename = 'old.txt';
  chap.contents = textDelta('hello world');
  fs.writeFileSync(dir + 'old.txt', 'stale contents', 'utf8');

  chap.saveFile();

  assert.strictEqual(chap.filename, 'My Chapter.txt');
  assert.ok(fs.existsSync(dir + 'My Chapter.txt'));
  assert.ok(!fs.existsSync(dir + 'old.txt'));
  assert.ok(!fs.existsSync(dir + 'old_v_tempold.txt'), 'temp backup should be cleaned up after a successful save');
  assert.strictEqual(chap.contents, null);
  assert.strictEqual(chap.hasUnsavedChanges, false);
});

test('saveFile renames the notes file to match a changed chapter filename', function(t){
  const dir = tempDir(t);
  const chap = newChapter(projectIn(dir));
  chap.title = 'New Title';
  chap.filename = 'old.txt';
  chap.contents = textDelta('hello world');
  fs.writeFileSync(dir + 'old.txt', 'stale contents', 'utf8');
  fs.writeFileSync(dir + '-notes_old.txt', 'notes', 'utf8');

  chap.saveFile();

  assert.strictEqual(chap.filename, 'New Title.txt');
  assert.ok(fs.existsSync(dir + '-notes_New Title.txt'));
  assert.ok(!fs.existsSync(dir + '-notes_old.txt'));
});

test('saveFile regression: a failed write restores the old file and does not repoint chap.filename at a file that was never created', function(t){
  const dir = tempDir(t);
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  const freshNewChapter = freshChapter();

  const chap = freshNewChapter(projectIn(dir));
  chap.title = 'My Chapter';
  chap.filename = 'old.txt';
  chap.contents = textDelta('hello world');
  fs.writeFileSync(dir + 'old.txt', 'original contents', 'utf8');

  t.mock.method(fs, 'writeFileSync', function(){
    throw new Error('disk full');
  });

  chap.saveFile();

  assert.strictEqual(logErrorMock.mock.calls.length, 1);
  //Filename must still point at a file that actually exists on disk
  assert.strictEqual(chap.filename, 'old.txt');
  t.mock.restoreAll();
  assert.ok(fs.existsSync(dir + 'old.txt'));
  assert.strictEqual(fs.readFileSync(dir + 'old.txt', 'utf8'), 'original contents');
  assert.ok(!fs.existsSync(dir + 'old_v_tempold.txt'), 'temp backup should be restored back to its original name');
});

//---------------------------------------------------------------------------
// saveCopy
//---------------------------------------------------------------------------

test('saveCopy writes a new file and points the chapter at it', function(t){
  const dir = tempDir(t);
  const chap = newChapter(projectIn(dir));
  chap.title = 'Copy Target';
  chap.contents = textDelta('copied text');

  chap.saveCopy();

  assert.strictEqual(chap.filename, 'Copy Target.txt');
  assert.ok(fs.existsSync(dir + 'Copy Target.txt'));
});

test('saveCopy regression: a failed write leaves chap.filename unchanged instead of pointing at a nonexistent file', function(t){
  const dir = tempDir(t);
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  const freshNewChapter = freshChapter();

  const chap = freshNewChapter(projectIn(dir));
  chap.title = 'Copy Target';
  chap.filename = 'original.txt';
  chap.contents = textDelta('copied text');

  t.mock.method(fs, 'writeFileSync', function(){
    throw new Error('disk full');
  });

  chap.saveCopy();

  assert.strictEqual(logErrorMock.mock.calls.length, 1);
  assert.strictEqual(chap.filename, 'original.txt');
  t.mock.restoreAll();
});

//---------------------------------------------------------------------------
// getFile / saveNotesFile round trip
//---------------------------------------------------------------------------

test('saveNotesFile then getNotesFile round-trips notes content', function(t){
  const dir = tempDir(t);
  const chap = newChapter(projectIn(dir));
  chap.filename = 'chap1.txt';
  chap.notes = textDelta('some notes');

  chap.saveNotesFile();

  assert.strictEqual(chap.notes, null);
  const reloaded = chap.getNotesFile();
  assert.strictEqual(reloaded.ops[0].insert, 'some notes');
});

//---------------------------------------------------------------------------
// parent project
//---------------------------------------------------------------------------

//This is the case the old bare `project` global made impossible: there was one of it, so there was
//only ever one set of directories for every chapter in the process to share.
test('two chapters with the same title write into their own projects rather than colliding', function(t){
  const dirOne = tempDir(t);
  const dirTwo = tempDir(t);

  const chapOne = newChapter(projectIn(dirOne));
  chapOne.title = 'Shared Name';
  chapOne.contents = textDelta('from project one');
  chapOne.saveFile();

  const chapTwo = newChapter(projectIn(dirTwo));
  chapTwo.title = 'Shared Name';
  chapTwo.contents = textDelta('from project two');
  chapTwo.saveFile();

  assert.strictEqual(chapOne.filename, 'Shared Name.txt');
  assert.strictEqual(chapTwo.filename, 'Shared Name.txt');
  assert.match(fs.readFileSync(dirOne + 'Shared Name.txt', 'utf8'), /from project one/);
  assert.match(fs.readFileSync(dirTwo + 'Shared Name.txt', 'utf8'), /from project two/);
});

//The directory is resolved on each use rather than captured when the chapter is built, so Save As
//moving a project in place takes its chapters with it.
test('a chapter follows its project to a new directory instead of caching the old one', function(t){
  const dirOne = tempDir(t);
  const dirTwo = tempDir(t);
  const proj = projectIn(dirOne);

  const chap = newChapter(proj);
  chap.title = 'Travelling';
  chap.contents = textDelta('first home');
  chap.saveFile();

  assert.ok(fs.existsSync(dirOne + 'Travelling.txt'));

  proj.directory = dirTwo;
  chap.contents = textDelta('second home');
  chap.saveFile();

  assert.ok(fs.existsSync(dirTwo + 'Travelling.txt'));
  assert.match(fs.readFileSync(dirTwo + 'Travelling.txt', 'utf8'), /second home/);
});

test('a chapter built without a project says so, rather than failing on an undefined lookup', function(t){
  const logged = [];
  t.mock.method(errorLog, 'logError', function(err){ logged.push(err); });
  const freshNewChapter = freshChapter();

  const orphan = freshNewChapter();
  orphan.title = 'Orphan';
  orphan.contents = textDelta('nowhere to go');

  orphan.saveFile();

  assert.strictEqual(logged.length, 1);
  assert.match(logged[0].message, /has no parent project/);
});
