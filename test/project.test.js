const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const errorLog = require('../src/components/controllers/error-log');
const projectPath = require.resolve('../src/components/models/project');
const newProject = require(projectPath);
const newChapter = require('../src/components/models/chapter');

//project.js destructures `logError` from error-log.js at require-time, so a test that mocks it
//must re-require project.js afterward for the fresh destructure to see the mock - same reasoning
//as chapter.test.js/utils.test.js/wifi-manager.test.js.
function freshProject(){
  delete require.cache[projectPath];
  return require(projectPath);
}

test.before(function(){
  errorLog.setLogDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-project-log-')));
});

function textDelta(text){
  return { ops: [ { insert: text }, { insert: '\n' } ] };
}

function tempDir(t){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-test-')) + path.sep;
  t.after(function(){
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

//project.saveFile()/saveAs() call chap.saveFile()/saveNotesFile(), and chapter.js reads a bare
//`project` identifier rather than taking it as a parameter - in the real app this is the same
//object the project methods run on (`this`), set up as a global by render.js. Mirror that here.
function setGlobalProject(t, proj){
  global.project = proj;
  t.after(function(){ delete global.project; });
}

//---------------------------------------------------------------------------
// initNotesChap
//---------------------------------------------------------------------------

test('initNotesChap gives the notes chapter the default project-notes filename', function(t){
  const proj = newProject();

  proj.initNotesChap();

  assert.strictEqual(proj.notesChap.filename, 'project_.txt');
});

test('initNotesChap regression: project notes typed into a brand-new project survive a save + reload round trip', function(t){
  const dir = tempDir(t);
  const proj = newProject();
  proj.directory = dir;
  proj.filename = 'test.woolf';
  proj.chapsDirectory = '';
  setGlobalProject(t, proj);

  //Mirrors what render.js's createNewProject() does for a brand-new (never loaded) project.
  proj.initNotesChap();
  proj.notesChap.notes = textDelta('hello notes');
  proj.notesChap.hasUnsavedChanges = true;

  assert.ok(proj.saveFile());

  const reloaded = newProject();
  const missingChaps = reloaded.loadFile(dir + 'test.woolf');
  setGlobalProject(t, reloaded);

  assert.deepStrictEqual(missingChaps, []);
  const reloadedNotes = reloaded.notesChap.getNotesContentOrFile();
  assert.strictEqual(reloadedNotes.ops[0].insert, 'hello notes');
});

//---------------------------------------------------------------------------
// testChapsDirectory
//---------------------------------------------------------------------------

test('testChapsDirectory operates on the project instance it is called on, not a global', function(t){
  const dir = tempDir(t);
  delete global.project; //prove there is no reliance on a global named `project`

  const proj = newProject();
  proj.directory = dir;
  proj.chapsDirectory = '';
  const present = newChapter();
  present.filename = 'present.txt';
  const missing = newChapter();
  missing.filename = 'missing.txt';
  proj.chapters = [present, missing];
  fs.writeFileSync(dir + 'present.txt', 'text', 'utf8');

  const missingChaps = proj.testChapsDirectory();

  assert.strictEqual(missingChaps.length, 1);
  assert.strictEqual(missingChaps[0].filename, 'missing.txt');
});

test('testChapsDirectory does not leak state between two separate project instances', function(t){
  const dirA = tempDir(t);
  const dirB = tempDir(t);

  const projA = newProject();
  projA.directory = dirA;
  projA.chapsDirectory = '';
  const chapA = newChapter();
  chapA.filename = 'a.txt';
  projA.chapters = [chapA];
  fs.writeFileSync(dirA + 'a.txt', 'x', 'utf8');

  const projB = newProject();
  projB.directory = dirB;
  projB.chapsDirectory = '';
  const chapB = newChapter();
  chapB.filename = 'b.txt'; //never written to disk
  projB.chapters = [chapB];

  assert.strictEqual(projA.testChapsDirectory().length, 0);
  assert.strictEqual(projB.testChapsDirectory().length, 1);
});

test('loadFile flags chapters whose files are missing from the chaps directory', function(t){
  const dir = tempDir(t);
  const chapsDir = 'test_chapters/';
  fs.mkdirSync(dir + chapsDir);
  fs.writeFileSync(dir + chapsDir + 'present.txt', 'hello', 'utf8');

  const projectJson = {
    chapsDirectory: chapsDir,
    title: 'Test',
    author: '',
    chapters: [ { title: 'One', filename: 'present.txt' }, { title: 'Two', filename: 'missing.txt' } ],
    reference: [],
    trash: [],
    filters: []
  };
  fs.writeFileSync(dir + 'test.woolf', JSON.stringify(projectJson), 'utf8');

  const proj = newProject();
  setGlobalProject(t, proj);
  const missingChaps = proj.loadFile(dir + 'test.woolf');

  assert.strictEqual(missingChaps.length, 1);
  assert.strictEqual(missingChaps[0].filename, 'missing.txt');
  assert.strictEqual(proj.notesChap.filename, 'project_.txt');
});

//---------------------------------------------------------------------------
// saveFile
//---------------------------------------------------------------------------

test('saveFile returns true and writes the project file on success', function(t){
  const dir = tempDir(t);
  const proj = newProject();
  proj.directory = dir;
  proj.filename = 'test.woolf';
  proj.chapsDirectory = '';
  setGlobalProject(t, proj);

  const result = proj.saveFile();

  assert.strictEqual(result, true);
  assert.ok(fs.existsSync(dir + 'test.woolf'));
});

test('saveFile returns false instead of throwing when there is no filepath to save to', function(t){
  const proj = newProject();

  const result = proj.saveFile();

  assert.strictEqual(result, false);
});

test('saveFile regression: returns false instead of silently reporting success when the write fails', function(t){
  const dir = tempDir(t);
  const freshNewProject = freshProject();
  const proj = freshNewProject();
  proj.directory = dir;
  proj.filename = 'test.woolf';
  proj.chapsDirectory = '';
  setGlobalProject(t, proj);

  t.mock.method(fs, 'writeFileSync', function(){
    throw new Error('disk full');
  });

  const result = proj.saveFile();

  t.mock.restoreAll();
  assert.strictEqual(result, false, 'a caller checking the return value must be able to tell the save failed');
  assert.ok(!fs.existsSync(dir + 'test.woolf'));
});

//---------------------------------------------------------------------------
// saveAs
//---------------------------------------------------------------------------

test('saveAs returns the full path of the new project file on success', function(t){
  const dir = tempDir(t);
  const proj = newProject();
  proj.chapters = [];
  proj.reference = [];
  proj.trash = [];
  setGlobalProject(t, proj);

  const result = proj.saveAs(dir + 'MyBook.woolf');

  //saveAs normalizes paths to forward slashes internally (for linux/windows compatibility)
  assert.strictEqual(result, dir.replaceAll('\\', '/') + 'MyBook.woolf');
  assert.ok(fs.existsSync(dir + 'MyBook.woolf'));
  assert.ok(fs.existsSync(dir + 'MyBook_chapters/'));
});

test('saveAs regression: a project title containing a period keeps its full name in the chapters subdirectory', function(t){
  const dir = tempDir(t);
  const proj = newProject();
  proj.chapters = [];
  proj.reference = [];
  proj.trash = [];
  setGlobalProject(t, proj);

  proj.saveAs(dir + 'My.Book.woolf');

  assert.ok(fs.existsSync(dir + 'My.Book_chapters/'), 'chapters subdirectory should keep the whole title, not truncate at the first period');
  assert.ok(!fs.existsSync(dir + 'My_chapters/'));
});

test('saveAs regression: a chapter file missing from disk does not abort saving the rest of the project', function(t){
  const oldDir = tempDir(t);
  const newDir = tempDir(t);
  const proj = newProject();
  proj.directory = oldDir;
  proj.chapsDirectory = '';

  const goodChap = newChapter();
  goodChap.filename = 'good.txt';
  fs.writeFileSync(oldDir + 'good.txt', 'good contents', 'utf8');

  const brokenChap = newChapter();
  brokenChap.filename = 'missing.txt'; //filename set but the file was never actually written

  proj.chapters = [brokenChap, goodChap];
  proj.reference = [];
  proj.trash = [];
  setGlobalProject(t, proj);

  const result = proj.saveAs(newDir + 'test.woolf');

  assert.ok(result, 'saveAs should still succeed for the rest of the project');
  assert.ok(fs.existsSync(newDir + 'test_chapters/good.txt'), 'the chapter whose file exists should still be copied over');
  assert.ok(!fs.existsSync(newDir + 'test_chapters/missing.txt'));
  assert.strictEqual(brokenChap.filename, 'missing.txt', 'a chapter that failed to copy should not be repointed at a file that was never created');
});
