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
  //Mirrors what render.js's createNewProject() does for a brand-new (never loaded) project.
  proj.initNotesChap();
  proj.notesChap.notes = textDelta('hello notes');
  proj.notesChap.hasUnsavedChanges = true;

  assert.ok(proj.saveFile());

  const reloaded = newProject();
  const missingChaps = reloaded.loadFile(dir + 'test.woolf');
  assert.deepStrictEqual(missingChaps, []);
  const reloadedNotes = reloaded.notesChap.getNotesContentOrFile();
  assert.strictEqual(reloadedNotes.ops[0].insert, 'hello notes');
});

//---------------------------------------------------------------------------
// testChapsDirectory
//---------------------------------------------------------------------------

test('testChapsDirectory operates on the project instance it is called on, not a global', function(t){
  const dir = tempDir(t);

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
  const result = proj.saveAs(newDir + 'test.woolf');

  assert.ok(result, 'saveAs should still succeed for the rest of the project');
  assert.ok(fs.existsSync(newDir + 'test_chapters/good.txt'), 'the chapter whose file exists should still be copied over');
  assert.ok(!fs.existsSync(newDir + 'test_chapters/missing.txt'));
  assert.strictEqual(brokenChap.filename, 'missing.txt', 'a chapter that failed to copy should not be repointed at a file that was never created');
});

//---------------------------------------------------------------------------
// parent project references
//---------------------------------------------------------------------------

test('loadFile hands every chapter the project it was loaded into', function(t){
  const dir = tempDir(t);
  fs.writeFileSync(dir + 'Chapter One.txt', 'body', 'utf8');
  fs.writeFileSync(dir + 'proj.woolf', JSON.stringify({
    title: 'Test', chapsDirectory: '',
    chapters: [{ title: 'Chapter One', filename: 'Chapter One.txt' }],
    reference: [{ title: 'Ref', filename: 'Chapter One.txt' }],
    trash: [{ title: 'Trashed', filename: 'Chapter One.txt' }]
  }), 'utf8');

  const proj = newProject();
  proj.loadFile(dir + 'proj.woolf');

  [proj.chapters[0], proj.reference[0], proj.trash[0], proj.notesChap].forEach(function(chap){
    assert.strictEqual(chap.parentProject, proj, chap.title + ' should point back at this project');
  });
});

//Each chapter points back at its project, so the saved form has to drop that reference - otherwise
//JSON.stringify walks the cycle and throws.
test('saving a project does not choke on the reference each chapter holds back to it', function(t){
  const dir = tempDir(t);
  const proj = newProject();
  proj.filename = 'cycle.woolf';
  proj.directory = dir;
  proj.chapsDirectory = '';
  proj.initNotesChap();

  const chap = newChapter(proj);
  chap.title = 'Chapter One';
  chap.contents = textDelta('body');
  chap.hasUnsavedChanges = true;
  proj.chapters.push(chap);

  assert.strictEqual(proj.saveFile(), true);

  const saved = JSON.parse(fs.readFileSync(dir + 'cycle.woolf', 'utf8'));
  assert.strictEqual(saved.chapters[0].parentProject, undefined);
  assert.strictEqual(saved.chapters[0].title, 'Chapter One');
});

//---------------------------------------------------------------------------
// loadFile on an unreadable project file
//---------------------------------------------------------------------------

//Every caller does `missingChaps.length` on what loadFile() hands back. It used to fall off the
//end of its catch block and return undefined, so a damaged .woolf threw there instead - and on the
//startup path that killed render.js before it registered the IPC handler index.js's close guard
//waits for, leaving a window that could not be closed at all.
test('loadFile returns an empty array rather than undefined when the file is not valid JSON', function(t){
  const dir = tempDir(t);
  const projPath = dir + 'damaged.woolf';
  fs.writeFileSync(projPath, '{"title": "Half a proj', 'utf8');

  const proj = newProject();
  const missingChaps = proj.loadFile(projPath);

  assert.ok(Array.isArray(missingChaps));
  assert.strictEqual(missingChaps.length, 0);
});

test('loadFile records why a load failed so the caller can tell it from a clean load', function(t){
  const dir = tempDir(t);
  const projPath = dir + 'damaged.woolf';
  fs.writeFileSync(projPath, 'not a project file at all', 'utf8');

  const proj = newProject();
  proj.loadFile(projPath);

  assert.ok(proj.loadError instanceof Error);
});

test('loadFile clears a previous failure once a good project loads', function(t){
  const dir = tempDir(t);
  fs.writeFileSync(dir + 'damaged.woolf', '#', 'utf8');
  fs.mkdirSync(dir + 'good_chapters');
  fs.writeFileSync(dir + 'good.woolf', JSON.stringify({
    title: 'Good', author: 'A', chapsDirectory: 'good_chapters/',
    chapters: [], reference: [], trash: []
  }), 'utf8');

  const proj = newProject();
  proj.loadFile(dir + 'damaged.woolf');
  assert.ok(proj.loadError);

  proj.loadFile(dir + 'good.woolf');
  assert.strictEqual(proj.loadError, null);
});

test('loadError never reaches the saved project file', function(t){
  const dir = tempDir(t);
  fs.mkdirSync(dir + 'p_chapters');
  const proj = newProject();
  proj.loadFile(dir + 'missing.woolf');
  assert.ok(proj.loadError, 'load of a nonexistent file failed as expected');

  proj.filename = 'p.woolf';
  proj.directory = dir;
  proj.chapsDirectory = 'p_chapters/';
  proj.initNotesChap();
  assert.strictEqual(proj.saveFile(), true);

  const written = JSON.parse(fs.readFileSync(dir + 'p.woolf', 'utf8'));
  assert.strictEqual(written.loadError, undefined);
});

//---------------------------------------------------------------------------
// testChapsDirectory across all three lists
//---------------------------------------------------------------------------

//Only the chapters list used to be scanned, so a reference document or trashed chapter whose file
//had gone missing was never reported - the repair screen stayed shut and the reader found out by
//navigating onto it and getting a blank editor with an ENOENT in the error log.
function projectWithMissingFileIn(dir, listName){
  const chapsDir = 'p_chapters/';
  fs.mkdirSync(dir + chapsDir, { recursive: true });
  fs.writeFileSync(dir + chapsDir + 'present.txt', 'Here.\n', 'utf8');

  const lists = { chapters: [], reference: [], trash: [] };
  lists.chapters.push({ title: 'Present', filename: 'present.txt' });
  lists[listName].push({ title: 'New Chap', filename: 'new chap.txt' });

  fs.writeFileSync(dir + 'p.woolf', JSON.stringify({
    title: 'P', author: 'A', chapsDirectory: chapsDir,
    chapters: lists.chapters, reference: lists.reference, trash: lists.trash
  }), 'utf8');

  return newProject().loadFile(dir + 'p.woolf');
}

test('loadFile flags a reference document whose file is missing', function(t){
  const missing = projectWithMissingFileIn(tempDir(t), 'reference');

  assert.strictEqual(missing.length, 1);
  assert.strictEqual(missing[0].title, 'New Chap');
});

test('loadFile flags a trashed chapter whose file is missing', function(t){
  const missing = projectWithMissingFileIn(tempDir(t), 'trash');

  assert.strictEqual(missing.length, 1);
  assert.strictEqual(missing[0].title, 'New Chap');
});

test('loadFile reports nothing missing when every list is intact', function(t){
  const dir = tempDir(t);
  const chapsDir = 'p_chapters/';
  fs.mkdirSync(dir + chapsDir);
  ['a.txt', 'b.txt', 'c.txt'].forEach(function(f){
    fs.writeFileSync(dir + chapsDir + f, 'Text.\n', 'utf8');
  });
  fs.writeFileSync(dir + 'p.woolf', JSON.stringify({
    title: 'P', author: 'A', chapsDirectory: chapsDir,
    chapters: [{ title: 'A', filename: 'a.txt' }],
    reference: [{ title: 'B', filename: 'b.txt' }],
    trash: [{ title: 'C', filename: 'c.txt' }]
  }), 'utf8');

  assert.deepStrictEqual(newProject().loadFile(dir + 'p.woolf'), []);
});

//A chapter added but never saved has no file yet, so there is no missing one to report.
test('testChapsDirectory ignores a chapter that has no filename', function(t){
  const dir = tempDir(t);
  const proj = newProject();
  proj.directory = dir;
  proj.chapsDirectory = 'p_chapters/';
  proj.chapters = [newChapter(proj)];

  assert.deepStrictEqual(proj.testChapsDirectory(), []);
});

//---------------------------------------------------------------------------
// isReadOnly
//---------------------------------------------------------------------------

//The bundled Help doc is opened straight out of the install directory, which a normal user account
//can't write to. saveFile() refusing up front is what keeps a save from failing with EACCES inside
//its own catch, where the error is logged and the caller is told nothing.
test('saveFile refuses to write a read-only project and reports failure', function(t){
  const dir = tempDir(t);
  const proj = newProject();
  proj.initNotesChap();
  proj.directory = dir;
  proj.filename = 'help.woolf';
  proj.isReadOnly = true;

  assert.strictEqual(proj.saveFile(), false);
  assert.strictEqual(fs.existsSync(dir + 'help.woolf'), false,
    'nothing should have been written for a read-only project');
});

test('saveFile writes normally once the read-only flag is cleared', function(t){
  const dir = tempDir(t);
  const proj = newProject();
  proj.initNotesChap();
  proj.directory = dir;
  proj.filename = 'help.woolf';
  proj.isReadOnly = true;
  proj.saveFile();

  proj.isReadOnly = false;

  assert.strictEqual(proj.saveFile(), true);
  assert.strictEqual(fs.existsSync(dir + 'help.woolf'), true);
});

//Whether a copy was opened read-only depends on where it was opened from, not on anything in the
//file, so it must never be written into one.
test('saveFile does not write isReadOnly into the project file', function(t){
  const dir = tempDir(t);
  const proj = newProject();
  proj.initNotesChap();
  proj.directory = dir;
  proj.filename = 'p.woolf';

  proj.saveFile();

  const saved = JSON.parse(fs.readFileSync(dir + 'p.woolf', 'utf8'));
  assert.strictEqual('isReadOnly' in saved, false);
});

test('loadFile leaves a project opened from an ordinary file writable', function(t){
  const dir = tempDir(t);
  fs.writeFileSync(dir + 'p.woolf', JSON.stringify({
    title: 'P', author: 'A', chapsDirectory: '', chapters: [], reference: [], trash: []
  }), 'utf8');
  const proj = newProject();
  proj.isReadOnly = true;

  proj.loadFile(dir + 'p.woolf');

  assert.strictEqual(proj.isReadOnly, false,
    'a fresh load must not inherit the previous project\'s read-only state');
});

//loadFile Object.assigns the parsed file onto the project, so a .woolf carrying the key - only
//possible by hand, since it is never written - would otherwise mark a writable project read-only
//and make every save silently do nothing.
test('loadFile ignores isReadOnly set inside the project file', function(t){
  const dir = tempDir(t);
  fs.writeFileSync(dir + 'p.woolf', JSON.stringify({
    title: 'P', author: 'A', chapsDirectory: '', chapters: [], reference: [], trash: [],
    isReadOnly: true
  }), 'utf8');
  const proj = newProject();

  proj.loadFile(dir + 'p.woolf');

  assert.strictEqual(proj.isReadOnly, false);
  assert.strictEqual(proj.saveFile(), true, 'the project should still be saveable');
});

//Save As is how a reader gets their own copy of the Help doc: the project now points at a location
//they chose, so it is theirs to write to.
test('saveAs clears the read-only flag, so the new copy can be saved in place', function(t){
  const dir = tempDir(t);
  const proj = newProject();
  proj.initNotesChap();
  proj.isReadOnly = true;

  proj.saveAs(dir + 'MyCopy.woolf');

  assert.strictEqual(proj.isReadOnly, false);
  assert.strictEqual(proj.saveFile(), true);
});

//Save a Copy deliberately leaves the open project pointing back at the original, so if that
//original was read-only it still is.
test('saveAs as a copy leaves the open read-only project read-only', function(t){
  const dir = tempDir(t);
  const proj = newProject();
  proj.initNotesChap();
  proj.directory = dir;
  proj.filename = 'help.woolf';
  proj.isReadOnly = true;

  proj.saveAs(dir + 'MyCopy.woolf', true);

  assert.strictEqual(proj.isReadOnly, true);
  assert.strictEqual(proj.saveFile(), false);
});
