const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const errorLog = require('../src/components/controllers/error-log');
const { createPlatform } = require('../src/components/controllers/platform');
const { createNodeBacking } = require('../src/components/controllers/platform-node');
const projectPath = require.resolve('../src/components/models/project');
const newProject = require(projectPath);
const newChapter = require('../src/components/models/chapter');

//project.js destructures `logError` from error-log.js at require-time, so a test that mocks it
//must re-require project.js afterward for the fresh destructure to see the mock - same reasoning
//as chapter.test.js/utils.test.js/wifi-manager.test.js.
//A fresh copy also starts with no platform configured, so it has to be handed one the same way
//render.js does.
function freshProject(){
  delete require.cache[projectPath];
  const fresh = require(projectPath);
  fresh.setPlatform(platform);
  return fresh;
}

//Groups B and C reach the filesystem through the platform facade now. Neither takes a directory of
//its own - every command is told which project directory to act in - so one instance serves every
//temp directory these tests create.
var platform;

test.before(function(){
  platform = createPlatform(createNodeBacking({
    paths: { userData: fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-project-log-')) }
  }));
  errorLog.setPlatform(platform);
  newProject.setPlatform(platform);
  newChapter.setPlatform(platform);
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

test('initNotesChap gives the notes chapter the default project-notes filename', async function(t){
  const proj = newProject();

  proj.initNotesChap();

  assert.strictEqual(proj.notesChap.filename, 'project_.txt');
});

test('initNotesChap regression: project notes typed into a brand-new project survive a save + reload round trip', async function(t){
  const dir = tempDir(t);
  const proj = newProject();
  proj.directory = dir;
  proj.filename = 'test.woolf';
  proj.chapsDirectory = '';
  //Mirrors what render.js's createNewProject() does for a brand-new (never loaded) project.
  proj.initNotesChap();
  proj.notesChap.notes = textDelta('hello notes');
  proj.notesChap.hasUnsavedChanges = true;

  assert.ok(await proj.saveFile());

  const reloaded = newProject();
  const missingChaps = await reloaded.loadFile(dir + 'test.woolf');
  assert.deepStrictEqual(missingChaps, []);
  const reloadedNotes = await reloaded.notesChap.getNotesContentOrFile();
  assert.strictEqual(reloadedNotes.ops[0].insert, 'hello notes');
});

//---------------------------------------------------------------------------
// testChapsDirectory
//---------------------------------------------------------------------------

test('testChapsDirectory operates on the project instance it is called on, not a global', async function(t){
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

  const missingChaps = await proj.testChapsDirectory();

  assert.strictEqual(missingChaps.length, 1);
  assert.strictEqual(missingChaps[0].filename, 'missing.txt');
});

test('testChapsDirectory does not leak state between two separate project instances', async function(t){
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

  assert.strictEqual((await projA.testChapsDirectory()).length, 0);
  assert.strictEqual((await projB.testChapsDirectory()).length, 1);
});

test('loadFile flags chapters whose files are missing from the chaps directory', async function(t){
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
  const missingChaps = await proj.loadFile(dir + 'test.woolf');

  assert.strictEqual(missingChaps.length, 1);
  assert.strictEqual(missingChaps[0].filename, 'missing.txt');
  assert.strictEqual(proj.notesChap.filename, 'project_.txt');
});

//---------------------------------------------------------------------------
// saveFile
//---------------------------------------------------------------------------

test('saveFile returns true and writes the project file on success', async function(t){
  const dir = tempDir(t);
  const proj = newProject();
  proj.directory = dir;
  proj.filename = 'test.woolf';
  proj.chapsDirectory = '';
  const result = await proj.saveFile();

  assert.strictEqual(result, true);
  assert.ok(fs.existsSync(dir + 'test.woolf'));
});

test('saveFile returns false instead of throwing when there is no filepath to save to', async function(t){
  const proj = newProject();

  const result = await proj.saveFile();

  assert.strictEqual(result, false);
});

test('saveFile regression: returns false instead of silently reporting success when the write fails', async function(t){
  const dir = tempDir(t);
  const freshNewProject = freshProject();
  const proj = freshNewProject();
  proj.directory = dir;
  proj.filename = 'test.woolf';
  proj.chapsDirectory = '';
  t.mock.method(fs, 'writeFileSync', function(){
    throw new Error('disk full');
  });

  const result = await proj.saveFile();

  t.mock.restoreAll();
  assert.strictEqual(result, false, 'a caller checking the return value must be able to tell the save failed');
  assert.ok(!fs.existsSync(dir + 'test.woolf'));
});

//---------------------------------------------------------------------------
// saveAs
//---------------------------------------------------------------------------

test('saveAs returns the full path of the new project file on success', async function(t){
  const dir = tempDir(t);
  const proj = newProject();
  proj.chapters = [];
  proj.reference = [];
  proj.trash = [];
  const result = await proj.saveAs(dir + 'MyBook.woolf');

  //saveAs normalizes paths to forward slashes internally (for linux/windows compatibility)
  assert.strictEqual(result, dir.replaceAll('\\', '/') + 'MyBook.woolf');
  assert.ok(fs.existsSync(dir + 'MyBook.woolf'));
  assert.ok(fs.existsSync(dir + 'MyBook_chapters/'));
});

test('saveAs regression: a project title containing a period keeps its full name in the chapters subdirectory', async function(t){
  const dir = tempDir(t);
  const proj = newProject();
  proj.chapters = [];
  proj.reference = [];
  proj.trash = [];
  await proj.saveAs(dir + 'My.Book.woolf');

  assert.ok(fs.existsSync(dir + 'My.Book_chapters/'), 'chapters subdirectory should keep the whole title, not truncate at the first period');
  assert.ok(!fs.existsSync(dir + 'My_chapters/'));
});

test('saveAs regression: a chapter file missing from disk does not abort saving the rest of the project', async function(t){
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
  const result = await proj.saveAs(newDir + 'test.woolf');

  assert.ok(result, 'saveAs should still succeed for the rest of the project');
  assert.ok(fs.existsSync(newDir + 'test_chapters/good.txt'), 'the chapter whose file exists should still be copied over');
  assert.ok(!fs.existsSync(newDir + 'test_chapters/missing.txt'));
  assert.strictEqual(brokenChap.filename, 'missing.txt', 'a chapter that failed to copy should not be repointed at a file that was never created');
});

//---------------------------------------------------------------------------
// parent project references
//---------------------------------------------------------------------------

test('loadFile hands every chapter the project it was loaded into', async function(t){
  const dir = tempDir(t);
  fs.writeFileSync(dir + 'Chapter One.txt', 'body', 'utf8');
  fs.writeFileSync(dir + 'proj.woolf', JSON.stringify({
    title: 'Test', chapsDirectory: '',
    chapters: [{ title: 'Chapter One', filename: 'Chapter One.txt' }],
    reference: [{ title: 'Ref', filename: 'Chapter One.txt' }],
    trash: [{ title: 'Trashed', filename: 'Chapter One.txt' }]
  }), 'utf8');

  const proj = newProject();
  await proj.loadFile(dir + 'proj.woolf');

  [proj.chapters[0], proj.reference[0], proj.trash[0], proj.notesChap].forEach(function(chap){
    assert.strictEqual(chap.parentProject, proj, chap.title + ' should point back at this project');
  });
});

//Each chapter points back at its project, so the saved form has to drop that reference - otherwise
//JSON.stringify walks the cycle and throws.
test('saving a project does not choke on the reference each chapter holds back to it', async function(t){
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

  assert.strictEqual(await proj.saveFile(), true);

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
test('loadFile returns an empty array rather than undefined when the file is not valid JSON', async function(t){
  const dir = tempDir(t);
  const projPath = dir + 'damaged.woolf';
  fs.writeFileSync(projPath, '{"title": "Half a proj', 'utf8');

  const proj = newProject();
  const missingChaps = await proj.loadFile(projPath);

  assert.ok(Array.isArray(missingChaps));
  assert.strictEqual(missingChaps.length, 0);
});

test('loadFile records why a load failed so the caller can tell it from a clean load', async function(t){
  const dir = tempDir(t);
  const projPath = dir + 'damaged.woolf';
  fs.writeFileSync(projPath, 'not a project file at all', 'utf8');

  const proj = newProject();
  await proj.loadFile(projPath);

  assert.ok(proj.loadError instanceof Error);
});

test('loadFile clears a previous failure once a good project loads', async function(t){
  const dir = tempDir(t);
  fs.writeFileSync(dir + 'damaged.woolf', '#', 'utf8');
  fs.mkdirSync(dir + 'good_chapters');
  fs.writeFileSync(dir + 'good.woolf', JSON.stringify({
    title: 'Good', author: 'A', chapsDirectory: 'good_chapters/',
    chapters: [], reference: [], trash: []
  }), 'utf8');

  const proj = newProject();
  await proj.loadFile(dir + 'damaged.woolf');
  assert.ok(proj.loadError);

  await proj.loadFile(dir + 'good.woolf');
  assert.strictEqual(proj.loadError, null);
});

test('loadError never reaches the saved project file', async function(t){
  const dir = tempDir(t);
  fs.mkdirSync(dir + 'p_chapters');
  const proj = newProject();
  await proj.loadFile(dir + 'missing.woolf');
  assert.ok(proj.loadError, 'load of a nonexistent file failed as expected');

  proj.filename = 'p.woolf';
  proj.directory = dir;
  proj.chapsDirectory = 'p_chapters/';
  proj.initNotesChap();
  assert.strictEqual(await proj.saveFile(), true);

  const written = JSON.parse(fs.readFileSync(dir + 'p.woolf', 'utf8'));
  assert.strictEqual(written.loadError, undefined);
});

//---------------------------------------------------------------------------
// testChapsDirectory across all three lists
//---------------------------------------------------------------------------

//Only the chapters list used to be scanned, so a reference document or trashed chapter whose file
//had gone missing was never reported - the repair screen stayed shut and the reader found out by
//navigating onto it and getting a blank editor with an ENOENT in the error log.
async function projectWithMissingFileIn(dir, listName){
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

  return await newProject().loadFile(dir + 'p.woolf');
}

test('loadFile flags a reference document whose file is missing', async function(t){
  const missing = await projectWithMissingFileIn(tempDir(t), 'reference');

  assert.strictEqual(missing.length, 1);
  assert.strictEqual(missing[0].title, 'New Chap');
});

test('loadFile flags a trashed chapter whose file is missing', async function(t){
  const missing = await projectWithMissingFileIn(tempDir(t), 'trash');

  assert.strictEqual(missing.length, 1);
  assert.strictEqual(missing[0].title, 'New Chap');
});

test('loadFile reports nothing missing when every list is intact', async function(t){
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

  assert.deepStrictEqual(await newProject().loadFile(dir + 'p.woolf'), []);
});

//A chapter added but never saved has no file yet, so there is no missing one to report.
test('testChapsDirectory ignores a chapter that has no filename', async function(t){
  const dir = tempDir(t);
  const proj = newProject();
  proj.directory = dir;
  proj.chapsDirectory = 'p_chapters/';
  proj.chapters = [newChapter(proj)];

  assert.deepStrictEqual(await proj.testChapsDirectory(), []);
});

//---------------------------------------------------------------------------
// isReadOnly
//---------------------------------------------------------------------------

//The bundled Help doc is opened straight out of the install directory, which a normal user account
//can't write to. saveFile() refusing up front is what keeps a save from failing with EACCES inside
//its own catch, where the error is logged and the caller is told nothing.
test('saveFile refuses to write a read-only project and reports failure', async function(t){
  const dir = tempDir(t);
  const proj = newProject();
  proj.initNotesChap();
  proj.directory = dir;
  proj.filename = 'help.woolf';
  proj.isReadOnly = true;

  assert.strictEqual(await proj.saveFile(), false);
  assert.strictEqual(fs.existsSync(dir + 'help.woolf'), false,
    'nothing should have been written for a read-only project');
});

test('saveFile writes normally once the read-only flag is cleared', async function(t){
  const dir = tempDir(t);
  const proj = newProject();
  proj.initNotesChap();
  proj.directory = dir;
  proj.filename = 'help.woolf';
  proj.isReadOnly = true;
  await proj.saveFile();

  proj.isReadOnly = false;

  assert.strictEqual(await proj.saveFile(), true);
  assert.strictEqual(fs.existsSync(dir + 'help.woolf'), true);
});

//Whether a copy was opened read-only depends on where it was opened from, not on anything in the
//file, so it must never be written into one.
test('saveFile does not write isReadOnly into the project file', async function(t){
  const dir = tempDir(t);
  const proj = newProject();
  proj.initNotesChap();
  proj.directory = dir;
  proj.filename = 'p.woolf';

  await proj.saveFile();

  const saved = JSON.parse(fs.readFileSync(dir + 'p.woolf', 'utf8'));
  assert.strictEqual('isReadOnly' in saved, false);
});

test('loadFile leaves a project opened from an ordinary file writable', async function(t){
  const dir = tempDir(t);
  fs.writeFileSync(dir + 'p.woolf', JSON.stringify({
    title: 'P', author: 'A', chapsDirectory: '', chapters: [], reference: [], trash: []
  }), 'utf8');
  const proj = newProject();
  proj.isReadOnly = true;

  await proj.loadFile(dir + 'p.woolf');

  assert.strictEqual(proj.isReadOnly, false,
    'a fresh load must not inherit the previous project\'s read-only state');
});

//loadFile Object.assigns the parsed file onto the project, so a .woolf carrying the key - only
//possible by hand, since it is never written - would otherwise mark a writable project read-only
//and make every save silently do nothing.
test('loadFile ignores isReadOnly set inside the project file', async function(t){
  const dir = tempDir(t);
  fs.writeFileSync(dir + 'p.woolf', JSON.stringify({
    title: 'P', author: 'A', chapsDirectory: '', chapters: [], reference: [], trash: [],
    isReadOnly: true
  }), 'utf8');
  const proj = newProject();

  await proj.loadFile(dir + 'p.woolf');

  assert.strictEqual(proj.isReadOnly, false);
  assert.strictEqual(await proj.saveFile(), true, 'the project should still be saveable');
});

//Save As is how a reader gets their own copy of the Help doc: the project now points at a location
//they chose, so it is theirs to write to.
test('saveAs clears the read-only flag, so the new copy can be saved in place', async function(t){
  const dir = tempDir(t);
  const proj = newProject();
  proj.initNotesChap();
  proj.isReadOnly = true;

  await proj.saveAs(dir + 'MyCopy.woolf');

  assert.strictEqual(proj.isReadOnly, false);
  assert.strictEqual(await proj.saveFile(), true);
});

//Save a Copy deliberately leaves the open project pointing back at the original, so if that
//original was read-only it still is.
test('saveAs as a copy leaves the open read-only project read-only', async function(t){
  const dir = tempDir(t);
  const proj = newProject();
  proj.initNotesChap();
  proj.directory = dir;
  proj.filename = 'help.woolf';
  proj.isReadOnly = true;

  await proj.saveAs(dir + 'MyCopy.woolf', true);

  assert.strictEqual(proj.isReadOnly, true);
  assert.strictEqual(await proj.saveFile(), false);
});

//---------------------------------------------------------------------------
// Save As: the ordering the three-step sequence exists for
//---------------------------------------------------------------------------

//The property that fails if the .woolf is written before the dirty chapters are saved. Saving a
//chapter *allocates* its filename, so a project file written any earlier names a file that does not
//exist yet - and, once saveChapterAtomic has renamed the old one out from under it, never will.
//This is why saveProjectAs does not take the project's contents and saveProject is a second call.
test('saveAs writes a project file naming the filenames its dirty chapters were actually allocated', async function(t){
  const oldDir = tempDir(t);
  const newDir = tempDir(t);
  const proj = newProject();
  proj.directory = oldDir;
  proj.chapsDirectory = '';
  proj.initNotesChap();

  const renamed = newChapter(proj);
  renamed.title = 'A Better Title';
  renamed.filename = 'old name.txt';
  renamed.contents = textDelta('the chapter body');
  renamed.hasUnsavedChanges = true;
  fs.writeFileSync(oldDir + 'old name.txt', 'stale', 'utf8');
  proj.chapters = [renamed];

  await proj.saveAs(newDir + 'MyBook.woolf');

  const written = JSON.parse(fs.readFileSync(newDir + 'MyBook.woolf', 'utf8'));
  assert.strictEqual(written.chapters[0].filename, 'A Better Title.txt');
  assert.ok(fs.existsSync(newDir + 'MyBook_chapters/A Better Title.txt'),
    'the file the project file names has to be the one on disk');
  assert.match(fs.readFileSync(newDir + 'MyBook_chapters/A Better Title.txt', 'utf8'), /the chapter body/);
});

//The chapter saves have to land in the new location, which only works because the project's own
//directory is updated before they run - a chapter resolves its directory through its project on
//every use.
test('saveAs saves a dirty chapter into the new location, not the one it came from', async function(t){
  const oldDir = tempDir(t);
  const newDir = tempDir(t);
  const proj = newProject();
  proj.directory = oldDir;
  proj.chapsDirectory = '';
  proj.initNotesChap();

  const chap = newChapter(proj);
  chap.title = 'Chapter One';
  chap.contents = textDelta('brand new text');
  chap.hasUnsavedChanges = true;
  proj.chapters = [chap];

  await proj.saveAs(newDir + 'MyBook.woolf');

  assert.ok(fs.existsSync(newDir + 'MyBook_chapters/Chapter One.txt'));
  assert.ok(!fs.existsSync(oldDir + 'Chapter One.txt'),
    'nothing should have been written back into the project\'s old home');
});

//Save a Copy exists to leave the open project exactly where it was, so the copy is written and the
//project goes on pointing at its original files.
test('saveAs as a copy leaves the open project pointing at its original location', async function(t){
  const oldDir = tempDir(t);
  const newDir = tempDir(t);
  const proj = newProject();
  proj.directory = oldDir;
  proj.filename = 'original.woolf';
  proj.chapsDirectory = '';
  proj.initNotesChap();
  fs.writeFileSync(oldDir + 'chap.txt', 'body', 'utf8');
  const chap = newChapter(proj);
  chap.filename = 'chap.txt';
  proj.chapters = [chap];

  await proj.saveAs(newDir + 'Copy.woolf', true);

  assert.strictEqual(proj.directory, oldDir);
  assert.strictEqual(proj.filename, 'original.woolf');
  assert.strictEqual(proj.chapsDirectory, '');
  assert.strictEqual(chap.filename, 'chap.txt', 'the open project keeps pointing at its own files');
  assert.ok(fs.existsSync(newDir + 'Copy.woolf'), 'the copy is still written');
  assert.ok(fs.existsSync(newDir + 'Copy_chapters/chap.txt'));
});

//---------------------------------------------------------------------------
// where the read-only guard sits
//---------------------------------------------------------------------------

//isReadOnly is a renderer-side UI flag, not the enforcement - PERMISSION_DENIED from the platform
//is the backstop for when it is wrong (see platform.js's CODES). But it has to be checked above the
//chapter saves, not merely above the project-file write: a project opened out of a read-only
//install directory cannot have its chapter files written either, and each of those failures would
//be a separate swallowed EACCES.
test('a read-only project does not write its chapter files either, not just its project file', async function(t){
  const dir = tempDir(t);
  const proj = newProject();
  proj.directory = dir;
  proj.filename = 'help.woolf';
  proj.chapsDirectory = '';
  proj.initNotesChap();

  const chap = newChapter(proj);
  chap.title = 'Chapter One';
  chap.contents = textDelta('typed into a read-only project');
  chap.hasUnsavedChanges = true;
  proj.chapters = [chap];

  proj.isReadOnly = true;

  assert.strictEqual(await proj.saveFile(), false);
  assert.ok(!fs.existsSync(dir + 'Chapter One.txt'),
    'the chapter file must not be written for a read-only project');
  assert.strictEqual(chap.hasUnsavedChanges, true,
    'and the chapter stays dirty, since nothing was saved');
});

//A silent no-op here would be data loss behind a clean-looking return.
test('a project with no platform configured refuses to save rather than quietly doing nothing', async function(t){
  const dir = tempDir(t);
  const logged = [];
  t.mock.method(errorLog, 'logError', function(err){ logged.push(err); });

  delete require.cache[projectPath];
  const unconfigured = require(projectPath);
  t.after(function(){ delete require.cache[projectPath]; });

  const proj = unconfigured();
  proj.directory = dir;
  proj.filename = 'p.woolf';
  proj.initNotesChap();

  assert.strictEqual(await proj.saveFile(), false);
  assert.strictEqual(logged.length, 1);
  assert.match(logged[0].message, /no platform has been configured/);
  assert.ok(!fs.existsSync(dir + 'p.woolf'));
});

//testChapsDirectory feeds the repair screen, and every caller does .length on what it hands back -
//so a check that could not run reports nothing missing rather than throwing out of a load or an
//unawaited view callback. It is logged, because a repair screen that silently never opens is the
//failure mode the whole function exists to end.
test('testChapsDirectory reports nothing missing, loudly, when the check itself cannot run', async function(t){
  const logged = [];
  t.mock.method(errorLog, 'logError', function(err){ logged.push(err); });

  delete require.cache[projectPath];
  const unconfigured = require(projectPath);
  t.after(function(){ delete require.cache[projectPath]; });

  const proj = unconfigured();
  proj.directory = '/nowhere/';
  proj.chapsDirectory = '';
  const chap = newChapter(proj);
  chap.filename = 'gone.txt';
  proj.chapters = [chap];

  assert.deepStrictEqual(await proj.testChapsDirectory(), []);
  assert.strictEqual(logged.length, 1);
});
