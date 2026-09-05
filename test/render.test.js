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

const renderPath = require.resolve('../src/render');
const electronPath = require.resolve('electron');
//keybindings.js destructures `ipcRenderer` from 'electron' at require-time, same as render.js
//itself - but it is a separately cached module (render.js requires it, it does not live inside
//render.js), so clearing render.js's own cache entry each freshRender() call is not enough to
//make it see a new test's fake ipcRenderer. Needs clearing right alongside renderPath.
const keybindingsPath = require.resolve('../src/components/controllers/keybindings');

//error-log.js appends to <userData>/error_log.txt in the background (fire-and-forget fs.appendFile)
//whenever anything under render.js logs an error, which happens incidentally in a couple of these
//tests (e.g. a real chapter reading its notes file out of a directory that does not exist here).
//A real, empty directory keeps those writes harmless instead of failing with ENOENT against a
//made-up path.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-render-test-'));

//The Open/Save As/Save Copy dialogs list this directory's real contents via fs.readdirSync() the
//moment they open (file-dialog_display.js's populateFileList()), so unlike app/home below it has
//to actually exist - a real, empty directory is enough for that listing to succeed with nothing in
//it. app/home stay nonexistent paths on purpose: loadInitialProject() relies on `app` not existing
//to fall through to createNewProject() below, and `home` is only ever added to a dropdown list,
//never read from disk.
const docsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-render-test-docs-'));

//render.js is loaded via a plain <script> tag in the real app (not required as a CommonJS module),
//so it reads `ipcRenderer` off a bare `require('electron')` at the top of the file. Outside Electron
//that resolves to a path string, so it must be faked in require.cache before every (re-)require -
//same require.cache-priming pattern about_display.test.js uses for its own dependencies.
function makeIpcRenderer(){
  var handlers = {};
  var sent = [];
  return {
    handlers: handlers,
    sent: sent,
    sendSync: function(channel){
      if(channel === 'get-directories')
        return { app: '/no-such-app-dir', userData: userDataDir, docs: docsDir, home: '/no-such-home-dir' };
      if(channel === 'get-file-requested-on-open')
        return null;
      if(channel === 'secure-storage-available')
        return false;
      return undefined;
    },
    send: function(channel){
      sent.push(channel);
    },
    on: function(channel, handler){
      handlers[channel] = handler;
    }
  };
}

//Mirrors src/index.html's body exactly (minus the <script> tag): every id render.js reaches for
//with getElementById needs to already be present before it's (re-)required, since setUpQuills()/
//applyUserSettings() touch them synchronously at require-time.
function bodyShell(){
  return '<div id="chapter-list-sidebar" class="sidebar" tabindex="-1">' +
      '<h1 id="chapters-header">Chapters</h1>' +
      '<ul id="chapter-list"></ul>' +
      '<h1 id="reference-header">Reference</h1>' +
      '<ul id="reference-list"></ul>' +
      "<h1 id='trash-header'>Trash</h1>" +
      '<ul id="trash-list"></ul>' +
    '</div>' +
    '<div id="writing-field" class="writing-field-standard-view">' +
      '<div id="editor-container"></div>' +
    '</div>' +
    '<div id="project-notes" class="sidebar">' +
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

function freshRender(){
  if(previousKeybindingsTeardown)
    previousKeybindingsTeardown();

  delete require.cache[renderPath];
  delete require.cache[keybindingsPath];
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { ipcRenderer: makeIpcRenderer() }
  };
  var mod = require(renderPath);
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
  delete require.cache[electronPath];
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

test('moveChapUp on the first reference item folds it into the chapters list without shifting activeChapterIndex', function(){
  var r = freshRender();
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

test('moveChapDown on the last chapter spills it into the reference list without shifting activeChapterIndex', function(){
  var r = freshRender();
  var c0 = makeChap('c0'), c1 = makeChap('c1'), r0 = makeChap('r0');
  r.project.chapters = [c0, c1];
  r.project.reference = [r0];
  r.project.activeChapterIndex = 1; //c1, lastChapter

  r.moveChapDown(1);

  assert.deepStrictEqual(r.project.chapters, [c0]);
  assert.deepStrictEqual(r.project.reference, [c1, r0]);
  assert.strictEqual(r.project.activeChapterIndex, 1);
});

test('moveChapDown reordering within the trash list shifts activeChapterIndex by one', function(){
  var r = freshRender();
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

test('moveToTrash on a live chapter moves it to trash and keeps the display on the chapter that took its place', function(){
  var r = freshRender();
  var c0 = makeChap('c0'), c1 = makeChap('c1');
  r.project.chapters = [c0, c1];
  r.project.activeChapterIndex = 0;

  r.moveToTrash(0);

  assert.deepStrictEqual(r.project.chapters, [c1]);
  assert.deepStrictEqual(r.project.trash, [c0]);
  assert.strictEqual(r.project.hasUnsavedChanges, true);
  assert.strictEqual(r.project.activeChapterIndex, 0);
  assert.strictEqual(r.editorQuill.getText().trim(), 'c1');
});

test('moveToTrash on an already-trashed chapter asks for confirmation instead of trashing it again', function(){
  var r = freshRender();
  var t0 = makeChap('t0');
  r.project.trash = [t0];

  r.moveToTrash(0);

  assert.deepStrictEqual(r.project.trash, [t0], 'nothing should be deleted before Yes is clicked');
  assert.ok(document.querySelector('.delete-confirm-popup'), 'a confirmation popup should appear');
});

test('moveToTrash on a project with nothing in any list does not push an empty slot into the trash', function(){
  var r = freshRender();
  r.project.chapters = [];
  r.project.reference = [];
  r.project.trash = [];

  r.moveToTrash(0);

  assert.deepStrictEqual(r.project.trash, []);
});

//---------------------------------------------------------------------------
// restoreFromTrash
// Regression: restoreFromTrash used to leave hasUnsavedChanges untouched, so restoring a chapter
// and then exiting the app (which only offers to save when hasUnsavedChanges is true) silently
// dropped the restore - see render.js's exit-app-clicked handler.
//---------------------------------------------------------------------------

test('restoreFromTrash moves the chapter back and marks the project as having unsaved changes', function(){
  var r = freshRender();
  var c0 = makeChap('c0'), t0 = makeChap('t0');
  r.project.chapters = [c0];
  r.project.trash = [t0];
  r.project.hasUnsavedChanges = false;

  r.restoreFromTrash(1); //t0's combined index: chapters.length(1) + reference.length(0)

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

test('confirming delete twice in a row does not stack a second confirmation popup', function(){
  var r = freshRender();
  r.project.trash = [makeChap('t0')];

  r.moveToTrash(0);
  r.moveToTrash(0);

  assert.strictEqual(document.querySelectorAll('.delete-confirm-popup').length, 1);
});

test('deleting a trashed chapter removes that exact chapter, not a neighboring one, when the project has reference chapters', function(){
  var r = freshRender();
  var deletedFiles = [];
  var c0 = makeChap('c0');
  var r0 = makeChap('r0');
  var t0 = makeChap('t0', { deleteFile: function(){ deletedFiles.push('t0'); } });
  var t1 = makeChap('t1', { text: 'TrashOne', deleteFile: function(){ deletedFiles.push('t1'); } });
  r.project.chapters = [c0];
  r.project.reference = [r0];
  r.project.trash = [t0, t1];
  r.project.activeChapterIndex = 2; //t0's combined index: chapters.length(1) + reference.length(1) + 0

  r.moveToTrash(2);
  findButton('Yes').onclick();

  assert.deepStrictEqual(deletedFiles, ['t0']);
  assert.strictEqual(r.project.trash.length, 1);
  assert.strictEqual(r.project.trash[0], t1, 't1 should remain - it was never the target');
  assert.strictEqual(document.querySelectorAll('.delete-confirm-popup').length, 0);
  //display should follow onto the remaining trash item, now at the same combined index
  assert.strictEqual(r.project.activeChapterIndex, 2);
  assert.strictEqual(r.editorQuill.getText().trim(), 'TrashOne');
});

test('deleting the last trashed chapter does not crash when the project has multiple reference chapters', function(){
  var r = freshRender();
  var deletedFiles = [];
  var c0 = makeChap('c0');
  var t0 = makeChap('t0', { deleteFile: function(){ deletedFiles.push('t0'); } });
  r.project.chapters = [c0];
  r.project.reference = [makeChap('r0'), makeChap('r1')];
  r.project.trash = [t0];
  //t0's combined index: chapters.length(1) + reference.length(2) + 0 = 3
  r.project.activeChapterIndex = 3;

  assert.doesNotThrow(function(){
    r.moveToTrash(3);
    findButton('Yes').onclick();
  });

  assert.deepStrictEqual(deletedFiles, ['t0']);
  assert.strictEqual(r.project.trash.length, 0);
  //trash is now empty, so the display should fall back to the last remaining chapter
  assert.strictEqual(r.project.activeChapterIndex, 0);
  assert.strictEqual(r.editorQuill.getText().trim(), 'c0');
});

test('clicking No on the delete confirmation leaves the trashed chapter untouched', function(){
  var r = freshRender();
  var t0 = makeChap('t0');
  r.project.trash = [t0];

  r.moveToTrash(0);
  findButton('No').onclick();

  assert.deepStrictEqual(r.project.trash, [t0]);
  assert.strictEqual(document.querySelectorAll('.delete-confirm-popup').length, 0);
});

//---------------------------------------------------------------------------
// updateFileList
//---------------------------------------------------------------------------

test('updateFileList renders chapters/reference/trash with titles, unsaved markers, and the active highlight', function(){
  var r = freshRender();
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

test('updateFileList marks the reference and trash headers empty when those lists have nothing in them', function(){
  var r = freshRender();
  r.project.chapters = [makeChap('One')];

  r.updateFileList();

  assert.ok(document.getElementById('reference-header').classList.contains('trash-header-empty'));
  assert.ok(document.getElementById('trash-header').classList.contains('trash-header-empty'));
});

//---------------------------------------------------------------------------
// displayChapterByIndex
//---------------------------------------------------------------------------

test('displayChapterByIndex clamps an out-of-range index to the last chapter', function(){
  var r = freshRender();
  r.project.chapters = [makeChap('c0'), makeChap('c1')];

  r.displayChapterByIndex(99);

  assert.strictEqual(r.project.activeChapterIndex, 1);
  assert.strictEqual(r.editorQuill.getText().trim(), 'c1');
});

//The core editing loop: type in a chapter, look at a different one, come back. If this regresses,
//edits are silently lost the moment the writer glances at another chapter - about the worst
//possible failure mode for this app.
test('editing a chapter, viewing another, then returning shows the edit rather than the original text', function(){
  var r = freshRender();
  var c0 = makeChap('c0'), c1 = makeChap('c1');
  r.project.chapters = [c0, c1];
  r.displayChapterByIndex(0);

  r.editorQuill.setText('edited content\n', 'user');
  assert.deepStrictEqual(c0.contents, r.editorQuill.getContents(), 'the edit should be stored on the chapter as it happens, not just left in the editor');
  assert.strictEqual(c0.hasUnsavedChanges, true);

  r.displayChapterByIndex(1);
  assert.strictEqual(r.editorQuill.getText().trim(), 'c1');

  r.displayChapterByIndex(0);
  assert.strictEqual(r.editorQuill.getText().trim(), 'edited content');
});

test('editing a chapter marks both the chapter and the project as having unsaved changes', function(){
  var r = freshRender();
  var c0 = makeChap('c0');
  r.project.chapters = [c0];
  r.displayChapterByIndex(0);

  r.editorQuill.insertText(0, 'x', 'user');

  assert.strictEqual(c0.hasUnsavedChanges, true);
  assert.strictEqual(r.project.hasUnsavedChanges, true);
});

test('a programmatic content change (loading a chapter) does not mark it as having unsaved changes', function(){
  var r = freshRender();
  var c0 = makeChap('c0');
  r.project.chapters = [c0];

  r.displayChapterByIndex(0);

  assert.strictEqual(c0.hasUnsavedChanges, false);
});

test('typing in the notes pane updates the active chapter\'s own notes while per-chapter notes are shown', function(){
  var r = freshRender();
  var c0 = makeChap('c0');
  r.project.chapters = [c0];
  r.userSettings.displayChapNotes = true;
  r.displayChapterByIndex(0);

  r.notesQuill.setText('a note\n', 'user');

  assert.deepStrictEqual(c0.notes, r.notesQuill.getContents());
  assert.strictEqual(c0.hasUnsavedChanges, true);
});

test('typing in the notes pane updates the project-wide notes chapter while project notes are shown', function(){
  var r = freshRender();
  r.project.initNotesChap();
  r.userSettings.displayChapNotes = false;

  r.notesQuill.setText('a project note\n', 'user');

  assert.deepStrictEqual(r.project.notesChap.notes, r.notesQuill.getContents());
  assert.strictEqual(r.project.notesChap.hasUnsavedChanges, true);
});

test('displayChapterByIndex clears and disables the editor instead of throwing when chapters/reference/trash are all empty', function(){
  var r = freshRender();
  r.project.chapters = [];
  r.project.reference = [];
  r.project.trash = [];

  assert.doesNotThrow(function(){ r.displayChapterByIndex(0); });

  assert.strictEqual(r.project.activeChapterIndex, 0);
  assert.strictEqual(r.editorQuill.getText(), '\n');
  assert.strictEqual(r.editorQuill.isEnabled(), false);
});

//---------------------------------------------------------------------------
// addNewChapter / addImportedChapter
//---------------------------------------------------------------------------

test('addNewChapter inserts a blank chapter right after the active one and selects it for renaming', function(){
  var r = freshRender();
  r.project.chapters = [makeChap('c0')];
  r.project.activeChapterIndex = 0;

  r.addNewChapter();

  assert.strictEqual(r.project.chapters.length, 2);
  assert.strictEqual(r.project.activeChapterIndex, 1);
  assert.strictEqual(r.project.hasUnsavedChanges, true);
  assert.ok(document.querySelector('.name-box'), 'the new chapter should be immediately renameable');
});

test('addNewChapter with a Reference document active inserts into Reference and displays that new chapter, not an existing one', function(){
  var r = freshRender();
  r.project.chapters = [makeChap('c0'), makeChap('c1')];
  r.project.reference = [makeChap('r0'), makeChap('r1')];
  r.project.activeChapterIndex = 3; //r1, the last reference item

  r.addNewChapter();

  assert.strictEqual(r.project.reference.length, 3);
  assert.strictEqual(r.project.reference[2].title, 'new');
  //Combined index: 2 chapters + 3rd (new) item in reference = 4, not reference's own array index (2).
  assert.strictEqual(r.project.activeChapterIndex, 4);
  var nameBox = document.querySelector('.name-box');
  assert.ok(nameBox, 'the newly inserted reference item should be the one selected for renaming');
});

test('addNewChapter with only a trashed chapter active appends the new chapter onto Chapters', function(){
  var r = freshRender();
  r.project.trash = [makeChap('t0')];
  r.project.activeChapterIndex = 0; //t0, the only thing in any list

  r.addNewChapter();

  assert.strictEqual(r.project.chapters.length, 1);
  assert.strictEqual(r.project.chapters[0].title, 'new');
  assert.strictEqual(r.project.activeChapterIndex, 0);
  assert.strictEqual(r.editorQuill.getText().trim(), '');
});

test('addImportedChapter inserts the given delta right after the active chapter and displays it', function(){
  var r = freshRender();
  var c0 = makeChap('c0');
  r.project.chapters = [c0];
  r.project.activeChapterIndex = 0;

  r.addImportedChapter({ ops: [{ insert: 'Imported\n' }] }, 'Imported Title');

  assert.strictEqual(r.project.chapters.length, 2);
  assert.strictEqual(r.project.chapters[1].title, 'Imported Title');
  assert.strictEqual(r.project.activeChapterIndex, 1);
  assert.strictEqual(r.editorQuill.getText().trim(), 'Imported');
});

test('addImportedChapter with a trashed chapter active appends onto Chapters and displays the import, not an unrelated trash item', function(){
  var r = freshRender();
  r.project.chapters = [makeChap('c0')];
  r.project.trash = [makeChap('t0')];
  r.project.activeChapterIndex = 1; //t0's combined index: chapters.length(1) + 0

  r.addImportedChapter({ ops: [{ insert: 'Imported\n' }] }, 'Imported Title');

  assert.strictEqual(r.project.chapters.length, 2);
  assert.strictEqual(r.project.chapters[1].title, 'Imported Title');
  assert.strictEqual(r.project.activeChapterIndex, 1);
  assert.strictEqual(r.editorQuill.getText().trim(), 'Imported');
});

//---------------------------------------------------------------------------
// changeChapterTitle
//---------------------------------------------------------------------------

test('changeChapterTitle commits the new title and clears unsaved-rename state on Enter', function(){
  var r = freshRender();
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

test('changeChapterTitle discards the edit on Escape', function(){
  var r = freshRender();
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

test('editorHasFocus is true only when the writing field is visible and the editor is focused', function(){
  var r = freshRender();
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

test('editing notes does not throw once every chapter has been permanently deleted', function(){
  var r = freshRender();
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

test('Ctrl/Cmd+Left inside a text field is left for native cursor movement, not hijacked for pane-switching', function(){
  freshRender();
  var input = document.createElement('input');
  input.type = 'text';
  document.body.appendChild(input);

  var evt = new window.KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, bubbles: true, cancelable: true });
  var jsdomErr = dispatchAndCaptureJsdomErrors(input, evt);

  assert.strictEqual(jsdomErr, null, jsdomErr && jsdomErr.message);
  assert.strictEqual(evt.defaultPrevented, false);
});

test('Ctrl/Cmd+Left outside a text field still switches focus to the editor as before', function(){
  freshRender();
  document.getElementById('writing-field').classList.add('visible');

  var evt = new window.KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, bubbles: true, cancelable: true });
  var jsdomErr = dispatchAndCaptureJsdomErrors(document, evt);

  assert.strictEqual(jsdomErr, null, jsdomErr && jsdomErr.message);
  assert.strictEqual(evt.defaultPrevented, true);
});

test('increasing font size does not throw when no chapter is marked active in the sidebar', function(){
  var r = freshRender();
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

test('PageDown does not dereference bounds before checking whether getBounds found a position', function(){
  var r = freshRender();
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
  'outliner-clicked', 'convert-tabs-clicked', 'about-clicked', 'exit-app-clicked',
  'save-copy-clicked', 'help-doc-clicked', 'renumber-chapters-clicked', 'send-via-email-clicked',
  'view-error-log-clicked', 'file-manager-clicked', 'wifi-manager-clicked', 'save-backup-clicked',
  'settings-clicked', 'corkboard-clicked', 'file-opened-from-outside-warewoolf',
  'indent-all-clicked', 'center-all-heads-clicked'
];

//The fake ipcRenderer set up for the current freshRender() call - same object render.js registered
//its handlers on, reached the same way render.js itself would: requiring 'electron' again returns
//the cached mock.
function currentIpc(){
  return require('electron').ipcRenderer;
}

function focusEditor(){
  document.getElementById('writing-field').classList.add('visible');
  document.querySelector('.ql-editor').focus();
}

test('every menu channel is registered exactly once, with none missing or unexpectedly added', function(){
  freshRender();

  assert.deepStrictEqual(Object.keys(currentIpc().handlers).sort(), ALL_MENU_CHANNELS.slice().sort());
});

test('a focus-gated command does nothing while the editor lacks focus, and runs once it has it', function(){
  var r = freshRender();
  r.project.chapters = [makeChap('c0')];
  r.project.activeChapterIndex = 0;

  document.getElementById('writing-field').classList.remove('visible');
  currentIpc().handlers['add-chapter-clicked']();
  assert.strictEqual(r.project.chapters.length, 1, 'add-chapter-clicked should not have run without focus');

  focusEditor();
  currentIpc().handlers['add-chapter-clicked']();
  assert.strictEqual(r.project.chapters.length, 2, 'add-chapter-clicked should run once the editor has focus');
});

//convert-tabs-clicked is project-wide, exactly like convert-first-lines-clicked and
//convert-italics-clicked, but (like renumber-chapters/indent-all/center-all-heads) was never
//focus-gated - preserved as-is per the comment above the table in render.js.
test('a command with no focus guard runs regardless of where focus is', function(){
  var r = freshRender();
  //Empty project: showOutliner()'s project.chapters.forEach() then has nothing to iterate, so this
  //stays focused on proving the guard (or lack of one), not on outliner_display.js's own rendering.

  document.getElementById('writing-field').classList.remove('visible');

  assert.doesNotThrow(function(){
    currentIpc().handlers['outliner-clicked']();
  });
  assert.ok(document.querySelector('.popup-outliner'), 'outliner-clicked has no focus guard and should have run');
});

//jsdom's innerText does not create real text nodes, so document.textContent cannot see text set
//through it - these check the specific elements the two views set it on instead.
test('about-clicked forwards the app version it is sent to the About popup', function(){
  freshRender();

  currentIpc().handlers['about-clicked'](null, '9.9.9');

  assert.strictEqual(document.querySelector('.about-version').innerText, '9.9.9');
});

test('shortcuts-clicked forwards isMac to render Mac- or Ctrl-style shortcut labels', function(){
  freshRender();

  currentIpc().handlers['shortcuts-clicked'](null, true);
  var macLabels = Array.from(document.querySelectorAll('.shortcuts-table td'));
  assert.ok(macLabels.some(function(td){ return td.innerText.includes('Cmd'); }));
  removeAllPopups();

  currentIpc().handlers['shortcuts-clicked'](null, false);
  var ctrlLabels = Array.from(document.querySelectorAll('.shortcuts-table td'));
  assert.ok(ctrlLabels.some(function(td){ return td.innerText.includes('Ctrl'); }));
});

function removeAllPopups(){
  Array.from(document.querySelectorAll('.popup')).forEach(function(p){ p.remove(); });
}

//---------------------------------------------------------------------------
// open-clicked / exit-app-clicked (proceedOrConfirmSave)
//---------------------------------------------------------------------------

test('open-clicked opens the file dialog directly when there are no unsaved changes', function(){
  var r = freshRender();
  r.project.hasUnsavedChanges = false;

  currentIpc().handlers['open-clicked']();

  assert.ok(document.querySelector('.popup-dialog'), 'the open dialog should appear with nothing to confirm first');
});

test('open-clicked asks to save first when there are unsaved changes, and does not open the dialog until answered', function(){
  var r = freshRender();
  r.project.hasUnsavedChanges = true;

  currentIpc().handlers['open-clicked']();

  assert.strictEqual(document.querySelector('.popup-dialog'), null, 'the open dialog should wait behind the confirmation');
  assert.ok(findButton('Continue Without Saving'), 'the unsaved-changes prompt should be showing instead');

  findButton('Continue Without Saving').onclick();
  assert.ok(document.querySelector('.popup-dialog'), 'answering the prompt should proceed to the open dialog');
});

test('exit-app-clicked quits directly when there are no unsaved changes', function(){
  var r = freshRender();
  r.project.hasUnsavedChanges = false;
  r.project.filename = ''; //no autoBackup path to route through

  currentIpc().handlers['exit-app-clicked']();

  assert.ok(currentIpc().sent.includes('exit-app-confirmed'));
});

test('exit-app-clicked refreshes the sidebar and asks to save first when there are unsaved changes', function(){
  var r = freshRender();
  r.project.chapters = [makeChap('Unsaved', { hasUnsavedChanges: true })];
  r.project.hasUnsavedChanges = true;

  currentIpc().handlers['exit-app-clicked']();

  //The sidebar's unsaved-change marker reflects the current state before the prompt is shown.
  assert.strictEqual(document.querySelector('#chapter-list li').textContent, 'Unsaved*');
  assert.ok(findButton('Continue Without Saving'));
  assert.ok(!currentIpc().sent.includes('exit-app-confirmed'), 'should not quit before the prompt is answered');

  findButton('Continue Without Saving').onclick();
  assert.ok(currentIpc().sent.includes('exit-app-confirmed'));
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

test('Ctrl/Cmd+Right moves focus to notes only while the notes pane is visible', function(){
  var r = freshRender();
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

test('Escape closes popups, exits search view, and refreshes the panel layout', function(){
  var r = freshRender();
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

test('Ctrl/Cmd+= and Ctrl/Cmd+- change the font size setting in opposite directions', function(){
  var r = freshRender();
  var startSize = r.userSettings.fontSize;

  dispatchAndCaptureJsdomErrors(document, ctrlKeydown('='));
  assert.strictEqual(r.userSettings.fontSize, startSize + 1);

  dispatchAndCaptureJsdomErrors(document, ctrlKeydown('-'));
  dispatchAndCaptureJsdomErrors(document, ctrlKeydown('-'));
  assert.strictEqual(r.userSettings.fontSize, startSize - 1);
});

test('decreasing font size does not throw when no chapter is marked active in the sidebar', function(){
  var r = freshRender();
  r.project.chapters = [];
  r.project.reference = [];
  r.project.trash = [];
  r.updateFileList();

  var err = dispatchAndCaptureJsdomErrors(document, ctrlKeydown('-'));
  assert.strictEqual(err, null, err && err.message);
});

test('Ctrl/Cmd+Alt+T toggles typewriter mode on and back off, persisting the setting each time', function(){
  var r = freshRender();
  assert.strictEqual(r.userSettings.typewriterMode, false);

  dispatchAndCaptureJsdomErrors(document, ctrlKeydown('t', { altKey: true }));
  assert.strictEqual(r.userSettings.typewriterMode, true);
  assert.ok(r.editorQuill.__typewriterHandler, 'enabling should attach the scroll handler');

  dispatchAndCaptureJsdomErrors(document, ctrlKeydown('t', { altKey: true }));
  assert.strictEqual(r.userSettings.typewriterMode, false);
  assert.strictEqual(r.editorQuill.__typewriterHandler, undefined, 'disabling should remove the scroll handler');
});

test('Ctrl/Cmd+M asks the main process to show the menu', function(){
  freshRender();

  dispatchAndCaptureJsdomErrors(document, ctrlKeydown('m'));

  assert.ok(currentIpc().sent.includes('show-menu'));
});

test('F1 toggles the chapter list pane, F2 (unmodified) toggles the editor pane', function(){
  var r = freshRender();
  assert.strictEqual(r.userSettings.displayChapList, true);
  assert.strictEqual(r.userSettings.displayEditor, true);

  dispatchAndCaptureJsdomErrors(document, new window.KeyboardEvent('keydown', { key: 'F1', bubbles: true, cancelable: true }));
  assert.strictEqual(r.userSettings.displayChapList, false);
  assert.strictEqual(document.getElementById('chapter-list-sidebar').classList.contains('visible'), false);

  dispatchAndCaptureJsdomErrors(document, new window.KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
  assert.strictEqual(r.userSettings.displayEditor, false);
});

test('Ctrl/Cmd+F2 does not toggle the editor pane - F2 only responds unmodified', function(){
  var r = freshRender();

  dispatchAndCaptureJsdomErrors(document, ctrlKeydown('F2'));

  assert.strictEqual(r.userSettings.displayEditor, true, 'Ctrl+F2 should not match the plain-F2 branch');
});

test('Ctrl/Cmd+F3 toggles whether notes are per-chapter or project-wide; bare F3 toggles the notes pane', function(){
  var r = freshRender();
  //A fresh test project's notesChap starts as {} until initNotesChap() gives it a real
  //chapter.js model - toggleChapterNotes()'s project-wide branch needs that to read notes from.
  r.project.initNotesChap();
  assert.strictEqual(r.userSettings.displayChapNotes, true);
  assert.strictEqual(r.userSettings.displayNotes, true);

  var err1 = dispatchAndCaptureJsdomErrors(document, ctrlKeydown('F3'));
  assert.strictEqual(err1, null, err1 && err1.message);
  assert.strictEqual(r.userSettings.displayChapNotes, false);
  assert.strictEqual(document.getElementById('notes-header').innerText, 'Project Notes');

  var err2 = dispatchAndCaptureJsdomErrors(document, new window.KeyboardEvent('keydown', { key: 'F3', bubbles: true, cancelable: true }));
  assert.strictEqual(err2, null, err2 && err2.message);
  assert.strictEqual(r.userSettings.displayNotes, false);
});

test('toggling back to per-chapter notes loads the active chapter\'s own notes, not the project-wide ones', function(){
  var r = freshRender();
  r.project.initNotesChap();
  var c0 = makeChap('c0', { contents: { ops: [{ insert: 'c0 body\n' }] } });
  c0.notes = { ops: [{ insert: 'c0 own notes\n' }] };
  r.project.chapters = [c0];
  r.project.activeChapterIndex = 0;

  //One toggle away, then back - lands on the branch of refreshNotesDisplay() that had no
  //coverage at all before this test (only the project-wide 'else' branch did).
  dispatchAndCaptureJsdomErrors(document, ctrlKeydown('F3'));
  var err = dispatchAndCaptureJsdomErrors(document, ctrlKeydown('F3'));

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

test('Ctrl/Cmd+Shift+Up and +Down reorder the active chapter', function(){
  var r = freshRender();
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

test('Ctrl/Cmd+Shift+Left renames the active chapter, but only while the sidebar is visible', function(){
  var r = freshRender();
  r.project.chapters = [makeChap('c0')];
  r.updateFileList();

  document.getElementById('chapter-list-sidebar').classList.remove('visible');
  paneKeydown('chapter-list-sidebar', 'ArrowLeft', { shiftKey: true });
  assert.strictEqual(document.querySelector('.name-box'), null, 'should not open the rename box while the sidebar is hidden');

  document.getElementById('chapter-list-sidebar').classList.add('visible');
  paneKeydown('chapter-list-sidebar', 'ArrowLeft', { shiftKey: true });
  assert.ok(document.querySelector('.name-box'));
});

test('Ctrl/Cmd+Up and +Down move between chapters, focusing notes only when triggered from the notes pane', function(){
  var r = freshRender();
  r.project.chapters = [makeChap('c0'), makeChap('c1')];
  r.project.activeChapterIndex = 1;

  paneKeydown('editor-container', 'ArrowUp');
  assert.strictEqual(r.project.activeChapterIndex, 0);
  assert.notStrictEqual(document.activeElement, r.notesQuill.root, 'triggered from the editor - notes should not steal focus');

  paneKeydown('notes-editor', 'ArrowDown');
  assert.strictEqual(r.project.activeChapterIndex, 1);
  assert.strictEqual(document.activeElement, r.notesQuill.root, 'triggered from notes - focus should stay there');
});

test('Ctrl/Cmd+, and Ctrl/Cmd+. shrink and grow the editor width setting', function(){
  var r = freshRender();
  var startWidth = r.userSettings.editorWidth;

  paneKeydown('editor-container', ',');
  assert.strictEqual(r.userSettings.editorWidth, startWidth - 1);

  paneKeydown('editor-container', '.');
  paneKeydown('editor-container', '.');
  assert.strictEqual(r.userSettings.editorWidth, startWidth + 1);
});

test('PageDown in the notes pane pages down notesQuill rather than editorQuill', function(){
  var r = freshRender();
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
