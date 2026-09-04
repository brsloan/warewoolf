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

//chapter.js's methods read a bare `project` identifier rather than taking it as a parameter - in
//the real app this is the global set up by render.js. Node resolves an unqualified free variable
//to a property of the global object, so setting it here reproduces that.
function setGlobalProject(t, directory){
  global.project = { directory: directory, chapsDirectory: '' };
  t.after(function(){ delete global.project; });
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
  setGlobalProject(t, dir);

  const chap = newChapter();
  chap.filename = 'chap1.txt';
  fs.writeFileSync(dir + 'chap1.txt', 'chapter text', 'utf8');
  fs.writeFileSync(dir + '-notes_chap1.txt', 'notes text', 'utf8');

  chap.deleteFile();

  assert.ok(!fs.existsSync(dir + 'chap1.txt'));
  assert.ok(!fs.existsSync(dir + '-notes_chap1.txt'), 'notes file should be deleted along with the chapter file');
});

test('deleteChapterFile does not throw when there is no notes file', function(t){
  const dir = tempDir(t);
  setGlobalProject(t, dir);

  const chap = newChapter();
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
  setGlobalProject(t, dir);

  const chap = newChapter();
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
  setGlobalProject(t, dir);

  const chap = newChapter();
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
  setGlobalProject(t, dir);

  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  const freshNewChapter = freshChapter();

  const chap = freshNewChapter();
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
  setGlobalProject(t, dir);

  const chap = newChapter();
  chap.title = 'Copy Target';
  chap.contents = textDelta('copied text');

  chap.saveCopy();

  assert.strictEqual(chap.filename, 'Copy Target.txt');
  assert.ok(fs.existsSync(dir + 'Copy Target.txt'));
});

test('saveCopy regression: a failed write leaves chap.filename unchanged instead of pointing at a nonexistent file', function(t){
  const dir = tempDir(t);
  setGlobalProject(t, dir);

  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  const freshNewChapter = freshChapter();

  const chap = freshNewChapter();
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
  setGlobalProject(t, dir);

  const chap = newChapter();
  chap.filename = 'chap1.txt';
  chap.notes = textDelta('some notes');

  chap.saveNotesFile();

  assert.strictEqual(chap.notes, null);
  const reloaded = chap.getNotesFile();
  assert.strictEqual(reloaded.ops[0].insert, 'some notes');
});
