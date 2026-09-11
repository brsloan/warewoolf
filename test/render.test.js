//Quill touches `document`/`Node`/`MutationObserver` at require-time, so the DOM must exist before
//render.js (which requires quill) is ever required - same reasoning as quill-dom-setup.js's own
//comment, and the same helper findreplace.test.js/typewriter-mode.test.js use for real-Quill tests.
//Captured (rather than a bare require) so a couple of tests below can reach its virtualConsole -
//see dispatchAndCaptureJsdomErrors().
const dom = require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const { createPlatform } = require('../src/components/controllers/platform');
const { createNodeBacking } = require('../src/components/controllers/platform-node');
const { createFakeBridge } = require('./fake-bridge');

const renderPath = require.resolve('../src/render');
//keybindings.js builds its own platform instance at require-time, same as render.js itself - but it
//is a separately cached module (render.js requires it, it does not live inside render.js), so
//clearing render.js's own cache entry each freshRender() call is not enough to make it see a new
//test's bridge. Needs clearing right alongside renderPath.
const keybindingsPath = require.resolve('../src/components/controllers/keybindings');

//error-log.js routes through a node-backed platform instance pointed at this directory (see
//render.js's loadPlatformState()) and appends to <userData>/error_log.txt in the background
//(logError is fire-and-forget) whenever anything under render.js logs an error, which happens
//incidentally in a couple of these tests (e.g. a real chapter reading its notes file out of a
//directory that does not exist here). A real, empty directory keeps those writes harmless instead
//of failing with ENOENT against a made-up path.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-render-test-'));

//The Open/Save As/Save Copy dialogs list this directory's real contents via fs.readdirSync() the
//moment they open (file-dialog_display.js's populateFileList()), so unlike app/home below it has
//to actually exist - a real, empty directory is enough for that listing to succeed with nothing in
//it. app/home stay nonexistent paths on purpose: loadInitialProject() relies on `app` not existing
//to fall through to createNewProject() below, and `home` is only ever added to a dropdown list,
//never read from disk.
const docsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-render-test-docs-'));

//Stands in for the installed app directory. Nonexistent by default, which is what keeps
//loadInitialProject() falling through to createNewProject() for every test that doesn't care -
//see freshRender()'s comment. The Help doc tests point it at a real temp directory holding a
//bundled project, then put it back.
var appDir = '/no-such-app-dir';

//render.js is loaded via a plain <script> tag in the real app (not required as a CommonJS module),
//so it reads `ipcRenderer` off a bare `require('electron')` at the top of the file. Outside Electron
//that resolves to a path string, so it must be faked in require.cache before every (re-)require -
//same require.cache-priming pattern about_display.test.js uses for its own dependencies.
//Group A of the platform contract (getAppPaths, getFileRequestedOnOpen, setTheme, showAppMenu,
//confirmExit, notifyRendererReady) now crosses through ipcRenderer.invoke() rather than
//sendSync/send, since platform.js wraps every command in a promise regardless of what the backing
//underneath actually does - see platform-ipc.js. `invoked` records every command name so tests can
//assert one was called without caring what it resolved with.
//Set by failBootAt() below to make one Group A command reject, so the boot-failure path can be
//driven the way it actually breaks - a platform command that does not resolve - rather than by
//stubbing render.js's own internals.
var bootFailure = null;

//What preload.js publishes as window.warewoolf, with a real node backing behind it. Through Phase 8
//this was a fake ipcRenderer answering group A's six commands with canned values and returning
//undefined for everything else, because everything else was plain fs the renderer did itself. As of
//Phase 9a all 65 cross, so the far side has to be real: the same createNodeBacking() the main
//process builds, pointed at this file's temp directories, behind the same structured-clone boundary
//and the same error envelope the app has.
//
//`invoked` records every command name so a test can assert one was called without caring what it
//resolved with. `handlers` is what render.js subscribed to per event channel - one handler each,
//since render.js subscribes exactly once per channel.
//Every process the renderer can reach is spawned through platform-node.js's one injectable seam,
//so replacing it here covers the whole file at once - and it has to be replaced. rebootSystem runs
//`systemctl reboot`, and the tests below drive the menu channel that reaches it: on a Linux machine,
//CI included, a real spawn there would take the machine down in the middle of the run. What is
//spawned is platform-node.js's business and is asserted in platform.test.js against its own
//injected seam; here every child just exits cleanly.
function fakeSpawn(){
  var child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: function(){}, end: function(){} };
  setImmediate(function(){
    child.emit('close', 0);
    child.stdout.emit('close', 0);
  });
  return child;
}

function makeBridge(){
  var handlers = {};
  var invoked = [];
  var inner = createFakeBridge(createPlatform(createNodeBacking({
    spawnProcess: fakeSpawn,
    paths: {
      app: appDir,
      userData: userDataDir,
      docs: docsDir,
      home: '/no-such-home-dir',
      temp: os.tmpdir(),
      downloads: '/no-such-downloads'
    },
    //No OS keystore, so a saved password lands under the credential store's own key file - the
    //case the old fake answered 'secure-storage-available' with false for.
    secureStorage: null
  })));

  return {
    handlers: handlers,
    invoked: invoked,
    invoke: function(name, args){
      invoked.push(name);
      //Set by failBootAt() to make one command reject, so the boot-failure path is driven the way
      //it actually breaks rather than by stubbing render.js's own internals.
      if(bootFailure && bootFailure.command === name)
        return Promise.reject(bootFailure.error);
      return inner.invoke(name, args);
    },
    on: function(event, handler){
      handlers[event] = handler;
      inner.on(event, handler);
    },
    off: function(event, handler){
      if(handlers[event] === handler)
        delete handlers[event];
      inner.off(event, handler);
    }
  };
}

//Resolving a promise still takes at least one microtask tick - platform.js's own wrapper adds a
//second, and platform-ipc.js's .then() a third - so anything triggered outside the awaited
//loadPlatformState() chain (a keydown, a menu click) needs this before checking what it invoked.
function flushMicrotasks(){
  return new Promise(function(resolve){ setImmediate(resolve); });
}

//Mirrors src/index.html's body exactly (minus the <script> tag): every id render.js reaches for
//with getElementById needs to already be present before it's (re-)required, since setUpQuills()/
//applyUserSettings() touch them synchronously at require-time.
function bodyShell(){
  return '<div id="chapter-list-sidebar" class="sidebar" tabindex="-1" role="navigation" aria-label="Project contents">' +
      '<h1 id="chapters-header">Chapters</h1>' +
      '<ul id="chapter-list" aria-labelledby="chapters-header"></ul>' +
      '<h1 id="reference-header">Reference</h1>' +
      '<ul id="reference-list" aria-labelledby="reference-header"></ul>' +
      "<h1 id='trash-header'>Trash</h1>" +
      '<ul id="trash-list" aria-labelledby="trash-header"></ul>' +
    '</div>' +
    '<div id="writing-field" class="writing-field-standard-view" role="main" aria-label="Manuscript">' +
      '<div id="editor-container"></div>' +
    '</div>' +
    '<div id="project-notes" class="sidebar" role="complementary" aria-labelledby="notes-header">' +
      '<h1 id="notes-header">Project Notes</h1>' +
      '<div id="notes-editor"></div>' +
    '</div>';
}

//(Re-)requiring render.js re-runs its top-level initialize(), which loads a project. None of the
//fake sysDirectories paths above exist, so loadInitialProject() falls through to createNewProject(),
//which opens a real "New Project" popup that nothing answers - project is left as the untouched,
//empty default (newProject()'s own initial chapters/reference/trash: []), which is exactly the blank
//slate each test wants to seed by hand. The stray popup is swept away so it doesn't confuse assertions.
//Each require re-runs render.js's top-level registerKeybindings() call, which attaches keydown
//listeners to `document` - a real, persistent object across every test in this file, unlike
//document.body's contents (replaced fresh each test by bodyShell() below). Without tearing down
//the previous require's listeners first, they would pile up on `document` indefinitely.
var previousKeybindingsTeardown = null;

//render.js's own module.exports starts out as just `{ ready: <promise> }` - getAppPaths()/
//getFileRequestedOnOpen() are real (albeit fake-resolved) promises now, so nothing the rest of this
//file reads off the returned object (project, userSettings, ...) exists until that promise
//resolves. require() itself cannot wait on it, so this does instead.
async function freshRender(){
  if(previousKeybindingsTeardown)
    previousKeybindingsTeardown();

  delete require.cache[renderPath];
  delete require.cache[keybindingsPath];
  globalThis.warewoolf = makeBridge();
  var mod = require(renderPath);
  await mod.ready;
  previousKeybindingsTeardown = mod._unregisterKeybindings;
  Array.from(document.querySelectorAll('.popup')).forEach(function(p){ p.remove(); });
  return mod;
}

//A minimal stand-in for the chapter model: render.js's list-mutation functions only ever touch
//title/contents/notes/hasUnsavedChanges/deleteFile on a chapter, so a plain object is enough and
//keeps these tests focused on render.js's own index arithmetic rather than chapter.js's file I/O,
//which chapter.test.js already covers against a real temp directory.
//getFile()/getNotesFile() return the same delta rather than throwing, because
//displayChapterByIndex's clearCurrentChapterIfUnchanged() can legitimately null out a chapter's
//in-memory contents/notes (as if they'd been flushed to disk) moments before it is displayed,
//exactly as it would for a real chapter backed by a file.
function makeChap(title, opts){
  opts = opts || {};
  var contents = opts.contents || { ops: [{ insert: (opts.text || title || 'chapter') + '\n' }] };
  var notes = { ops: [{ insert: '\n' }] };
  return {
    title: title,
    contents: contents,
    notes: notes,
    hasUnsavedChanges: !!opts.hasUnsavedChanges,
    getFile: function(){ return contents; },
    getNotesFile: function(){ return notes; },
    //Reads the live .notes property (as the real chapter.js does), not the closed-over `notes`
    //above, so a test that reassigns chap.notes after construction sees that value here too.
    getNotesContentOrFile: function(){ return this.notes; },
    deleteFile: opts.deleteFile || function(){}
  };
}

function findButton(text){
  return Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent === text; });
}

//render.js's document-level keydown listeners are exactly the kind of thing that throws in
//production (a real DOM dispatch) but not in a test: jsdom reports a listener's uncaught
//exception through its virtualConsole's 'jsdomError' event rather than re-throwing it out of
//dispatchEvent(), so assert.doesNotThrow() around a dispatch alone would never actually fail.
//This routes around that gap for the couple of tests below that need it.
function dispatchAndCaptureJsdomErrors(target, event){
  var caught = null;
  function onJsdomError(err){ caught = caught || err; }
  dom.virtualConsole.on('jsdomError', onJsdomError);
  try{
    target.dispatchEvent(event);
  }
  finally{
    dom.virtualConsole.off('jsdomError', onJsdomError);
  }
  return caught;
}

test.beforeEach(function(){
  document.body.innerHTML = bodyShell();
});

test.afterEach(function(){
  delete require.cache[renderPath];
  delete require.cache[keybindingsPath];
  delete globalThis.warewoolf;
  //Any test that flips a setting through a keyboard shortcut (font size, panel visibility,
  //typewriter mode, ...) calls userSettings.save(), which writes user-settings.json into the
  //real, shared userDataDir above - left in place, that file would leak the previous test's
  //settings into the next freshRender()'s load(), rather than the schema's own defaults.
  fs.rmSync(path.join(userDataDir, 'user-settings.json'), { force: true });
});

test.after(function(){
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.rmSync(docsDir, { recursive: true, force: true });
});

//---------------------------------------------------------------------------
// moveChapUp / moveChapDown
//---------------------------------------------------------------------------

test('moveChapUp on the first reference item folds it into the chapters list without shifting activeChapterIndex', async function(){
  var r = await freshRender();
  var c0 = makeChap('c0'), r0 = makeChap('r0');
  r.project.chapters = [c0];
  r.project.reference = [r0];
  r.project.activeChapterIndex = 1; //r0, firstReference

  r.moveChapUp(1);

  assert.deepStrictEqual(r.project.chapters, [c0, r0]);
  assert.deepStrictEqual(r.project.reference, []);
  //r0's combined index is unchanged (was 1 as first-reference, is 1 as new last-chapter)
  assert.strictEqual(r.project.activeChapterIndex, 1);
  assert.strictEqual(r.project.hasUnsavedChanges, true);
});

test('moveChapDown on the last chapter spills it into the reference list without shifting activeChapterIndex', async function(){
  var r = await freshRender();
  var c0 = makeChap('c0'), c1 = makeChap('c1'), r0 = makeChap('r0');
  r.project.chapters = [c0, c1];
  r.project.reference = [r0];
  r.project.activeChapterIndex = 1; //c1, lastChapter

  r.moveChapDown(1);

  assert.deepStrictEqual(r.project.chapters, [c0]);
  assert.deepStrictEqual(r.project.reference, [c1, r0]);
  assert.strictEqual(r.project.activeChapterIndex, 1);
});

test('moveChapDown reordering within the trash list shifts activeChapterIndex by one', async function(){
  var r = await freshRender();
  var t0 = makeChap('t0'), t1 = makeChap('t1'), t2 = makeChap('t2');
  r.project.trash = [t0, t1, t2];
  r.project.activeChapterIndex = 1; //t1, not last

  r.moveChapDown(1);

  assert.deepStrictEqual(r.project.trash, [t0, t2, t1]);
  assert.strictEqual(r.project.activeChapterIndex, 2);
});

//---------------------------------------------------------------------------
// moveToTrash
//---------------------------------------------------------------------------

test('moveToTrash on a live chapter moves it to trash and keeps the display on the chapter that took its place', async function(){
  var r = await freshRender();
  var c0 = makeChap('c0'), c1 = makeChap('c1');
  r.project.chapters = [c0, c1];
  r.project.activeChapterIndex = 0;

  await r.moveToTrash(0);

  assert.deepStrictEqual(r.project.chapters, [c1]);
  assert.deepStrictEqual(r.project.trash, [c0]);
  assert.strictEqual(r.project.hasUnsavedChanges, true);
  assert.strictEqual(r.project.activeChapterIndex, 0);
  assert.strictEqual(r.editorQuill.getText().trim(), 'c1');
});

test('moveToTrash on an already-trashed chapter asks for confirmation instead of trashing it again', async function(){
  var r = await freshRender();
  var t0 = makeChap('t0');
  r.project.trash = [t0];

  await r.moveToTrash(0);

  assert.deepStrictEqual(r.project.trash, [t0], 'nothing should be deleted before Yes is clicked');
  assert.ok(document.querySelector('.delete-confirm-popup'), 'a confirmation popup should appear');
});

test('moveToTrash on a project with nothing in any list does not push an empty slot into the trash', async function(){
  var r = await freshRender();
  r.project.chapters = [];
  r.project.reference = [];
  r.project.trash = [];

  await r.moveToTrash(0);

  assert.deepStrictEqual(r.project.trash, []);
});

//---------------------------------------------------------------------------
// restoreFromTrash
// Regression: restoreFromTrash used to leave hasUnsavedChanges untouched, so restoring a chapter
// and then exiting the app (which only offers to save when hasUnsavedChanges is true) silently
// dropped the restore - see render.js's exit-app-clicked handler.
//---------------------------------------------------------------------------

test('restoreFromTrash moves the chapter back and marks the project as having unsaved changes', async function(){
  var r = await freshRender();
  var c0 = makeChap('c0'), t0 = makeChap('t0');
  r.project.chapters = [c0];
  r.project.trash = [t0];
  r.project.hasUnsavedChanges = false;

  await r.restoreFromTrash(1); //t0's combined index: chapters.length(1) + reference.length(0)

  assert.deepStrictEqual(r.project.chapters, [c0, t0]);
  assert.deepStrictEqual(r.project.trash, []);
  assert.strictEqual(r.project.hasUnsavedChanges, true);
});

//---------------------------------------------------------------------------
// verifyToDelete / deleteChapter
// Regression: both used `ind - project.chapters.length` to index into trash[], omitting
// project.reference.length. Whenever the project had any reference chapters, permanently deleting
// a trashed chapter deleted the wrong one, or - if the offset ran past the end of trash[] entirely -
// crashed on `undefined.deleteFile()`.
//---------------------------------------------------------------------------

test('confirming delete twice in a row does not stack a second confirmation popup', async function(){
  var r = await freshRender();
  r.project.trash = [makeChap('t0')];

  await r.moveToTrash(0);
  await r.moveToTrash(0);

  assert.strictEqual(document.querySelectorAll('.delete-confirm-popup').length, 1);
});

test('deleting a trashed chapter removes that exact chapter, not a neighboring one, when the project has reference chapters', async function(){
  var r = await freshRender();
  var deletedFiles = [];
  var c0 = makeChap('c0');
  var r0 = makeChap('r0');
  var t0 = makeChap('t0', { deleteFile: function(){ deletedFiles.push('t0'); } });
  var t1 = makeChap('t1', { text: 'TrashOne', deleteFile: function(){ deletedFiles.push('t1'); } });
  r.project.chapters = [c0];
  r.project.reference = [r0];
  r.project.trash = [t0, t1];
  r.project.activeChapterIndex = 2; //t0's combined index: chapters.length(1) + reference.length(1) + 0

  await r.moveToTrash(2);
  //Awaited: the confirmation's handler deletes the chapter's files and saves the project, both of
  //which go through the platform facade now.
  await findButton('Yes').onclick();

  assert.deepStrictEqual(deletedFiles, ['t0']);
  assert.strictEqual(r.project.trash.length, 1);
  assert.strictEqual(r.project.trash[0], t1, 't1 should remain - it was never the target');
  assert.strictEqual(document.querySelectorAll('.delete-confirm-popup').length, 0);
  //display should follow onto the remaining trash item, now at the same combined index
  assert.strictEqual(r.project.activeChapterIndex, 2);
  assert.strictEqual(r.editorQuill.getText().trim(), 'TrashOne');
});

test('deleting the last trashed chapter does not crash when the project has multiple reference chapters', async function(){
  var r = await freshRender();
  var deletedFiles = [];
  var c0 = makeChap('c0');
  var t0 = makeChap('t0', { deleteFile: function(){ deletedFiles.push('t0'); } });
  r.project.chapters = [c0];
  r.project.reference = [makeChap('r0'), makeChap('r1')];
  r.project.trash = [t0];
  //t0's combined index: chapters.length(1) + reference.length(2) + 0 = 3
  r.project.activeChapterIndex = 3;

  await assert.doesNotReject(async function(){
    await r.moveToTrash(3);
    //Awaited: the confirmation's handler deletes the chapter's files and saves the project, both of
    //which go through the platform facade now.
    await findButton('Yes').onclick();
  });

  assert.deepStrictEqual(deletedFiles, ['t0']);
  assert.strictEqual(r.project.trash.length, 0);
  //trash is now empty, so the display should fall back to the last remaining chapter
  assert.strictEqual(r.project.activeChapterIndex, 0);
  assert.strictEqual(r.editorQuill.getText().trim(), 'c0');
});

test('clicking No on the delete confirmation leaves the trashed chapter untouched', async function(){
  var r = await freshRender();
  var t0 = makeChap('t0');
  r.project.trash = [t0];

  await r.moveToTrash(0);
  findButton('No').onclick();

  assert.deepStrictEqual(r.project.trash, [t0]);
  assert.strictEqual(document.querySelectorAll('.delete-confirm-popup').length, 0);
});

//---------------------------------------------------------------------------
// updateFileList
//---------------------------------------------------------------------------

test('updateFileList renders chapters/reference/trash with titles, unsaved markers, and the active highlight', async function(){
  var r = await freshRender();
  r.project.chapters = [makeChap('One'), makeChap('', { hasUnsavedChanges: true })];
  r.project.reference = [makeChap('Ref')];
  r.project.trash = [makeChap('Trashed')];
  r.project.activeChapterIndex = 1;

  r.updateFileList();

  var chapterItems = document.querySelectorAll('#chapter-list li');
  assert.strictEqual(chapterItems.length, 2);
  assert.strictEqual(chapterItems[0].textContent, 'One');
  assert.strictEqual(chapterItems[1].textContent, '(untitled)*');
  assert.ok(chapterItems[1].classList.contains('activeChapter'));
  assert.ok(!chapterItems[0].classList.contains('activeChapter'));

  var refItems = document.querySelectorAll('#reference-list li');
  assert.strictEqual(refItems.length, 1);
  assert.strictEqual(refItems[0].textContent, 'Ref');
  assert.strictEqual(refItems[0].dataset.chapIndex, '2');
  assert.ok(!document.getElementById('reference-header').classList.contains('trash-header-empty'));

  var trashItems = document.querySelectorAll('#trash-list li');
  assert.strictEqual(trashItems.length, 1);
  assert.strictEqual(trashItems[0].textContent, 'Trashed');
  assert.strictEqual(trashItems[0].dataset.chapIndex, '3');
  assert.ok(!document.getElementById('trash-header').classList.contains('trash-header-empty'));
});

test('updateFileList marks the reference and trash headers empty when those lists have nothing in them', async function(){
  var r = await freshRender();
  r.project.chapters = [makeChap('One')];

  r.updateFileList();

  assert.ok(document.getElementById('reference-header').classList.contains('trash-header-empty'));
  assert.ok(document.getElementById('trash-header').classList.contains('trash-header-empty'));
});

//---------------------------------------------------------------------------
// displayChapterByIndex
//---------------------------------------------------------------------------

test('displayChapterByIndex clamps an out-of-range index to the last chapter', async function(){
  var r = await freshRender();
  r.project.chapters = [makeChap('c0'), makeChap('c1')];

  await r.displayChapterByIndex(99);

  assert.strictEqual(r.project.activeChapterIndex, 1);
  assert.strictEqual(r.editorQuill.getText().trim(), 'c1');
});

//The core editing loop: type in a chapter, look at a different one, come back. If this regresses,
//edits are silently lost the moment the writer glances at another chapter - about the worst
//possible failure mode for this app.
test('editing a chapter, viewing another, then returning shows the edit rather than the original text', async function(){
  var r = await freshRender();
  var c0 = makeChap('c0'), c1 = makeChap('c1');
  r.project.chapters = [c0, c1];
  await r.displayChapterByIndex(0);

  r.editorQuill.setText('edited content\n', 'user');
  assert.deepStrictEqual(c0.contents, r.editorQuill.getContents(), 'the edit should be stored on the chapter as it happens, not just left in the editor');
  assert.strictEqual(c0.hasUnsavedChanges, true);

  await r.displayChapterByIndex(1);
  assert.strictEqual(r.editorQuill.getText().trim(), 'c1');

  await r.displayChapterByIndex(0);
  assert.strictEqual(r.editorQuill.getText().trim(), 'edited content');
});

test('editing a chapter marks both the chapter and the project as having unsaved changes', async function(){
  var r = await freshRender();
  var c0 = makeChap('c0');
  r.project.chapters = [c0];
  await r.displayChapterByIndex(0);

  r.editorQuill.insertText(0, 'x', 'user');

  assert.strictEqual(c0.hasUnsavedChanges, true);
  assert.strictEqual(r.project.hasUnsavedChanges, true);
});

test('a programmatic content change (loading a chapter) does not mark it as having unsaved changes', async function(){
  var r = await freshRender();
  var c0 = makeChap('c0');
  r.project.chapters = [c0];

  await r.displayChapterByIndex(0);

  assert.strictEqual(c0.hasUnsavedChanges, false);
});

test('typing in the notes pane updates the active chapter\'s own notes while per-chapter notes are shown', async function(){
  var r = await freshRender();
  var c0 = makeChap('c0');
  r.project.chapters = [c0];
  r.userSettings.displayChapNotes = true;
  await r.displayChapterByIndex(0);

  r.notesQuill.setText('a note\n', 'user');

  assert.deepStrictEqual(c0.notes, r.notesQuill.getContents());
  assert.strictEqual(c0.hasUnsavedChanges, true);
});

test('typing in the notes pane updates the project-wide notes chapter while project notes are shown', async function(){
  var r = await freshRender();
  r.project.initNotesChap();
  r.userSettings.displayChapNotes = false;

  r.notesQuill.setText('a project note\n', 'user');

  assert.deepStrictEqual(r.project.notesChap.notes, r.notesQuill.getContents());
  assert.strictEqual(r.project.notesChap.hasUnsavedChanges, true);
});

test('displayChapterByIndex clears and disables the editor instead of throwing when chapters/reference/trash are all empty', async function(){
  var r = await freshRender();
  r.project.chapters = [];
  r.project.reference = [];
  r.project.trash = [];

  await assert.doesNotReject(function(){ return r.displayChapterByIndex(0); });

  assert.strictEqual(r.project.activeChapterIndex, 0);
  assert.strictEqual(r.editorQuill.getText(), '\n');
  assert.strictEqual(r.editorQuill.isEnabled(), false);
});

//---------------------------------------------------------------------------
// addNewChapter / addImportedChapter
//---------------------------------------------------------------------------

test('addNewChapter inserts a blank chapter right after the active one and selects it for renaming', async function(){
  var r = await freshRender();
  r.project.chapters = [makeChap('c0')];
  r.project.activeChapterIndex = 0;

  await r.addNewChapter();

  assert.strictEqual(r.project.chapters.length, 2);
  assert.strictEqual(r.project.activeChapterIndex, 1);
  assert.strictEqual(r.project.hasUnsavedChanges, true);
  assert.ok(document.querySelector('.name-box'), 'the new chapter should be immediately renameable');
});

test('addNewChapter with a Reference document active inserts into Reference and displays that new chapter, not an existing one', async function(){
  var r = await freshRender();
  r.project.chapters = [makeChap('c0'), makeChap('c1')];
  r.project.reference = [makeChap('r0'), makeChap('r1')];
  r.project.activeChapterIndex = 3; //r1, the last reference item

  await r.addNewChapter();

  assert.strictEqual(r.project.reference.length, 3);
  assert.strictEqual(r.project.reference[2].title, 'new');
  //Combined index: 2 chapters + 3rd (new) item in reference = 4, not reference's own array index (2).
  assert.strictEqual(r.project.activeChapterIndex, 4);
  var nameBox = document.querySelector('.name-box');
  assert.ok(nameBox, 'the newly inserted reference item should be the one selected for renaming');
});

test('addNewChapter with only a trashed chapter active appends the new chapter onto Chapters', async function(){
  var r = await freshRender();
  r.project.trash = [makeChap('t0')];
  r.project.activeChapterIndex = 0; //t0, the only thing in any list

  await r.addNewChapter();

  assert.strictEqual(r.project.chapters.length, 1);
  assert.strictEqual(r.project.chapters[0].title, 'new');
  assert.strictEqual(r.project.activeChapterIndex, 0);
  assert.strictEqual(r.editorQuill.getText().trim(), '');
});

test('addImportedChapter inserts the given delta right after the active chapter and displays it', async function(){
  var r = await freshRender();
  var c0 = makeChap('c0');
  r.project.chapters = [c0];
  r.project.activeChapterIndex = 0;

  await r.addImportedChapter({ ops: [{ insert: 'Imported\n' }] }, 'Imported Title');

  assert.strictEqual(r.project.chapters.length, 2);
  assert.strictEqual(r.project.chapters[1].title, 'Imported Title');
  assert.strictEqual(r.project.activeChapterIndex, 1);
  assert.strictEqual(r.editorQuill.getText().trim(), 'Imported');
});

test('addImportedChapter with a trashed chapter active appends onto Chapters and displays the import, not an unrelated trash item', async function(){
  var r = await freshRender();
  r.project.chapters = [makeChap('c0')];
  r.project.trash = [makeChap('t0')];
  r.project.activeChapterIndex = 1; //t0's combined index: chapters.length(1) + 0

  await r.addImportedChapter({ ops: [{ insert: 'Imported\n' }] }, 'Imported Title');

  assert.strictEqual(r.project.chapters.length, 2);
  assert.strictEqual(r.project.chapters[1].title, 'Imported Title');
  assert.strictEqual(r.project.activeChapterIndex, 1);
  assert.strictEqual(r.editorQuill.getText().trim(), 'Imported');
});

//---------------------------------------------------------------------------
// changeChapterTitle
//---------------------------------------------------------------------------

test('changeChapterTitle commits the new title and clears unsaved-rename state on Enter', async function(){
  var r = await freshRender();
  var c0 = makeChap('Old Title');
  r.project.chapters = [c0];
  r.updateFileList();

  r.changeChapterTitle(0);
  var nameBox = document.querySelector('.name-box');
  nameBox.value = 'New Title';
  nameBox.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));

  assert.strictEqual(c0.title, 'New Title');
  assert.strictEqual(c0.hasUnsavedChanges, true);
  assert.strictEqual(r.project.hasUnsavedChanges, true);
  assert.ok(!document.querySelector('.name-box'));
  assert.strictEqual(document.querySelector('#chapter-list li').textContent, 'New Title*');
});

test('changeChapterTitle discards the edit on Escape', async function(){
  var r = await freshRender();
  var c0 = makeChap('Old Title');
  r.project.chapters = [c0];
  r.updateFileList();

  r.changeChapterTitle(0);
  var nameBox = document.querySelector('.name-box');
  nameBox.value = 'Discarded';
  nameBox.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));

  assert.strictEqual(c0.title, 'Old Title');
  assert.ok(!document.querySelector('.name-box'));
});

//---------------------------------------------------------------------------
// editorHasFocus / editorIsVisible
//---------------------------------------------------------------------------

test('editorHasFocus is true only when the writing field is visible and the editor is focused', async function(){
  var r = await freshRender();
  var writingField = document.getElementById('writing-field');
  var qlEditor = document.querySelector('.ql-editor');

  writingField.classList.remove('visible');
  qlEditor.focus();
  assert.strictEqual(r.editorIsVisible(), false);
  assert.strictEqual(r.editorHasFocus(), false);

  writingField.classList.add('visible');
  assert.strictEqual(r.editorIsVisible(), true);
  assert.strictEqual(r.editorHasFocus(), true);
});

//---------------------------------------------------------------------------
// notesQuill text-change
//---------------------------------------------------------------------------

test('editing notes does not throw once every chapter has been permanently deleted', async function(){
  var r = await freshRender();
  r.project.chapters = [];
  r.project.reference = [];
  r.project.trash = [];
  r.userSettings.displayChapNotes = true;

  assert.doesNotThrow(function(){
    r.notesQuill.insertText(0, 'stray notes', 'user');
  });
});

//---------------------------------------------------------------------------
// document-level keydown handler
//---------------------------------------------------------------------------

test('Ctrl/Cmd+Left inside a text field is left for native cursor movement, not hijacked for pane-switching', async function(){
  await freshRender();
  var input = document.createElement('input');
  input.type = 'text';
  document.body.appendChild(input);

  var evt = new window.KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, bubbles: true, cancelable: true });
  var jsdomErr = dispatchAndCaptureJsdomErrors(input, evt);

  assert.strictEqual(jsdomErr, null, jsdomErr && jsdomErr.message);
  assert.strictEqual(evt.defaultPrevented, false);
});

test('Ctrl/Cmd+Left outside a text field still switches focus to the editor as before', async function(){
  await freshRender();
  document.getElementById('writing-field').classList.add('visible');

  var evt = new window.KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, bubbles: true, cancelable: true });
  var jsdomErr = dispatchAndCaptureJsdomErrors(document, evt);

  assert.strictEqual(jsdomErr, null, jsdomErr && jsdomErr.message);
  assert.strictEqual(evt.defaultPrevented, true);
});

test('increasing font size does not throw when no chapter is marked active in the sidebar', async function(){
  var r = await freshRender();
  r.project.chapters = [];
  r.project.reference = [];
  r.project.trash = [];
  r.updateFileList();

  var evt = new window.KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true });
  var jsdomErr = dispatchAndCaptureJsdomErrors(document, evt);

  assert.strictEqual(jsdomErr, null, jsdomErr && jsdomErr.message);
});

//---------------------------------------------------------------------------
// goPageDown (PageDown inside the editor)
//---------------------------------------------------------------------------

test('PageDown does not dereference bounds before checking whether getBounds found a position', async function(){
  var r = await freshRender();
  r.editorQuill.setText('only one line\n');
  r.editorQuill.setSelection(0);

  //Force the exact case that used to crash: getBounds() returning null, which it genuinely does
  //once the page-down search runs past the end of the content.
  var originalGetBounds = r.editorQuill.selection.getBounds.bind(r.editorQuill.selection);
  r.editorQuill.selection.getBounds = function(){
    r.editorQuill.selection.getBounds = originalGetBounds;
    return null;
  };

  var editorContainer = document.getElementById('editor-container');
  var evt = new window.KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true });
  var jsdomErr = dispatchAndCaptureJsdomErrors(editorContainer, evt);

  assert.strictEqual(jsdomErr, null, jsdomErr && jsdomErr.message);
  assert.strictEqual(r.editorQuill.getSelection().index, 0);
});

//---------------------------------------------------------------------------
// IPC menu commands
//---------------------------------------------------------------------------

//Every channel the main process's menu can send, per src/index.js. render.js used to register each
//with its own separate ipcRenderer.on(...) call - now they are entries in one table - so the risk
//this guards against is a channel string quietly mistyped or dropped from that table, which would
//silently disconnect a whole menu item with nothing else here to notice.
var ALL_MENU_CHANNELS = [
  'save-clicked', 'save-as-clicked', 'open-clicked', 'new-project-clicked', 'import-clicked',
  'export-clicked', 'properties-clicked', 'compile-clicked', 'word-count-clicked',
  'find-replace-clicked', 'spellcheck-clicked', 'convert-first-lines-clicked',
  'headings-to-chaps-clicked', 'convert-italics-clicked', 'split-chapter-clicked',
  'add-chapter-clicked', 'delete-chapter-clicked', 'restore-chapter-clicked', 'shortcuts-clicked',
  'outliner-clicked', 'convert-tabs-clicked', 'convert-substitutions-clicked',
  'about-clicked', 'exit-app-clicked', 'reboot-clicked',
  'save-copy-clicked', 'help-doc-clicked', 'renumber-chapters-clicked', 'send-via-email-clicked',
  'view-error-log-clicked', 'file-manager-clicked', 'wifi-manager-clicked', 'save-backup-clicked',
  'settings-clicked', 'corkboard-clicked', 'file-opened-from-outside-warewoolf',
  'tab-indent-paragraphs-clicked', 'center-all-heads-clicked', 'dictionaries-clicked'
];

//The bridge set up for the current freshRender() call - the same object render.js subscribed its
//event handlers to and invoked its commands through.
function currentBridge(){
  return globalThis.warewoolf;
}

function focusEditor(){
  document.getElementById('writing-field').classList.add('visible');
  document.querySelector('.ql-editor').focus();
}

test('every menu channel is registered exactly once, with none missing or unexpectedly added', async function(){
  await freshRender();

  assert.deepStrictEqual(Object.keys(currentBridge().handlers).sort(), ALL_MENU_CHANNELS.slice().sort());
});

test('a focus-gated command does nothing while the editor lacks focus, and runs once it has it', async function(){
  var r = await freshRender();
  r.project.chapters = [makeChap('c0')];
  r.project.activeChapterIndex = 0;

  document.getElementById('writing-field').classList.remove('visible');
  currentBridge().handlers['add-chapter-clicked']();
  assert.strictEqual(r.project.chapters.length, 1, 'add-chapter-clicked should not have run without focus');

  focusEditor();
  currentBridge().handlers['add-chapter-clicked']();
  assert.strictEqual(r.project.chapters.length, 2, 'add-chapter-clicked should run once the editor has focus');
});

//convert-tabs-clicked is project-wide, exactly like convert-first-lines-clicked and
//convert-italics-clicked, but (like renumber-chapters/tab-indent-paragraphs/center-all-heads) was
//never focus-gated - preserved as-is per the comment above the table in render.js.
test('a command with no focus guard runs regardless of where focus is', async function(){
  var r = await freshRender();
  //Empty project: showOutliner()'s project.chapters.forEach() then has nothing to iterate, so this
  //stays focused on proving the guard (or lack of one), not on outliner_display.js's own rendering.

  document.getElementById('writing-field').classList.remove('visible');

  assert.doesNotThrow(function(){
    currentBridge().handlers['outliner-clicked']();
  });
  assert.ok(document.querySelector('.popup-outliner'), 'outliner-clicked has no focus guard and should have run');
});

//jsdom's innerText does not create real text nodes, so document.textContent cannot see text set
//through it - these check the specific elements the two views set it on instead.
//
//Phase 9a: a handler is called with the payload alone. preload.js drops the IpcRendererEvent that
//used to arrive first, so these no longer pass a null in its place.
test('about-clicked forwards the app version it is sent to the About popup', async function(){
  await freshRender();

  currentBridge().handlers['about-clicked']('9.9.9');

  assert.strictEqual(document.querySelector('.about-version').innerText, '9.9.9');
});

//The keys are buttons now, since the popup is where they are changed as well as where they are
//listed - so the platform modifier is read off the buttons rather than the cells.
function shortcutKeyLabels(){
  return Array.from(document.querySelectorAll('.shortcuts-table button')).map(function(button){
    return button.textContent;
  });
}

test('shortcuts-clicked forwards isMac to render Mac- or Ctrl-style shortcut labels', async function(){
  await freshRender();

  currentBridge().handlers['shortcuts-clicked'](true);
  assert.ok(shortcutKeyLabels().some(function(label){ return label.includes('Cmd'); }));
  removeAllPopups();

  currentBridge().handlers['shortcuts-clicked'](false);
  assert.ok(shortcutKeyLabels().some(function(label){ return label.includes('Ctrl'); }));
});

//The popup is opened with the bindings actually in force, not with the defaults - a writer who has
//rebound something has to see what they rebound it to.
test('shortcuts-clicked shows the shortcuts a writer has saved, and saving from it stores the change', async function(){
  var r = await freshRender();

  currentBridge().handlers['shortcuts-clicked'](false);

  var boldRow = Array.from(document.querySelectorAll('.shortcuts-table tr')).find(function(row){
    return row.cells[0].innerText === 'Bold';
  });
  var boldButton = boldRow.cells[1].querySelector('button');
  assert.strictEqual(boldButton.textContent, 'Ctrl + B');

  boldButton.onclick();
  document.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'y', code: 'KeyY', ctrlKey: true, bubbles: true, cancelable: true
  }));

  Array.from(document.querySelectorAll('button')).find(function(button){
    return button.textContent === 'Save';
  }).onclick();

  assert.deepStrictEqual(r.userSettings.keyboardShortcuts, {
    formatBold: { key: 'Y', mod: true, alt: false, shift: false, code: 'KeyY' }
  });

  currentBridge().handlers['shortcuts-clicked'](false);
  var reopened = Array.from(document.querySelectorAll('.shortcuts-table tr')).find(function(row){
    return row.cells[0].innerText === 'Bold';
  });
  assert.strictEqual(reopened.cells[1].querySelector('button').textContent, 'Ctrl + Y');
  removeAllPopups();
});

function removeAllPopups(){
  Array.from(document.querySelectorAll('.popup')).forEach(function(p){ p.remove(); });
}

//---------------------------------------------------------------------------
// open-clicked / exit-app-clicked (proceedOrConfirmSave)
//---------------------------------------------------------------------------

test('open-clicked opens the file dialog directly when there are no unsaved changes', async function(){
  var r = await freshRender();
  r.project.hasUnsavedChanges = false;

  currentBridge().handlers['open-clicked']();
  //showFileDialog() is async now (its initial directory listing goes through the platform facade),
  //so the dialog is only appended to the DOM a tick later.
  await flushMicrotasks();

  assert.ok(document.querySelector('.popup-dialog'), 'the open dialog should appear with nothing to confirm first');
});

test('open-clicked asks to save first when there are unsaved changes, and does not open the dialog until answered', async function(){
  var r = await freshRender();
  r.project.hasUnsavedChanges = true;

  currentBridge().handlers['open-clicked']();

  assert.strictEqual(document.querySelector('.popup-dialog'), null, 'the open dialog should wait behind the confirmation');
  assert.ok(findButton('Continue Without Saving'), 'the unsaved-changes prompt should be showing instead');

  findButton('Continue Without Saving').onclick();
  await flushMicrotasks();
  assert.ok(document.querySelector('.popup-dialog'), 'answering the prompt should proceed to the open dialog');
});

test('exit-app-clicked quits directly when there are no unsaved changes', async function(){
  var r = await freshRender();
  r.project.hasUnsavedChanges = false;
  r.project.filename = ''; //no autoBackup path to route through

  currentBridge().handlers['exit-app-clicked']();
  await flushMicrotasks();

  assert.ok(currentBridge().invoked.includes('confirmExit'));
});

test('exit-app-clicked refreshes the sidebar and asks to save first when there are unsaved changes', async function(){
  var r = await freshRender();
  r.project.chapters = [makeChap('Unsaved', { hasUnsavedChanges: true })];
  r.project.hasUnsavedChanges = true;

  currentBridge().handlers['exit-app-clicked']();

  //The sidebar's unsaved-change marker reflects the current state before the prompt is shown.
  assert.strictEqual(document.querySelector('#chapter-list li').textContent, 'Unsaved*');
  assert.ok(findButton('Continue Without Saving'));
  assert.ok(!currentBridge().invoked.includes('confirmExit'), 'should not quit before the prompt is answered');

  findButton('Continue Without Saving').onclick();
  await flushMicrotasks();
  assert.ok(currentBridge().invoked.includes('confirmExit'));
});

//reboot-clicked is only ever sent on Linux (index.js gates the menu item), but render.js subscribes
//to it everywhere, so these run on any machine: what they check is that the channel routes through
//the same unsaved-work prompt Exit does before anything reaches the platform. Whether the command
//then finds a systemctl is platform-node.js's business, covered in platform.test.js.
test('reboot-clicked reboots directly when there are no unsaved changes', async function(){
  var r = await freshRender();
  r.project.hasUnsavedChanges = false;
  r.project.filename = ''; //no autoBackup path to route through

  currentBridge().handlers['reboot-clicked']();
  await flushMicrotasks();

  assert.ok(currentBridge().invoked.includes('rebootSystem'));
});

test('reboot-clicked asks to save first when there are unsaved changes', async function(){
  var r = await freshRender();
  r.project.chapters = [makeChap('Unsaved', { hasUnsavedChanges: true })];
  r.project.hasUnsavedChanges = true;

  currentBridge().handlers['reboot-clicked']();

  assert.ok(findButton('Continue Without Saving'));
  assert.ok(!currentBridge().invoked.includes('rebootSystem'),
    'should not take the machine down before the prompt is answered');

  findButton('Continue Without Saving').onclick();
  await flushMicrotasks();
  assert.ok(currentBridge().invoked.includes('rebootSystem'));
});

//---------------------------------------------------------------------------
// Global keydown shortcuts (document-level handler)
//---------------------------------------------------------------------------
// Characterization tests for src/render.js's keyboard dispatch, written before it is extracted
// into its own controller - these pin today's real, observable behavior so the extraction can be
// checked against them rather than against a re-reading of the old code.

function ctrlKeydown(key, extra){
  var opts = Object.assign({ key: key, ctrlKey: true, bubbles: true, cancelable: true }, extra || {});
  return new window.KeyboardEvent('keydown', opts);
}

test('Ctrl/Cmd+Right moves focus to notes only while the notes pane is visible', async function(){
  var r = await freshRender();
  document.getElementById('project-notes').classList.remove('visible');

  var evt1 = ctrlKeydown('ArrowRight');
  var err1 = dispatchAndCaptureJsdomErrors(document, evt1);
  assert.strictEqual(err1, null, err1 && err1.message);
  assert.notStrictEqual(document.activeElement, r.notesQuill.root, 'should not focus notes while its pane is hidden');
  assert.strictEqual(evt1.defaultPrevented, true, 'should still consume the key even when hidden');

  document.getElementById('project-notes').classList.add('visible');
  var evt2 = ctrlKeydown('ArrowRight');
  dispatchAndCaptureJsdomErrors(document, evt2);
  assert.strictEqual(document.activeElement, r.notesQuill.root);
});

test('Escape closes popups, exits search view, and refreshes the panel layout', async function(){
  var r = await freshRender();
  var popup = document.createElement('div');
  popup.className = 'popup';
  document.body.appendChild(popup);
  var dialog = document.createElement('div');
  dialog.className = 'popup-dialog';
  document.body.appendChild(dialog);
  document.getElementById('chapter-list-sidebar').classList.add('sidebar-search-view');
  document.getElementById('project-notes').classList.add('sidebar-search-view');
  document.getElementById('writing-field').classList.add('writing-field-search-view');

  var evt = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  var err = dispatchAndCaptureJsdomErrors(document, evt);

  assert.strictEqual(err, null, err && err.message);
  assert.strictEqual(document.querySelector('.popup'), null);
  assert.strictEqual(document.querySelector('.popup-dialog'), null);
  assert.strictEqual(document.getElementById('chapter-list-sidebar').classList.contains('sidebar-search-view'), false);
  //Proof updatePanelDisplays() ran: with all three of userSettings' display flags at their
  //default (true), the sidebar should be marked visible again.
  assert.strictEqual(document.getElementById('chapter-list-sidebar').classList.contains('visible'), true);
});

test('Ctrl/Cmd+= and Ctrl/Cmd+- change the font size setting in opposite directions', async function(){
  var r = await freshRender();
  var startSize = r.userSettings.fontSize;

  dispatchAndCaptureJsdomErrors(document, ctrlKeydown('='));
  assert.strictEqual(r.userSettings.fontSize, startSize + 1);

  dispatchAndCaptureJsdomErrors(document, ctrlKeydown('-'));
  dispatchAndCaptureJsdomErrors(document, ctrlKeydown('-'));
  assert.strictEqual(r.userSettings.fontSize, startSize - 1);
});

test('decreasing font size does not throw when no chapter is marked active in the sidebar', async function(){
  var r = await freshRender();
  r.project.chapters = [];
  r.project.reference = [];
  r.project.trash = [];
  r.updateFileList();

  var err = dispatchAndCaptureJsdomErrors(document, ctrlKeydown('-'));
  assert.strictEqual(err, null, err && err.message);
});

test('Ctrl/Cmd+Alt+T toggles typewriter mode on and back off, persisting the setting each time', async function(){
  var r = await freshRender();
  assert.strictEqual(r.userSettings.typewriterMode, false);

  dispatchAndCaptureJsdomErrors(document, ctrlKeydown('t', { altKey: true }));
  assert.strictEqual(r.userSettings.typewriterMode, true);
  assert.ok(r.editorQuill.__typewriterHandler, 'enabling should attach the scroll handler');

  dispatchAndCaptureJsdomErrors(document, ctrlKeydown('t', { altKey: true }));
  assert.strictEqual(r.userSettings.typewriterMode, false);
  assert.strictEqual(r.editorQuill.__typewriterHandler, undefined, 'disabling should remove the scroll handler');
});

test('Ctrl/Cmd+M asks the main process to show the menu', async function(){
  await freshRender();

  dispatchAndCaptureJsdomErrors(document, ctrlKeydown('m'));
  await flushMicrotasks();

  assert.ok(currentBridge().invoked.includes('showAppMenu'));
});

test('F1 toggles the chapter list pane, F2 (unmodified) toggles the editor pane', async function(){
  var r = await freshRender();
  assert.strictEqual(r.userSettings.displayChapList, true);
  assert.strictEqual(r.userSettings.displayEditor, true);

  dispatchAndCaptureJsdomErrors(document, new window.KeyboardEvent('keydown', { key: 'F1', bubbles: true, cancelable: true }));
  assert.strictEqual(r.userSettings.displayChapList, false);
  assert.strictEqual(document.getElementById('chapter-list-sidebar').classList.contains('visible'), false);

  dispatchAndCaptureJsdomErrors(document, new window.KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
  assert.strictEqual(r.userSettings.displayEditor, false);
});

test('Ctrl/Cmd+F2 does not toggle the editor pane - F2 only responds unmodified', async function(){
  var r = await freshRender();

  dispatchAndCaptureJsdomErrors(document, ctrlKeydown('F2'));

  assert.strictEqual(r.userSettings.displayEditor, true, 'Ctrl+F2 should not match the plain-F2 branch');
});

test('Ctrl/Cmd+F3 toggles whether notes are per-chapter or project-wide; bare F3 toggles the notes pane', async function(){
  var r = await freshRender();
  //A fresh test project's notesChap starts as {} until initNotesChap() gives it a real
  //chapter.js model - toggleChapterNotes()'s project-wide branch needs that to read notes from.
  r.project.initNotesChap();
  assert.strictEqual(r.userSettings.displayChapNotes, true);
  assert.strictEqual(r.userSettings.displayNotes, true);

  var err1 = dispatchAndCaptureJsdomErrors(document, ctrlKeydown('F3'));
  //The notes redraw reads a chapter's notes off disk through the platform facade now, so the header
  //only changes a tick after the keydown a listener's return value is thrown away.
  await flushMicrotasks();
  assert.strictEqual(err1, null, err1 && err1.message);
  assert.strictEqual(r.userSettings.displayChapNotes, false);
  assert.strictEqual(document.getElementById('notes-header').innerText, 'Project Notes');

  var err2 = dispatchAndCaptureJsdomErrors(document, new window.KeyboardEvent('keydown', { key: 'F3', bubbles: true, cancelable: true }));
  assert.strictEqual(err2, null, err2 && err2.message);
  assert.strictEqual(r.userSettings.displayNotes, false);
});

test('toggling back to per-chapter notes loads the active chapter\'s own notes, not the project-wide ones', async function(){
  var r = await freshRender();
  r.project.initNotesChap();
  var c0 = makeChap('c0', { contents: { ops: [{ insert: 'c0 body\n' }] } });
  c0.notes = { ops: [{ insert: 'c0 own notes\n' }] };
  r.project.chapters = [c0];
  r.project.activeChapterIndex = 0;

  //One toggle away, then back - lands on the branch of refreshNotesDisplay() that had no
  //coverage at all before this test (only the project-wide 'else' branch did).
  dispatchAndCaptureJsdomErrors(document, ctrlKeydown('F3'));
  await flushMicrotasks();
  var err = dispatchAndCaptureJsdomErrors(document, ctrlKeydown('F3'));
  await flushMicrotasks();

  assert.strictEqual(err, null, err && err.message);
  assert.strictEqual(r.userSettings.displayChapNotes, true);
  assert.strictEqual(document.getElementById('notes-header').innerText, 'Chapter Notes');
  assert.strictEqual(r.notesQuill.getText().trim(), 'c0 own notes');
});

//---------------------------------------------------------------------------
// Per-pane keydown shortcuts (editorControlEvents, bound to three elements)
//---------------------------------------------------------------------------

function paneKeydown(elementId, key, extra){
  var el = document.getElementById(elementId);
  var evt = new window.KeyboardEvent('keydown', Object.assign(
    { key: key, ctrlKey: true, bubbles: true, cancelable: true }, extra || {}
  ));
  el.dispatchEvent(evt);
  return evt;
}

test('Ctrl/Cmd+Shift+Up and +Down reorder the active chapter', async function(){
  var r = await freshRender();
  var c0 = makeChap('c0'), c1 = makeChap('c1');
  r.project.chapters = [c0, c1];
  r.project.activeChapterIndex = 1;

  paneKeydown('editor-container', 'ArrowUp', { shiftKey: true });
  assert.deepStrictEqual(r.project.chapters, [c1, c0]);
  assert.strictEqual(r.project.activeChapterIndex, 0);

  paneKeydown('editor-container', 'ArrowDown', { shiftKey: true });
  assert.deepStrictEqual(r.project.chapters, [c0, c1]);
  assert.strictEqual(r.project.activeChapterIndex, 1);
});

test('Ctrl/Cmd+Shift+Left renames the active chapter, but only while the sidebar is visible', async function(){
  var r = await freshRender();
  r.project.chapters = [makeChap('c0')];
  r.updateFileList();

  document.getElementById('chapter-list-sidebar').classList.remove('visible');
  paneKeydown('chapter-list-sidebar', 'ArrowLeft', { shiftKey: true });
  assert.strictEqual(document.querySelector('.name-box'), null, 'should not open the rename box while the sidebar is hidden');

  document.getElementById('chapter-list-sidebar').classList.add('visible');
  paneKeydown('chapter-list-sidebar', 'ArrowLeft', { shiftKey: true });
  assert.ok(document.querySelector('.name-box'));
});

test('Ctrl/Cmd+Up and +Down move between chapters, focusing notes only when triggered from the notes pane', async function(){
  var r = await freshRender();
  r.project.chapters = [makeChap('c0'), makeChap('c1')];
  r.project.activeChapterIndex = 1;

  paneKeydown('editor-container', 'ArrowUp');
  assert.strictEqual(r.project.activeChapterIndex, 0);
  assert.notStrictEqual(document.activeElement, r.notesQuill.root, 'triggered from the editor - notes should not steal focus');

  paneKeydown('notes-editor', 'ArrowDown');
  assert.strictEqual(r.project.activeChapterIndex, 1);
  assert.strictEqual(document.activeElement, r.notesQuill.root, 'triggered from notes - focus should stay there');
});

test('Ctrl/Cmd+, and Ctrl/Cmd+. shrink and grow the editor width setting', async function(){
  var r = await freshRender();
  var startWidth = r.userSettings.editorWidth;

  paneKeydown('editor-container', ',');
  assert.strictEqual(r.userSettings.editorWidth, startWidth - 1);

  paneKeydown('editor-container', '.');
  paneKeydown('editor-container', '.');
  assert.strictEqual(r.userSettings.editorWidth, startWidth + 1);
});

test('PageDown in the notes pane pages down notesQuill rather than editorQuill', async function(){
  var r = await freshRender();
  r.notesQuill.setText('only one line\n');
  r.notesQuill.setSelection(0);

  //Same D7 null-bounds case as the editor-container PageDown test above, applied to notesQuill,
  //to prove the currentTarget-based routing (not just the underlying page-down math) is preserved.
  var originalGetBounds = r.notesQuill.selection.getBounds.bind(r.notesQuill.selection);
  r.notesQuill.selection.getBounds = function(){
    r.notesQuill.selection.getBounds = originalGetBounds;
    return null;
  };

  var evt = new window.KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true });
  var err = dispatchAndCaptureJsdomErrors(document.getElementById('notes-editor'), evt);

  assert.strictEqual(err, null, err && err.message);
  assert.strictEqual(r.notesQuill.getSelection().index, 0);
});

//---------------------------------------------------------------------------
// restoreFromTrash
//---------------------------------------------------------------------------

test('restoreFromTrash follows the restored chapter to its new place in the list', async function(){
  var r = await freshRender();
  var A = makeChap('A'), B = makeChap('B'), R = makeChap('R');
  var T1 = makeChap('T1'), T2 = makeChap('T2');
  r.project.chapters = [A, B];
  r.project.reference = [R];
  r.project.trash = [T1, T2];
  await r.displayChapterByIndex(4); //T2

  await r.restoreFromTrash(4);

  //T2 is now the last chapter, so its combined index is 2 - not the 4 it was restored from, which
  //by then names T1 (chapters A,B,T2 | reference R | trash T1).
  assert.deepStrictEqual(r.project.chapters.map(function(c){ return c.title; }), ['A', 'B', 'T2']);
  assert.strictEqual(r.project.activeChapterIndex, 2);
  var active = document.querySelector('.activeChapter');
  assert.strictEqual(active && active.textContent, 'T2');
});

//The reason the index above matters: activeChapterIndex is what the editor's text-change handler
//routes a keystroke through. Left pointing at the wrong document, the text on screen was written
//into a chapter the reader never opened, and saved over its file.
test('typing after a restore edits the restored chapter, not the one that took its index', async function(){
  var r = await freshRender();
  var A = makeChap('A'), T1 = makeChap('T1', { text: 'T1 body' }), T2 = makeChap('T2', { text: 'T2 body' });
  r.project.chapters = [A];
  r.project.reference = [makeChap('R')];
  r.project.trash = [T1, T2];
  await r.displayChapterByIndex(3); //T2

  await r.restoreFromTrash(3);
  r.editorQuill.insertText(0, 'X', 'user');

  assert.strictEqual(T1.hasUnsavedChanges, false, 'T1 was never opened and must stay untouched');
  assert.ok(!T1.contents || JSON.stringify(T1.contents).indexOf('T2 body') === -1,
    'T2 text leaked into T1: ' + JSON.stringify(T1.contents));
  assert.strictEqual(T2.hasUnsavedChanges, true);
  assert.match(JSON.stringify(T2.contents), /XT2 body/);
});

test('restoreFromTrash keeps a different active chapter pointing at the same document', async function(){
  var r = await freshRender();
  var A = makeChap('A'), R = makeChap('R'), T1 = makeChap('T1');
  r.project.chapters = [A];
  r.project.reference = [R];
  r.project.trash = [T1];
  await r.displayChapterByIndex(1); //R, the reference doc

  await r.restoreFromTrash(2); //restore T1 while R is the active document

  //T1 joins the chapters list ahead of R, pushing R's combined index from 1 to 2.
  assert.strictEqual(r.project.activeChapterIndex, 2);
  var active = document.querySelector('.activeChapter');
  assert.strictEqual(active && active.textContent, 'R');
});

test('restoreFromTrash ignores an index that is not in the trash', async function(){
  var r = await freshRender();
  r.project.chapters = [makeChap('A')];
  r.project.trash = [];
  r.project.activeChapterIndex = 0;

  await r.restoreFromTrash(0);

  assert.deepStrictEqual(r.project.chapters.map(function(c){ return c.title; }), ['A']);
  assert.strictEqual(r.project.activeChapterIndex, 0);
});

//---------------------------------------------------------------------------
// editor enable/disable across projects
//---------------------------------------------------------------------------

//Emptying a project disables the editor; nothing on the load path used to switch it back on, so
//opening a project that did have chapters left the reader unable to type into it.
test('displaying a chapter re-enables an editor that an emptied project disabled', async function(){
  var r = await freshRender();
  r.project.chapters = [makeChap('only')];
  r.project.activeChapterIndex = 0;
  r.updateFileList();

  await r.moveToTrash(0);
  await r.deleteChapter(0);
  assert.strictEqual(r.editorQuill.isEnabled(), false, 'nothing left to edit');

  //As displayProject() would after opening another project.
  r.project.chapters = [makeChap('fresh')];
  r.project.activeChapterIndex = 0;
  await r.displayChapterByIndex(0);

  assert.strictEqual(r.editorQuill.isEnabled(), true);
});

test('the editor stays disabled while the project has nothing in any list', async function(){
  var r = await freshRender();
  r.project.chapters = [];
  r.project.reference = [];
  r.project.trash = [];

  await r.displayChapterByIndex(0);

  assert.strictEqual(r.editorQuill.isEnabled(), false);
});

//The notes handler has always been guarded this way; the editor's was not.
test('a user edit with no chapter to attach it to is dropped rather than throwing', async function(){
  var r = await freshRender();
  r.project.chapters = [];
  r.project.reference = [];
  r.project.trash = [];
  r.updateFileList();

  r.editorQuill.enable();
  assert.doesNotThrow(function(){
    r.editorQuill.insertText(0, 'hello', 'user');
  });
});

//---------------------------------------------------------------------------
// opening a project file that cannot be read
//---------------------------------------------------------------------------

//Same as freshRender(), but hands back the fake ipcRenderer as well and leaves any popup in place,
//so these tests can check what render.js registered and what it put on screen.
async function renderWithLastProject(lastProject){
  fs.writeFileSync(path.join(userDataDir, 'user-settings.json'),
    JSON.stringify({ lastProject: lastProject }), 'utf8');

  if(previousKeybindingsTeardown)
    previousKeybindingsTeardown();

  delete require.cache[renderPath];
  delete require.cache[keybindingsPath];
  var bridge = makeBridge();
  globalThis.warewoolf = bridge;

  var thrown = null;
  var mod = null;
  try{
    mod = require(renderPath);
    await mod.ready;
  }
  catch(err){
    thrown = err;
  }
  if(mod)
    previousKeybindingsTeardown = mod._unregisterKeybindings;

  return { module: mod, bridge: bridge, thrown: thrown };
}

function writeDamagedProject(name){
  var projPath = path.join(userDataDir, name);
  //What a .woolf looks like after the machine loses power part-way through writing it.
  fs.writeFileSync(projPath, '{\n\t"title": "My Novel",\n\t"chapters": [', 'utf8');
  return projPath;
}

//A damaged project file used to throw out of loadInitialProject() at require-time, which aborted
//render.js before it reached any of its ipcRenderer.on registrations - including exit-app-clicked,
//the one index.js's close guard blocks every window close waiting for.
test('a damaged lastProject does not stop render.js from loading', async function(){
  var loaded = await renderWithLastProject(writeDamagedProject('damaged.woolf'));

  assert.strictEqual(loaded.thrown, null,
    'render.js threw at startup: ' + (loaded.thrown && loaded.thrown.message));
});

test('a damaged lastProject still leaves the exit handler registered, so the window can close', async function(){
  var loaded = await renderWithLastProject(writeDamagedProject('damaged.woolf'));

  assert.ok(loaded.bridge.handlers['exit-app-clicked'],
    'without this handler index.js never lets the window close');
  assert.ok(loaded.bridge.handlers['open-clicked'], 'the rest of the menu works too');
});

//index.js's close guard only hands a window close to the renderer once this has arrived; without
//it the guard closes the window itself rather than waiting on a renderer that may not be there.
test('the renderer reports itself ready once its handlers are registered', async function(){
  var loaded = await renderWithLastProject(writeDamagedProject('damaged.woolf'));

  assert.ok(loaded.bridge.invoked.indexOf('notifyRendererReady') > -1,
    'invoked: ' + JSON.stringify(loaded.bridge.invoked));
});

test('a damaged lastProject tells the reader which file failed', async function(){
  var projPath = writeDamagedProject('damaged.woolf');
  await renderWithLastProject(projPath);

  var popup = document.querySelector('.popup');
  assert.ok(popup, 'a popup explains the failure');

  //jsdom does not derive textContent from innerText assignments, so each element is read the way
  //it was written - same as missing-pups_display.test.js does.
  var headings = Array.from(popup.querySelectorAll('h1')).map(function(h){ return h.innerText; });
  assert.ok(headings.some(function(h){ return /could not be read/i.test(h || ''); }),
    'headings were: ' + JSON.stringify(headings));

  var paragraphs = Array.from(popup.querySelectorAll('p')).map(function(el){ return el.innerText; });
  assert.ok(paragraphs.some(function(t){ return (t || '').indexOf(path.basename(projPath)) > -1; }),
    'the failing file is named');
  assert.ok(paragraphs.some(function(t){ return /have not been touched/i.test(t || ''); }),
    'the reader is told their chapters are safe');
});

test('a damaged lastProject leaves an empty but working project rather than a half-loaded one', async function(){
  var loaded = await renderWithLastProject(writeDamagedProject('damaged.woolf'));
  var r = loaded.module;

  //render.js swaps in a fresh project on failure, so this is the new one, not the module's
  //originally exported object.
  assert.deepStrictEqual(r.project.chapters, []);
  //A blank project still needs its notes chapter, or the notes pane throws the moment it refreshes.
  assert.strictEqual(typeof r.project.notesChap.getNotesContentOrFile, 'function');

  //And the app is usable from there: adding a chapter works and turns the editor back on.
  Array.from(document.querySelectorAll('.popup')).forEach(function(p){ p.remove(); });
  await r.addNewChapter();
  assert.strictEqual(r.editorQuill.isEnabled(), true);
});

//---------------------------------------------------------------------------
// Help doc (read-only)
//---------------------------------------------------------------------------

//Writes a bundled Help doc into a stand-in install directory and points appDir at it for the
//duration of the test, exactly as a packaged build would lay it out.
function withBundledHelpDoc(t, contents){
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-install-'));
  const helpDir = path.join(installDir, 'examples', 'HelpDoc');
  fs.mkdirSync(helpDir, { recursive: true });
  const helpDocPath = path.join(helpDir, 'HelpDoc.woolf');
  fs.writeFileSync(helpDocPath, JSON.stringify(contents || {
    title: 'WareWoolf Help', author: '', chapsDirectory: '',
    chapters: [], reference: [], trash: []
  }), 'utf8');

  const previousAppDir = appDir;
  //index.js hands the renderer forward-slash paths on every platform, so match that here.
  appDir = installDir.split(path.sep).join('/');
  t.after(function(){
    appDir = previousAppDir;
    fs.rmSync(installDir, { recursive: true, force: true });
  });

  return { installDir: installDir, helpDocPath: helpDocPath };
}

//The whole point of opening it in place: a copy taken once and reused forever would go stale the
//first time a release updated the Help doc, and nobody who had already launched the app would ever
//see the new one.
test('the Help doc opens from the install directory rather than being copied to userData', async function(t){
  const bundled = withBundledHelpDoc(t);
  var r = await freshRender();

  //Awaited: opening a project reads it through the platform facade now, so the menu handler returns
  //before the project is loaded.
  await currentBridge().handlers['help-doc-clicked']();

  assert.strictEqual(r.project.title, 'WareWoolf Help');
  assert.strictEqual(fs.existsSync(path.join(userDataDir, 'Projects', 'HelpDoc')), false,
    'no copy of the Help doc should be made under userData');
});

test('a Help doc opened from the read-only install directory is marked read-only', async function(t){
  withBundledHelpDoc(t);
  var r = await freshRender();

  //Awaited: opening a project reads it through the platform facade now, so the menu handler returns
  //before the project is loaded.
  await currentBridge().handlers['help-doc-clicked']();

  assert.strictEqual(r.project.isReadOnly, true);
  assert.ok(/\(read-only\)/.test(document.title),
    'the title bar should say so, since Ctrl+S behaves differently: ' + document.title);
});

//Saving in place would fail with EACCES on a real install and be swallowed, losing whatever the
//reader typed. Save As gives their annotated copy a home they picked instead.
test('saving an open Help doc offers Save As instead of writing to the install directory', async function(t){
  const bundled = withBundledHelpDoc(t);
  const before = fs.readFileSync(bundled.helpDocPath, 'utf8');
  var r = await freshRender();
  //Awaited: opening a project reads it through the platform facade now, so the menu handler returns
  //before the project is loaded.
  await currentBridge().handlers['help-doc-clicked']();
  Array.from(document.querySelectorAll('.popup, .popup-dialog')).forEach(function(p){ p.remove(); });

  await currentBridge().handlers['save-clicked']();
  //saveProjectAs() doesn't await showFileDialog() (deliberately - see its own comment), and
  //showFileDialog() is itself async now, so the dialog is appended to the DOM a tick after
  //save-clicked's own handler resolves.
  await flushMicrotasks();

  assert.ok(document.querySelector('.popup-dialog'),
    'a Save As dialog should have opened');
  assert.strictEqual(fs.readFileSync(bundled.helpDocPath, 'utf8'), before,
    'the bundled Help doc must be left untouched');
});

//Opening anything else afterwards has to come back writable, or every later save would silently
//do nothing.
test('opening an ordinary project after the Help doc clears the read-only flag', async function(t){
  withBundledHelpDoc(t);
  var r = await freshRender();
  //Awaited: opening a project reads it through the platform facade now, so the menu handler returns
  //before the project is loaded.
  await currentBridge().handlers['help-doc-clicked']();
  assert.strictEqual(r.project.isReadOnly, true);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-ordinary-')) + path.sep;
  t.after(function(){ fs.rmSync(dir, { recursive: true, force: true }); });
  fs.writeFileSync(dir + 'p.woolf', JSON.stringify({
    title: 'Ordinary', author: '', chapsDirectory: '', chapters: [], reference: [], trash: []
  }), 'utf8');

  await r.project.loadFile(dir + 'p.woolf');

  assert.strictEqual(r.project.isReadOnly, false);
  assert.strictEqual(await r.project.saveFile(), true);
});

//---------------------------------------------------------------------------
// startup failure
//---------------------------------------------------------------------------

//loadPlatformState() had no rejection handler at all, so any failure inside it - and every part of
//startup runs inside it - produced an unhandled rejection and a blank window: two empty editors, no
//keybindings, no menu, and nothing on screen saying why. platform.js's rule 5 is that failure is
//loud, and this was the loudest place in the app for it not to be.
function failBootAt(t, command, err){
  bootFailure = { command: command, error: err };
  t.after(function(){ bootFailure = null; });
}

//Deliberately not freshRender(): that awaits mod.ready, which is exactly the promise under test.
function bootRender(){
  if(previousKeybindingsTeardown){
    previousKeybindingsTeardown();
    previousKeybindingsTeardown = null;
  }

  delete require.cache[renderPath];
  delete require.cache[keybindingsPath];
  globalThis.warewoolf = makeBridge();
  return require(renderPath);
}

//jsdom's innerText only reads back what was assigned through innerText itself - textContent stays
//empty for it - so the popup's text has to be gathered element by element rather than off the
//container. Same gap missing-pups_display.test.js documents.
function popupText(){
  var popup = document.querySelector('.popup');
  if(!popup)
    return null;

  return Array.from(popup.querySelectorAll('*')).map(function(el){
    return el.innerText || '';
  }).join(' ');
}

test('a boot failure tells the reader instead of leaving a blank window', async function(t){
  failBootAt(t, 'getAppPaths', new Error('no paths for you'));

  var mod = bootRender();
  await assert.rejects(function(){ return mod.ready; }, /no paths for you/);

  var text = popupText();
  assert.ok(text != null, 'a startup failure must put something on screen');
  assert.match(text, /Could Not Start/);
  assert.match(text, /no paths for you/, 'the reader is told what actually failed');
});

//The rejection has to stay a rejection. Swallowing it would make `ready` resolve, and every test in
//this file that awaits it would then go on to read a half-built module as though startup had
//succeeded.
test('a boot failure still rejects ready rather than resolving with a half-built module', async function(t){
  failBootAt(t, 'getFileRequestedOnOpen', new Error('boom'));

  var mod = bootRender();

  await assert.rejects(function(){ return mod.ready; }, /boom/);
  assert.strictEqual(mod.project, undefined,
    'nothing after the failure should have been assigned onto the exports');
});

//A failure this late has already built the platform instances, so error-log.js has somewhere to
//write - the popup is the part that must not depend on any of it.
test('a boot failure after the platform is up is reported the same way', async function(t){
  failBootAt(t, 'notifyRendererReady', new Error('never reported in'));

  var mod = bootRender();
  await assert.rejects(function(){ return mod.ready; }, /never reported in/);

  assert.match(popupText(), /never reported in/);
});

//The popup renders a PlatformError's stable code, which is the part a reader can search for and the
//part that survives an IPC boundary - see platform.js.
test('a rejected platform command shows its code alongside the message', async function(t){
  const { PlatformError, CODES } = require('../src/components/controllers/platform');
  failBootAt(t, 'getAppPaths', PlatformError(CODES.UNAVAILABLE, 'main process said no'));

  var mod = bootRender();
  await assert.rejects(function(){ return mod.ready; });

  assert.match(popupText(), /UNAVAILABLE: main process said no/);
});

//---------------------------------------------------------------------------
// The bundled Frankenstein example
//---------------------------------------------------------------------------

//Lays out a bundled example inside a stand-in install directory, exactly as a packaged build would.
function withBundledExample(t){
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-install-example-'));
  const exampleDir = path.join(installDir, 'examples', 'Frankenstein');
  fs.mkdirSync(path.join(exampleDir, 'Frankenstein_chapters'), { recursive: true });
  fs.writeFileSync(path.join(exampleDir, 'Frankenstein.woolf'), JSON.stringify({
    title: 'Frankenstein', author: 'Mary Shelley', chapsDirectory: 'Frankenstein_chapters/',
    chapters: [], reference: [], trash: []
  }), 'utf8');

  const previousAppDir = appDir;
  //index.js hands the renderer forward-slash paths on every platform, so match that here.
  appDir = installDir.split(path.sep).join('/');
  t.after(function(){
    appDir = previousAppDir;
    fs.rmSync(installDir, { recursive: true, force: true });
    fs.rmSync(path.join(userDataDir, 'Projects'), { recursive: true, force: true });
  });

  return { installDir: installDir, exampleDir: exampleDir };
}

test('the bundled example is copied out to userData on first launch and opened from there', async function(t){
  withBundledExample(t);

  var r = await freshRender();

  assert.strictEqual(r.project.title, 'Frankenstein');
  assert.ok(fs.existsSync(path.join(userDataDir, 'Projects', 'Frankenstein', 'Frankenstein.woolf')),
    'the example should have been copied somewhere the reader can actually write to');
  assert.strictEqual(r.project.isReadOnly, false);
});

//The open finding this closes. The copy out of the install directory can fail - userData itself
//unwritable, a full disk - and the fallback opens the bundled original instead, which is read-only.
//That used to be indistinguishable from a writable copy, so every later save died with EACCES in
//silence: exactly the failure that started this whole exercise.
test('an example that could not be copied out is opened read-only rather than silently unsaveable', async function(t){
  withBundledExample(t);
  const realCpSync = fs.cpSync;
  fs.cpSync = function(){
    const err = new Error('permission denied');
    err.code = 'EACCES';
    throw err;
  };
  t.after(function(){ fs.cpSync = realCpSync; });

  var r = await freshRender();

  assert.strictEqual(r.project.title, 'Frankenstein', 'something is still opened rather than nothing');
  assert.strictEqual(r.project.isReadOnly, true,
    'the caller has to be able to tell this copy apart from a writable one');
  assert.ok(/\(read-only\)/.test(document.title),
    'the title bar should say so, since Ctrl+S behaves differently: ' + document.title);
  assert.strictEqual(await r.project.saveFile(), false);
});

//Ctrl+S on the read-only fallback has to reach the same Save As the Help doc gets, rather than
//failing into the log.
test('saving the read-only example fallback offers Save As instead of writing to the install directory', async function(t){
  const bundled = withBundledExample(t);
  const before = fs.readFileSync(path.join(bundled.exampleDir, 'Frankenstein.woolf'), 'utf8');
  const realCpSync = fs.cpSync;
  fs.cpSync = function(){ throw new Error('nope'); };
  t.after(function(){ fs.cpSync = realCpSync; });

  await freshRender();
  Array.from(document.querySelectorAll('.popup, .popup-dialog')).forEach(function(p){ p.remove(); });

  await currentBridge().handlers['save-clicked']();
  //saveProjectAs() doesn't await showFileDialog() (deliberately - see its own comment), and
  //showFileDialog() is itself async now, so the dialog is appended to the DOM a tick after
  //save-clicked's own handler resolves.
  await flushMicrotasks();

  assert.ok(document.querySelector('.popup-dialog'), 'a Save As dialog should have opened');
  assert.strictEqual(fs.readFileSync(path.join(bundled.exampleDir, 'Frankenstein.woolf'), 'utf8'), before,
    'the bundled example must be left untouched');
});

//The read-only guard in project.saveFile() does not cover convertLegacyProject(): its two
//conversions write through chapter.js, not through the project. Without its own guard, opening a
//legacy project out of the install directory attempts a write per legacy item, each one an EACCES
//swallowed into the log - and, worse, each one a write attempted against the installed app.
test('a read-only legacy project is not converted, so nothing is written into the install directory', async function(t){
  const bundled = withBundledExample(t);
  //v2.1 and earlier kept project notes on the project itself; convertLegacyProject() moves them
  //onto the notes chapter and saves that chapter's file.
  fs.writeFileSync(path.join(bundled.exampleDir, 'Frankenstein.woolf'), JSON.stringify({
    title: 'Frankenstein', author: 'Mary Shelley', chapsDirectory: 'Frankenstein_chapters/',
    chapters: [], reference: [], trash: [],
    notes: { ops: [{ insert: 'legacy project notes\n' }] }
  }), 'utf8');

  const realCpSync = fs.cpSync;
  fs.cpSync = function(){ throw new Error('nope'); };
  t.after(function(){ fs.cpSync = realCpSync; });

  var r = await freshRender();

  assert.strictEqual(r.project.isReadOnly, true);
  assert.deepStrictEqual(
    fs.readdirSync(path.join(bundled.exampleDir, 'Frankenstein_chapters')), [],
    'no chapter or notes file should have been written into the install directory');
});

//---------------------------------------------------------------------------
// Lifting a password saved by version 2.2.1 or earlier
//---------------------------------------------------------------------------

//This runs on every launch, on real machines, and there is nothing to look at when it goes wrong:
//a writer whose password fails to migrate gets no error and no log line, just an email dialog that
//has forgotten their password, possibly months later. So it is driven here through a real boot -
//a user-settings.json written the way 2.2.1 wrote one, and the real node backing that render.js
//builds - rather than by calling the command directly.
//
//'o2V6h1BYiyMWiSFNNoKf6rp7maAr6Lb7' is the key that shipped inside every copy up to 2.2.1, and the
//blob below is frozen rather than generated: a helper that re-derives the old format would drift
//alongside crypto.js and keep passing while every real user's password stopped decrypting.
const FROZEN_LEGACY_BLOB = {
  iv: '9f1c4a77e5b30d2168ac5e91b3470ddf',
  content: 'ffcdaeb4e695b8e2c9b13c01aa44988a9d74'
};

function writeSettings(settings){
  fs.writeFileSync(path.join(userDataDir, 'user-settings.json'), JSON.stringify(settings), 'utf8');
}

function readSettingsFile(){
  return JSON.parse(fs.readFileSync(path.join(userDataDir, 'user-settings.json'), 'utf8'));
}

//The credential store lands beside user-settings.json in userData, which is shared across this
//file's tests - so it has to go, or the next boot here starts with a saved password.
function clearCredentialFiles(t){
  t.after(function(){
    fs.rmSync(path.join(userDataDir, 'credentials.json'), { force: true });
    fs.rmSync(path.join(userDataDir, '.warewoolf-key'), { force: true });
  });
}

test('a password saved by version 2.2.1 is lifted out of user-settings.json at boot', async function(t){
  clearCredentialFiles(t);
  writeSettings({ senderEmail: 'writer@gmail.com', senderPass: FROZEN_LEGACY_BLOB });

  var r = await freshRender();

  //Out of the settings file, in memory and on disk.
  assert.strictEqual(r.userSettings.senderPass, null);
  assert.strictEqual(readSettingsFile().senderPass, null);

  //And into the credential store, re-sealed - this test's fake ipcRenderer answers
  //'secure-storage-available' with false, so it lands under the key file.
  const stored = JSON.parse(fs.readFileSync(path.join(userDataDir, 'credentials.json'), 'utf8'));
  assert.strictEqual(stored.backend, 'keyfile');
  assert.ok(fs.existsSync(path.join(userDataDir, '.warewoolf-key')));
  //Recovered, not merely copied: the old ciphertext is nowhere in the new file, and the plaintext
  //is nowhere in it either.
  assert.strictEqual(JSON.stringify(stored).indexOf(FROZEN_LEGACY_BLOB.content), -1);
  assert.strictEqual(JSON.stringify(stored).indexOf('old-saved-password'), -1);
});

//The second launch, and every launch after it. Nothing to migrate must mean nothing written and
//nothing touched - not a credential store rebuilt from an empty blob, and not a settings file
//rewritten for no reason.
test('a boot with nothing to migrate leaves the settings file and the credential store alone', async function(t){
  clearCredentialFiles(t);
  writeSettings({ senderEmail: 'writer@gmail.com', senderPass: null });

  var r = await freshRender();

  assert.strictEqual(r.userSettings.senderPass, null);
  assert.strictEqual(fs.existsSync(path.join(userDataDir, 'credentials.json')), false);
  assert.strictEqual(fs.existsSync(path.join(userDataDir, '.warewoolf-key')), false);
});

//Migrating twice would re-seal a blob that is no longer there, so what actually has to hold is that
//the second boot finds nothing and leaves the first boot's credential exactly as it was.
test('migration does not run again on the next boot, and does not disturb what it saved', async function(t){
  clearCredentialFiles(t);
  writeSettings({ senderEmail: 'writer@gmail.com', senderPass: FROZEN_LEGACY_BLOB });

  await freshRender();
  const afterFirstBoot = fs.readFileSync(path.join(userDataDir, 'credentials.json'), 'utf8');

  //user-settings.json is not cleared between the two boots here, deliberately: the second boot has
  //to read back exactly what the first one wrote, which is the real second-launch sequence.
  var r = await freshRender();

  assert.strictEqual(r.userSettings.senderPass, null);
  assert.strictEqual(fs.readFileSync(path.join(userDataDir, 'credentials.json'), 'utf8'), afterFirstBoot);
});

//A legacy-shaped blob holding nothing - a 2.2.1 writer who ticked "remember" with an empty password
//field. There is no password to recover, but the field is still dead and still has to go, or every
//launch from here on re-reads and re-decrypts it forever with nothing ever saying so. This is the
//case `{ migrated }` alone could not express, and the reason the command returns two flags.
test('a legacy blob holding no password is still cleared out of the settings file', async function(t){
  clearCredentialFiles(t);
  const crypto = require('node:crypto');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-ctr', 'o2V6h1BYiyMWiSFNNoKf6rp7maAr6Lb7', iv);
  const empty = Buffer.concat([cipher.update(''), cipher.final()]);

  writeSettings({
    senderEmail: 'writer@gmail.com',
    senderPass: { iv: iv.toString('hex'), content: empty.toString('hex') }
  });

  var r = await freshRender();

  assert.strictEqual(r.userSettings.senderPass, null);
  assert.strictEqual(readSettingsFile().senderPass, null);
  //Nothing was recovered, so nothing was saved.
  assert.strictEqual(fs.existsSync(path.join(userDataDir, 'credentials.json')), false);
});

//A current-format blob is not a legacy one and must never be handed to the old key. Nothing about
//this settings file is dead, so nothing about it should change.
test('a settings file holding a current-format blob is left completely alone', async function(t){
  clearCredentialFiles(t);
  const current = { v: 2, iv: 'aabbcc', tag: 'ddeeff', content: '001122' };
  writeSettings({ senderEmail: 'writer@gmail.com', senderPass: current });

  var r = await freshRender();

  assert.deepStrictEqual(r.userSettings.senderPass, current);
  assert.deepStrictEqual(readSettingsFile().senderPass, current);
  assert.strictEqual(fs.existsSync(path.join(userDataDir, 'credentials.json')), false);
});

//A broken keystore, a full disk. The old code cleared userSettings.senderPass whether the re-save
//worked or not, destroying the only copy of the password; the command rejects instead and this
//catch leaves the blob where it is, so the next launch can try again. Either way the app starts -
//a credential that will not migrate must never be the reason WareWoolf does not open.
test('a migration that fails leaves the legacy blob in place and still boots', async function(t){
  clearCredentialFiles(t);
  writeSettings({ senderEmail: 'writer@gmail.com', senderPass: FROZEN_LEGACY_BLOB });

  const realWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = function(filepath, ...rest){
    if(String(filepath).indexOf('credentials.json') !== -1 || String(filepath).indexOf('.warewoolf-key') !== -1)
      throw new Error('disk full');
    return realWriteFileSync.call(fs, filepath, ...rest);
  };
  t.after(function(){ fs.writeFileSync = realWriteFileSync; });

  var r = await freshRender();

  assert.ok(r.project, 'the app should still have booted');
  assert.deepStrictEqual(r.userSettings.senderPass, FROZEN_LEGACY_BLOB,
    'the only copy of the password must survive a failed migration');
  assert.deepStrictEqual(readSettingsFile().senderPass, FROZEN_LEGACY_BLOB);
});

//---------------------------------------------------------------------------
// The menu commands hand email-doc.js a working platform instance
//---------------------------------------------------------------------------

//Through Phase 7, both email dialogs put SAVED_SECRET in the password field, and emailFile() had
//to be handed a *separate* resolver (setSecretResolver) to turn it back into the password, because
//resolveSecret is deliberately not a declared command. Phase 8 turned emailFile() into a thin
//wrapper around platform.sendEmail(), which resolves the sentinel itself, on the far side of the
//boundary - so the only thing that still has to be right is that the menu commands hand the email
//dialogs the *same* node-backed platform instance render.js uses everywhere else (the one whose
//credential store has any unlocked session key), exactly as they already did for
//describeCredential/storeCredential in Phase 7. There is no separate wiring step left to forget.
const emailDocPath = require.resolve('../src/components/controllers/email-doc');
const emailDocDisplayPath = require.resolve('../src/components/views/email-doc_display');
const errorLogDisplayPath = require.resolve('../src/components/views/error-log_display');

//Captures the `platform` argument the menu command's view call receives, instead of rendering the
//real dialog - render.js's own wiring is what this is testing, not the dialog's DOM. `platformIndex`
//is the position of the `platform` parameter in the real view function's own signature -
//showEmailOptions(project, userSettings, platform, editorQuill) is 2, showErrorLog(userSettings,
//platform) is 1.
function capturingDisplay(path, platformIndex, capture){
  require.cache[path] = {
    id: path,
    filename: path,
    loaded: true,
    exports: function(){
      capture.platform = arguments[platformIndex];
    }
  };
}

async function platformHandedToEmailMenuCommand(channel, displayPath, platformIndex){
  delete require.cache[emailDocPath];
  var capture = {};
  capturingDisplay(displayPath, platformIndex, capture);

  var r = await freshRender();
  currentBridge().handlers[channel]();

  return { render: r, platform: capture.platform };
}

test('Send Via Email hands the dialog a platform that can resolve a saved password', async function(t){
  clearCredentialFiles(t);
  writeSettings({ senderEmail: 'writer@gmail.com', senderPass: null });
  t.after(function(){ delete require.cache[emailDocDisplayPath]; });

  //nodePlatform's mail transport is resolved once, when render.js builds it inside
  //loadPlatformState() (createNodeBacking() reads nodemailer.createTransport at construction, the
  //same "mock before you construct" requirement platform-node.js's own https/spawn seams have) -
  //so the mock has to be in place before freshRender() runs, not after the dialog opens.
  let sentAuth = null;
  const nodemailer = require('nodemailer');
  t.mock.method(nodemailer, 'createTransport', function(config){
    sentAuth = config.auth;
    return { sendMail: function(mailOptions, cb){ cb(null, { response: '250 OK' }); } };
  });

  var opened = await platformHandedToEmailMenuCommand('send-via-email-clicked', emailDocDisplayPath, 2);
  assert.ok(opened.platform, 'the menu command must pass a platform instance to the dialog');

  await opened.platform.storeCredential({ service: 'email', secret: 'the-real-password' });

  const emailDoc = require(emailDocPath);
  const { SAVED_SECRET } = require('../src/components/controllers/platform');

  await new Promise(function(resolve){
    emailDoc.emailFile(opened.platform, 'me@example.com', SAVED_SECRET, 'you@example.com', [], resolve);
  });

  assert.strictEqual(sentAuth.pass, 'the-real-password');
  assert.notStrictEqual(sentAuth.pass, SAVED_SECRET);
  assert.ok(opened.render.project, 'the app booted normally alongside all of that');
});

test('the Error Log dialog gets the same working platform, since it can send as well', async function(t){
  clearCredentialFiles(t);
  t.after(function(){ delete require.cache[errorLogDisplayPath]; });

  var opened = await platformHandedToEmailMenuCommand('view-error-log-clicked', errorLogDisplayPath, 1);
  assert.ok(opened.platform, 'the menu command must pass a platform instance to the dialog');

  const described = await opened.platform.describeCredential({ service: 'email' });
  assert.strictEqual(described.hasPassword, false, 'nothing stored yet, from a clean credential store');
});

//---------------------------------------------------------------------------
// automatic substitutions
//---------------------------------------------------------------------------

//One character at a time at the end of the document, which is as close to a keystroke as this gets
//without a browser - see test/autocorrect-controller.test.js, which covers the rules themselves.
//These are about the wiring: that setUpQuills() actually attached them to both editors, and that
//the settings reach them.
function typeInto(quill, text){
  text.split('').forEach(function(character){
    quill.insertText(quill.getLength() - 1, character, 'user');
  });
}

test('typing in the editor gets the automatic substitutions', async function(){
  var r = await freshRender();
  r.project.chapters = [makeChap('')];
  await r.displayChapterByIndex(0);
  r.editorQuill.setText('\n');

  typeInto(r.editorQuill, '"Wait--" she said...');

  assert.strictEqual(r.editorQuill.getText().trim(), '“Wait—” she said…');
});

test('the notes pane gets them too', async function(){
  var r = await freshRender();
  r.notesQuill.setText('\n');

  typeInto(r.notesQuill, 'wait--no');

  assert.strictEqual(r.notesQuill.getText().trim(), 'wait—no');
});

//The substitution is a 'user' change of its own, so the chapter has to end up holding the
//substituted text rather than the straight quotes that were typed.
test('a substitution is saved onto the chapter like any other edit', async function(){
  var r = await freshRender();
  var c0 = makeChap('');
  r.project.chapters = [c0];
  await r.displayChapterByIndex(0);
  r.editorQuill.setText('\n');

  typeInto(r.editorQuill, 'wait--');

  assert.strictEqual(c0.contents.ops[0].insert.trim(), 'wait—');
  assert.strictEqual(c0.hasUnsavedChanges, true);
});

//Driven through the real menu command and the real Save button, so this covers the callback
//render.js hands the popup as well as the popup itself.
function settingsPopupSaveButton(){
  return Array.from(document.querySelectorAll('.popup button')).find(function(b){
    return b.textContent === 'Save';
  });
}

function saveSettingsPopup(){
  currentBridge().handlers['settings-clicked']();
  settingsPopupSaveButton().onclick();
}

test('dictionaries-clicked opens the Dictionaries popup', async function(){
  var r = await freshRender();

  await currentBridge().handlers['dictionaries-clicked']();

  var popup = document.querySelector('.popup');
  assert.ok(popup, 'expected a popup to open');
  assert.strictEqual(popup.querySelector('h1').innerText, 'Dictionaries');
});

test('switching the substitutions off in Settings stops them on the next keystroke', async function(){
  var r = await freshRender();
  r.editorQuill.setText('\n');

  typeInto(r.editorQuill, '"');
  r.userSettings.autocorrectEnabled = false;
  saveSettingsPopup();
  typeInto(r.editorQuill, '"');

  assert.strictEqual(r.editorQuill.getText().trim(), '“"');
});

test('a single rule switched off in Settings leaves the others working', async function(){
  var r = await freshRender();
  r.editorQuill.setText('\n');

  currentBridge().handlers['settings-clicked']();
  document.getElementById('autocorrect-emDash').checked = false;
  settingsPopupSaveButton().onclick();
  typeInto(r.editorQuill, '"wait--"');

  assert.strictEqual(r.editorQuill.getText().trim(), '“wait--”');
});

//The conversion itself is covered in convert-substitutions.test.js, and the popup's own behaviour
//in convert-substitutions_display.test.js. This is about the wiring between them: that the menu
//command reaches the right module and hands it the open project. It stops short of submitting the
//form, because the real working indicator waits on an image jsdom will never load.
test('Convert Straight Quotes Etc. opens its popup with every substitution offered', async function(){
  var r = await freshRender();
  r.project.chapters = [makeChap('c0')];
  await r.displayChapterByIndex(0);

  currentBridge().handlers['convert-substitutions-clicked']();

  var popup = document.querySelector('.popup');
  assert.ok(popup, 'expected the conversion popup to open');
  assert.strictEqual(popup.querySelector('h1').innerText, 'Convert Straight Quotes Etc.');

  require('../src/components/models/autocorrect').getAutocorrectDefs().forEach(function(def){
    var check = document.getElementById('convert-' + def.id);
    assert.ok(check, 'expected a checkbox for ' + def.id);
    assert.strictEqual(check.checked, true);
  });
});

//---------------------------------------------------------------------------
// Anything shipped inside the install directory opens read-only
//---------------------------------------------------------------------------

//Help > Open Help Document has always set the flag itself (above). These are the three routes that
//did not, all of which decided read-only-ness by never deciding it - so the shipped Help doc came
//up writable and the next save wrote it. Running from source that directory is the repository, so
//it was the tracked HelpDoc.woolf that got edited; on a packaged install it is Program Files or the
//app bundle, where the same save dies with EACCES instead.
test('a lastProject inside the install directory is reopened read-only', async function(t){
  const bundled = withBundledHelpDoc(t);
  const helpDocPath = bundled.helpDocPath.split(path.sep).join('/');

  var r = await renderWithLastProject(helpDocPath);

  assert.strictEqual(r.module.project.title, 'WareWoolf Help', 'the project should still open');
  assert.strictEqual(r.module.project.isReadOnly, true);
});

//The route that put it in lastProject to begin with: browsing to the shipped Help doc through
//File > Open Project, which loads it directly rather than through setProject. render.js requires
//the file dialog lazily inside openAProject(), so priming require.cache just before the handler
//runs is enough to stand in for the writer picking that file.
test('a project browsed to inside the install directory opens read-only', async function(t){
  const bundled = withBundledHelpDoc(t);
  const helpDocPath = bundled.helpDocPath.split(path.sep).join('/');
  var r = await freshRender();
  r.project.hasUnsavedChanges = false;

  const fileDialogPath = require.resolve('../src/components/views/file-dialog_display');
  const realDialog = require.cache[fileDialogPath];
  require.cache[fileDialogPath] = {
    id: fileDialogPath, filename: fileDialogPath, loaded: true,
    exports: function(options, callback){ return callback([helpDocPath]); }
  };
  t.after(function(){
    if(realDialog) require.cache[fileDialogPath] = realDialog;
    else delete require.cache[fileDialogPath];
  });

  await currentBridge().handlers['open-clicked']();
  await flushMicrotasks();

  assert.strictEqual(r.project.title, 'WareWoolf Help');
  assert.strictEqual(r.project.isReadOnly, true);
});

//And the same file double-clicked in the file manager, which reaches its own handler rather than
//either of the two above.
test('a project opened from outside the app inside the install directory opens read-only', async function(t){
  const bundled = withBundledHelpDoc(t);
  const helpDocPath = bundled.helpDocPath.split(path.sep).join('/');
  var r = await freshRender();

  await currentBridge().handlers['file-opened-from-outside-warewoolf'](helpDocPath);

  assert.strictEqual(r.project.title, 'WareWoolf Help');
  assert.strictEqual(r.project.isReadOnly, true);
});

//The other half of the guard: an ordinary project must stay writable, or Ctrl+S would start
//offering Save As for every project a writer owns.
test('a project outside the install directory stays writable', async function(t){
  withBundledHelpDoc(t);
  const ordinary = path.join(userDataDir, 'Ordinary.woolf');
  fs.writeFileSync(ordinary, JSON.stringify({
    title: 'An Ordinary Novel', author: '', chapsDirectory: '',
    chapters: [], reference: [], trash: []
  }), 'utf8');

  var r = await renderWithLastProject(ordinary.split(path.sep).join('/'));

  assert.strictEqual(r.module.project.title, 'An Ordinary Novel');
  assert.strictEqual(r.module.project.isReadOnly, false);
});

//Quill 1.x leaves its contenteditable root with no role and no name. render.js names both editors
//on construction: the manuscript outright, the notes by the sidebar heading that already changes
//between "Chapter Notes" and "Project Notes".
test('both editors are named multiline text boxes for assistive technology', async function(){
  var r = await freshRender();

  assert.strictEqual(r.editorQuill.root.getAttribute('role'), 'textbox');
  assert.strictEqual(r.editorQuill.root.getAttribute('aria-multiline'), 'true');
  assert.strictEqual(r.editorQuill.root.getAttribute('aria-label'), 'Manuscript');
  assert.strictEqual(r.notesQuill.root.getAttribute('role'), 'textbox');
  assert.strictEqual(r.notesQuill.root.getAttribute('aria-multiline'), 'true');
  assert.strictEqual(r.notesQuill.root.getAttribute('aria-labelledby'), 'notes-header');
});
