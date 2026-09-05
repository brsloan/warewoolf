//Quill touches `document`/`Node`/`MutationObserver` at require-time, so the DOM must exist before
//render.js (which requires quill) is ever required - same reasoning as quill-dom-setup.js's own
//comment, and the same helper findreplace.test.js/typewriter-mode.test.js use for real-Quill tests.
require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const renderPath = require.resolve('../src/render');
const electronPath = require.resolve('electron');

//error-log.js appends to <userData>/error_log.txt in the background (fire-and-forget fs.appendFile)
//whenever anything under render.js logs an error, which happens incidentally in a couple of these
//tests (e.g. a chapter's getNotesFile() with no matching global.project - see chapter.test.js's own
//note on that quirk). A real, empty directory keeps those writes harmless instead of failing with
//ENOENT against a made-up path.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-render-test-'));

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
        return { app: '/no-such-app-dir', userData: userDataDir, docs: '/no-such-docs-dir', home: '/no-such-home-dir' };
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
function freshRender(){
  delete require.cache[renderPath];
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { ipcRenderer: makeIpcRenderer() }
  };
  var mod = require(renderPath);
  Array.from(document.querySelectorAll('.popup')).forEach(function(p){ p.remove(); });
  return mod;
}

//A minimal stand-in for the chapter model: render.js's list-mutation functions only ever touch
//title/contents/notes/hasUnsavedChanges/deleteFile on a chapter, so a plain object is enough and
//keeps these tests focused on render.js's own index arithmetic rather than chapter.js's file I/O
//(which chapter.test.js already covers, and which would otherwise need a matching global.project).
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
    deleteFile: opts.deleteFile || function(){}
  };
}

function findButton(text){
  return Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent === text; });
}

test.beforeEach(function(){
  document.body.innerHTML = bodyShell();
});

test.afterEach(function(){
  delete require.cache[renderPath];
  delete require.cache[electronPath];
});

test.after(function(){
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

//---------------------------------------------------------------------------
// chapIndexIs
//---------------------------------------------------------------------------

test('chapIndexIs classifies every combined index across chapters/reference/trash', function(){
  var r = freshRender();
  r.project.chapters = [makeChap('c0'), makeChap('c1')];
  r.project.reference = [makeChap('r0')];
  r.project.trash = [makeChap('t0'), makeChap('t1')];

  assert.deepStrictEqual(
    [0, 1, 2, 3, 4].map(function(i){ return r.chapIndexIs(i); }).map(function(x){
      return { chapter: x.chapter, reference: x.reference, trash: x.trash, first: x.firstChapter || x.firstReference || x.firstTrash, last: x.lastChapter || x.lastReference || x.lastTrash };
    }),
    [
      { chapter: true, reference: false, trash: false, first: true, last: false },
      { chapter: true, reference: false, trash: false, first: false, last: true },
      { chapter: false, reference: true, trash: false, first: true, last: true },
      { chapter: false, reference: false, trash: true, first: true, last: false },
      { chapter: false, reference: false, trash: true, first: false, last: true }
    ]
  );
  assert.strictEqual(r.chapIndexIs(4).lastAll, true);
});

test('chapIndexIs treats index 0 as a chapter on a brand new, completely empty project', function(){
  var r = freshRender();
  assert.strictEqual(r.project.chapters.length, 0);
  assert.strictEqual(r.chapIndexIs(0).chapter, true);
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
