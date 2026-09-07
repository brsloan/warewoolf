const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const errorLog = require('../src/components/controllers/error-log');
const { createPlatform } = require('../src/components/controllers/platform');
const { createNodeBacking } = require('../src/components/controllers/platform-node');
const chapterPath = require.resolve('../src/components/models/chapter');
const newChapter = require(chapterPath);

//chapter.js destructures `logError` from error-log.js at require-time, so a test that mocks it
//must re-require chapter.js afterward for the fresh destructure to see the mock - same reasoning
//as utils.test.js/wifi-manager.test.js. A fresh copy also starts with no platform configured, so
//it has to be handed one the same way render.js does.
function freshChapter(){
  delete require.cache[chapterPath];
  const fresh = require(chapterPath);
  fresh.setPlatform(platform);
  return fresh;
}

//Group C reaches the filesystem through the platform facade now. The backing takes no directories
//of its own for chapter work - every command is told which project directory to act in - so one
//instance serves every temp directory these tests create.
var platform;

test.before(function(){
  platform = createPlatform(createNodeBacking({
    paths: { userData: fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-chapter-log-')) }
  }));
  errorLog.setPlatform(platform);
  newChapter.setPlatform(platform);
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

test('deleteChapterFile removes both the chapter file and its notes file', async function(t){
  const dir = tempDir(t);
  const chap = newChapter(projectIn(dir));
  chap.filename = 'chap1.txt';
  fs.writeFileSync(dir + 'chap1.txt', 'chapter text', 'utf8');
  fs.writeFileSync(dir + '-notes_chap1.txt', 'notes text', 'utf8');

  await chap.deleteFile();

  assert.ok(!fs.existsSync(dir + 'chap1.txt'));
  assert.ok(!fs.existsSync(dir + '-notes_chap1.txt'), 'notes file should be deleted along with the chapter file');
});

test('deleteChapterFile does not throw when there is no notes file', async function(t){
  const dir = tempDir(t);
  const chap = newChapter(projectIn(dir));
  chap.filename = 'chap1.txt';
  fs.writeFileSync(dir + 'chap1.txt', 'chapter text', 'utf8');

  await assert.doesNotReject(function(){ return chap.deleteFile(); });
  assert.ok(!fs.existsSync(dir + 'chap1.txt'));
});

//A chapter added but never saved has no file to delete. Reaching the command with a null filename
//would be refused as INVALID_ARGUMENT and logged, which is noise about nothing - render.js's
//deleteChapter() calls this unconditionally.
test('deleteChapterFile does nothing, quietly, for a chapter that was never saved', async function(t){
  const logged = [];
  t.mock.method(errorLog, 'logError', function(err){ logged.push(err); });
  const freshNewChapter = freshChapter();

  const chap = freshNewChapter(projectIn(tempDir(t)));

  await chap.deleteFile();

  assert.deepStrictEqual(logged, []);
});

//---------------------------------------------------------------------------
// saveFile
//---------------------------------------------------------------------------

test('saveFile writes the chapter under a new-title-derived filename and cleans up the old one', async function(t){
  const dir = tempDir(t);
  const chap = newChapter(projectIn(dir));
  chap.title = 'My Chapter';
  chap.filename = 'old.txt';
  chap.contents = textDelta('hello world');
  fs.writeFileSync(dir + 'old.txt', 'stale contents', 'utf8');

  await chap.saveFile();

  assert.strictEqual(chap.filename, 'My Chapter.txt');
  assert.ok(fs.existsSync(dir + 'My Chapter.txt'));
  assert.ok(!fs.existsSync(dir + 'old.txt'));
  assert.ok(!fs.existsSync(dir + 'old_v_tempold.txt'), 'temp backup should be cleaned up after a successful save');
  assert.strictEqual(chap.contents, null);
  assert.strictEqual(chap.hasUnsavedChanges, false);
});

test('saveFile renames the notes file to match a changed chapter filename', async function(t){
  const dir = tempDir(t);
  const chap = newChapter(projectIn(dir));
  chap.title = 'New Title';
  chap.filename = 'old.txt';
  chap.contents = textDelta('hello world');
  fs.writeFileSync(dir + 'old.txt', 'stale contents', 'utf8');
  fs.writeFileSync(dir + '-notes_old.txt', 'notes', 'utf8');

  await chap.saveFile();

  assert.strictEqual(chap.filename, 'New Title.txt');
  assert.ok(fs.existsSync(dir + '-notes_New Title.txt'));
  assert.ok(!fs.existsSync(dir + '-notes_old.txt'));
});

test('saveFile regression: a failed write restores the old file and does not repoint chap.filename at a file that was never created', async function(t){
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

  await chap.saveFile();

  assert.strictEqual(logErrorMock.mock.calls.length, 1);
  //Filename must still point at a file that actually exists on disk
  assert.strictEqual(chap.filename, 'old.txt');
  t.mock.restoreAll();
  assert.ok(fs.existsSync(dir + 'old.txt'));
  assert.strictEqual(fs.readFileSync(dir + 'old.txt', 'utf8'), 'original contents');
  assert.ok(!fs.existsSync(dir + 'old_v_tempold.txt'), 'temp backup should be restored back to its original name');
});

//A failed save must leave the chapter dirty. Clearing the flag would mean the reader is never
//prompted about work that is only in memory, and closes the app on the strength of it.
test('saveFile leaves the chapter with unsaved changes when the write fails', async function(t){
  const dir = tempDir(t);
  t.mock.method(errorLog, 'logError', function(){});
  const freshNewChapter = freshChapter();

  const chap = freshNewChapter(projectIn(dir));
  chap.title = 'My Chapter';
  chap.contents = textDelta('hello world');
  chap.hasUnsavedChanges = true;
  t.mock.method(fs, 'writeFileSync', function(){ throw new Error('disk full'); });

  await chap.saveFile();

  assert.strictEqual(chap.hasUnsavedChanges, true);
  assert.deepStrictEqual(chap.contents, textDelta('hello world'),
    'the only copy of the text is the one in memory - it must not be dropped');
});

//The chapter's own file is the transaction; its notes are not. A notes failure is reported and the
//chapter stays dirty so the notes are retried and the reader is prompted about them - it used to
//clear hasUnsavedChanges before the notes were even attempted, so notes that never reached disk
//were dropped on exit without a word.
test('saveFile keeps the chapter dirty and reports it when the notes fail but the chapter is written', async function(t){
  const dir = tempDir(t);
  const logged = [];
  t.mock.method(errorLog, 'logError', function(err){ logged.push(err); });
  const freshNewChapter = freshChapter();

  const chap = freshNewChapter(projectIn(dir));
  chap.title = 'My Chapter';
  chap.contents = textDelta('hello world');
  chap.notes = textDelta('some notes');
  chap.hasUnsavedChanges = true;

  const realWrite = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', function(target){
    if(String(target).includes('-notes_'))
      throw new Error('notes disk full');
    return realWrite.apply(fs, arguments);
  });

  await chap.saveFile();
  t.mock.restoreAll();

  assert.strictEqual(chap.filename, 'My Chapter.txt', 'the chapter itself was written');
  assert.strictEqual(fs.readFileSync(dir + 'My Chapter.txt', 'utf8').includes('hello world'), true);
  assert.strictEqual(chap.hasUnsavedChanges, true, 'the notes are still only in memory');
  assert.deepStrictEqual(chap.notes, textDelta('some notes'));
  assert.strictEqual(logged.length, 1);
  assert.match(logged[0].message, /notes were not/);
});

//---------------------------------------------------------------------------
// saveCopy
//---------------------------------------------------------------------------

test('saveCopy writes a new file and points the chapter at it', async function(t){
  const dir = tempDir(t);
  const chap = newChapter(projectIn(dir));
  chap.title = 'Copy Target';
  chap.contents = textDelta('copied text');

  await chap.saveCopy();

  assert.strictEqual(chap.filename, 'Copy Target.txt');
  assert.ok(fs.existsSync(dir + 'Copy Target.txt'));
});

test('saveCopy regression: a failed write leaves chap.filename unchanged instead of pointing at a nonexistent file', async function(t){
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

  await chap.saveCopy();

  assert.strictEqual(logErrorMock.mock.calls.length, 1);
  assert.strictEqual(chap.filename, 'original.txt');
  t.mock.restoreAll();
});

//---------------------------------------------------------------------------
// getFile / saveNotesFile round trip
//---------------------------------------------------------------------------

test('saveNotesFile then getNotesFile round-trips notes content', async function(t){
  const dir = tempDir(t);
  const chap = newChapter(projectIn(dir));
  chap.filename = 'chap1.txt';
  chap.notes = textDelta('some notes');

  await chap.saveNotesFile();

  assert.strictEqual(chap.notes, null);
  const reloaded = await chap.getNotesFile();
  assert.strictEqual(reloaded.ops[0].insert, 'some notes');
});

test('getNotesFile returns null for a chapter that has no notes on disk', async function(t){
  const dir = tempDir(t);
  const chap = newChapter(projectIn(dir));
  chap.filename = 'chap1.txt';
  fs.writeFileSync(dir + 'chap1.txt', 'body', 'utf8');

  assert.strictEqual(await chap.getNotesFile(), null);
});

//Chapter files are MarkdownFic now, but projects saved by v1.1 and earlier hold JSON under a .pup
//name. The platform hands back text either way and the format is decided here from the filename.
test('getFile parses a legacy .pup chapter as JSON and a .txt chapter as MarkdownFic', async function(t){
  const dir = tempDir(t);

  const legacy = newChapter(projectIn(dir));
  legacy.filename = 'legacy.pup';
  fs.writeFileSync(dir + 'legacy.pup', JSON.stringify(textDelta('json chapter')), 'utf8');

  const modern = newChapter(projectIn(dir));
  modern.filename = 'modern.txt';
  fs.writeFileSync(dir + 'modern.txt', 'markdownfic chapter\n', 'utf8');

  assert.strictEqual((await legacy.getFile()).ops[0].insert, 'json chapter');
  assert.match((await modern.getFile()).ops[0].insert, /markdownfic chapter/);
});

//---------------------------------------------------------------------------
// parent project
//---------------------------------------------------------------------------

//This is the case the old bare `project` global made impossible: there was one of it, so there was
//only ever one set of directories for every chapter in the process to share.
test('two chapters with the same title write into their own projects rather than colliding', async function(t){
  const dirOne = tempDir(t);
  const dirTwo = tempDir(t);

  const chapOne = newChapter(projectIn(dirOne));
  chapOne.title = 'Shared Name';
  chapOne.contents = textDelta('from project one');
  await chapOne.saveFile();

  const chapTwo = newChapter(projectIn(dirTwo));
  chapTwo.title = 'Shared Name';
  chapTwo.contents = textDelta('from project two');
  await chapTwo.saveFile();

  assert.strictEqual(chapOne.filename, 'Shared Name.txt');
  assert.strictEqual(chapTwo.filename, 'Shared Name.txt');
  assert.match(fs.readFileSync(dirOne + 'Shared Name.txt', 'utf8'), /from project one/);
  assert.match(fs.readFileSync(dirTwo + 'Shared Name.txt', 'utf8'), /from project two/);
});

//The directory is resolved on each use rather than captured when the chapter is built, so Save As
//moving a project in place takes its chapters with it.
test('a chapter follows its project to a new directory instead of caching the old one', async function(t){
  const dirOne = tempDir(t);
  const dirTwo = tempDir(t);
  const proj = projectIn(dirOne);

  const chap = newChapter(proj);
  chap.title = 'Travelling';
  chap.contents = textDelta('first home');
  await chap.saveFile();

  assert.ok(fs.existsSync(dirOne + 'Travelling.txt'));

  proj.directory = dirTwo;
  chap.contents = textDelta('second home');
  await chap.saveFile();

  assert.ok(fs.existsSync(dirTwo + 'Travelling.txt'));
  assert.match(fs.readFileSync(dirTwo + 'Travelling.txt', 'utf8'), /second home/);
});

test('a chapter built without a project says so, rather than failing on an undefined lookup', async function(t){
  const logged = [];
  t.mock.method(errorLog, 'logError', function(err){ logged.push(err); });
  const freshNewChapter = freshChapter();

  const orphan = freshNewChapter();
  orphan.title = 'Orphan';
  orphan.contents = textDelta('nowhere to go');

  await orphan.saveFile();

  assert.strictEqual(logged.length, 1);
  assert.match(logged[0].message, /has no parent project/);
});

//A silent no-op here would be data loss behind a clean-looking return, so an unconfigured module
//says so rather than pretending the save happened.
test('a chapter with no platform configured refuses to save rather than quietly doing nothing', async function(t){
  const dir = tempDir(t);
  const logged = [];
  t.mock.method(errorLog, 'logError', function(err){ logged.push(err); });

  delete require.cache[chapterPath];
  const unconfigured = require(chapterPath);
  t.after(function(){ delete require.cache[chapterPath]; });

  const chap = unconfigured(projectIn(dir));
  chap.title = 'Nowhere';
  chap.contents = textDelta('text');

  await chap.saveFile();

  assert.strictEqual(logged.length, 1);
  assert.match(logged[0].message, /no platform has been configured/);
  assert.ok(!fs.existsSync(dir + 'Nowhere.txt'));
});
