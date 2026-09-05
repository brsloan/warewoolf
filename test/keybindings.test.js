const { JSDOM } = require('jsdom');
const test = require('node:test');
const assert = require('node:assert');

const electronPath = require.resolve('electron');
const keybindingsPath = require.resolve('../src/components/controllers/keybindings');

//keybindings.js destructures `ipcRenderer` from 'electron' at require-time, same pattern (and same
//reason) as render.js itself - faked in require.cache before every (re-)require.
function fakeIpcRenderer(){
  var sent = [];
  return { sent: sent, send: function(channel){ sent.push(channel); } };
}

function freshKeybindings(){
  delete require.cache[keybindingsPath];
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { ipcRenderer: fakeIpcRenderer() }
  };
  return require(keybindingsPath);
}

function currentIpc(){
  return require('electron').ipcRenderer;
}

//The five elements every shortcut below reaches for by id - the same shell render.js's own HTML
//provides, without the sidebar's internal lists or Quill's own markup, neither of which any
//shortcut here touches directly.
function bodyShell(){
  return '<div id="chapter-list-sidebar"></div>' +
    '<div id="writing-field"><div id="editor-container"></div></div>' +
    '<div id="project-notes"><div id="notes-editor"></div></div>';
}

//A stand-in for a Quill instance, carrying only what keybindings.js itself calls: focus(),
//getSelection()/setSelection()/root/container/selection.getBounds() for PageDown (see
//quill-utils.test.js's own goPageDown tests for the geometry those cover), and on()/off() for
//typewriter-mode.js's editor-change binding. `root` is the real DOM node a shortcut moves focus to.
//getBounds() always reporting "past the end" makes goPageDown() a same-value round trip
//(setSelection ends up called with the index it started from) - enough to prove goPageDown ran
//against THIS instance (setSelectionCallCount) without re-testing its own geometry here.
function stubQuill(root){
  //A real Quill root is contenteditable, which is always focusable regardless of tabindex; a
  //plain <div> is not focusable at all without one, so .focus() would silently no-op on it here.
  root.tabIndex = -1;
  var selection = { index: 0, length: 0 };
  var setSelectionCallCount = 0;
  return {
    root: root,
    focus: function(){ root.focus(); },
    hasFocus: function(){ return document.activeElement === root; },
    getSelection: function(){ return selection; },
    setSelection: function(index){ selection = { index: index, length: 0 }; setSelectionCallCount++; },
    get setSelectionCallCount(){ return setSelectionCallCount; },
    container: { getBoundingClientRect: function(){ return { top: 0 }; } },
    selection: { getBounds: function(){ return null; } },
    on: function(){},
    off: function(){}
  };
}

//Records every call made through it, keyed by action name, so a test can assert both that the
//right action fired and with what arguments - without needing render.js's real implementations.
function recordingActions(){
  var calls = [];
  var actions = {};
  ['moveChapUp', 'moveChapDown', 'changeChapterTitle', 'displayPreviousChapter', 'displayNextChapter',
    'togglePanelDisplay', 'toggleChapterNotes', 'updatePanelDisplays', 'increaseFontSizeSetting',
    'decreaseFontSizeSetting', 'increaseEditorWidthSetting', 'descreaseEditorWidthSetting'
  ].forEach(function(name){
    actions[name] = function(){ calls.push([name].concat(Array.prototype.slice.call(arguments))); };
  });
  actions.calls = calls;
  return actions;
}

function setup(projectOverrides){
  var dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;

  var project = Object.assign({ activeChapterIndex: 0 }, projectOverrides || {});
  var userSettings = { typewriterMode: false, saveCount: 0, save: function(){ this.saveCount++; } };
  var editorQuill = stubQuill(document.getElementById('editor-container'));
  var notesQuill = stubQuill(document.getElementById('notes-editor'));
  var actions = recordingActions();

  var keybindings = freshKeybindings();
  var unregister = keybindings.registerKeybindings({
    getProject: function(){ return project; },
    userSettings: userSettings,
    editorQuill: editorQuill,
    notesQuill: notesQuill,
    actions: actions
  });

  return {
    project: project, userSettings: userSettings, editorQuill: editorQuill, notesQuill: notesQuill,
    actions: actions, unregister: unregister
  };
}

function teardown(env){
  env.unregister();
  delete global.window;
  delete global.document;
  delete require.cache[keybindingsPath];
  delete require.cache[electronPath];
}

function keydown(target, key, extra){
  var el = typeof target === 'string' ? document.getElementById(target) : target;
  var evt = new window.KeyboardEvent('keydown', Object.assign(
    { key: key, bubbles: true, cancelable: true }, extra || {}
  ));
  el.dispatchEvent(evt);
  return evt;
}

function ctrl(extra){
  return Object.assign({ ctrlKey: true }, extra || {});
}

//---------------------------------------------------------------------------
// Global shortcuts (dispatched on document)
//---------------------------------------------------------------------------

test('Ctrl/Cmd+Left focuses the editor only while the writing field is visible', function(){
  var env = setup();

  keydown(document, 'ArrowLeft', ctrl());
  assert.notStrictEqual(document.activeElement, env.editorQuill.root);

  document.getElementById('writing-field').classList.add('visible');
  keydown(document, 'ArrowLeft', ctrl());
  assert.strictEqual(document.activeElement, env.editorQuill.root);

  teardown(env);
});

test('Ctrl/Cmd+Left inside a text field is left alone for native cursor movement', function(){
  var env = setup();
  document.getElementById('writing-field').classList.add('visible');
  var input = document.createElement('input');
  document.body.appendChild(input);

  var evt = keydown(input, 'ArrowLeft', ctrl());

  assert.strictEqual(evt.defaultPrevented, false);
  assert.notStrictEqual(document.activeElement, env.editorQuill.root);

  teardown(env);
});

test('Ctrl/Cmd+Right focuses notes only while the notes pane is visible', function(){
  var env = setup();

  keydown(document, 'ArrowRight', ctrl());
  assert.notStrictEqual(document.activeElement, env.notesQuill.root);

  document.getElementById('project-notes').classList.add('visible');
  keydown(document, 'ArrowRight', ctrl());
  assert.strictEqual(document.activeElement, env.notesQuill.root);

  teardown(env);
});

test('Escape clears popups, exits search view, and refreshes the panel layout', function(){
  var env = setup();
  document.body.appendChild(Object.assign(document.createElement('div'), { className: 'popup' }));
  document.body.appendChild(Object.assign(document.createElement('div'), { className: 'popup-dialog' }));
  document.getElementById('chapter-list-sidebar').classList.add('sidebar-search-view');

  keydown(document, 'Escape');

  assert.strictEqual(document.querySelector('.popup'), null);
  assert.strictEqual(document.querySelector('.popup-dialog'), null);
  assert.strictEqual(document.getElementById('chapter-list-sidebar').classList.contains('sidebar-search-view'), false);
  assert.deepStrictEqual(env.actions.calls, [['updatePanelDisplays']]);

  teardown(env);
});

test('Ctrl/Cmd+= and Ctrl/Cmd+- route to the font-size actions', function(){
  var env = setup();

  keydown(document, '=', ctrl());
  keydown(document, '-', ctrl());

  assert.deepStrictEqual(env.actions.calls, [['increaseFontSizeSetting'], ['decreaseFontSizeSetting']]);

  teardown(env);
});

test('Ctrl/Cmd+Alt+T toggles typewriter mode and persists the setting', function(){
  var env = setup();

  keydown(document, 't', ctrl({ altKey: true }));
  assert.strictEqual(env.userSettings.typewriterMode, true);
  assert.strictEqual(env.userSettings.saveCount, 1);

  keydown(document, 't', ctrl({ altKey: true }));
  assert.strictEqual(env.userSettings.typewriterMode, false);
  assert.strictEqual(env.userSettings.saveCount, 2);

  teardown(env);
});

test('Ctrl/Cmd+M asks the main process to show the menu', function(){
  var env = setup();

  keydown(document, 'm', ctrl());

  assert.ok(currentIpc().sent.includes('show-menu'));

  teardown(env);
});

test('F1 and unmodified F2 toggle their panels; Ctrl/Cmd+F2 does not', function(){
  var env = setup();

  keydown(document, 'F1');
  keydown(document, 'F2');
  keydown(document, 'F2', ctrl());

  assert.deepStrictEqual(env.actions.calls, [['togglePanelDisplay', 1], ['togglePanelDisplay', 2]]);

  teardown(env);
});

test('Ctrl/Cmd+F3 toggles chapter notes; unmodified F3 toggles the notes panel', function(){
  var env = setup();

  keydown(document, 'F3', ctrl());
  keydown(document, 'F3');

  assert.deepStrictEqual(env.actions.calls, [['toggleChapterNotes'], ['togglePanelDisplay', 3]]);

  teardown(env);
});

//---------------------------------------------------------------------------
// Per-pane shortcuts (dispatched on one of the three bound elements)
//---------------------------------------------------------------------------

test('Ctrl/Cmd+Shift+Up/Down route to the chapter-reorder actions with the active index', function(){
  var env = setup({ activeChapterIndex: 2 });

  keydown('editor-container', 'ArrowUp', ctrl({ shiftKey: true }));
  keydown('editor-container', 'ArrowDown', ctrl({ shiftKey: true }));

  assert.deepStrictEqual(env.actions.calls, [['moveChapUp', 2], ['moveChapDown', 2]]);

  teardown(env);
});

test('Ctrl/Cmd+Shift+Left renames the active chapter only while the sidebar is visible', function(){
  var env = setup({ activeChapterIndex: 3 });

  keydown('chapter-list-sidebar', 'ArrowLeft', ctrl({ shiftKey: true }));
  assert.deepStrictEqual(env.actions.calls, []);

  document.getElementById('chapter-list-sidebar').classList.add('visible');
  keydown('chapter-list-sidebar', 'ArrowLeft', ctrl({ shiftKey: true }));
  assert.deepStrictEqual(env.actions.calls, [['changeChapterTitle', 3]]);

  teardown(env);
});

test('Ctrl/Cmd+Up/Down move between chapters and focus notes only when triggered from the notes pane', function(){
  var env = setup();

  keydown('editor-container', 'ArrowUp', ctrl());
  assert.notStrictEqual(document.activeElement, env.notesQuill.root);

  keydown('notes-editor', 'ArrowDown', ctrl());
  assert.strictEqual(document.activeElement, env.notesQuill.root);

  assert.deepStrictEqual(env.actions.calls, [['displayPreviousChapter'], ['displayNextChapter']]);

  teardown(env);
});

test('Ctrl/Cmd+, and Ctrl/Cmd+. route to the editor-width actions', function(){
  var env = setup();

  keydown('editor-container', ',', ctrl());
  keydown('editor-container', '.', ctrl());

  assert.deepStrictEqual(env.actions.calls, [['descreaseEditorWidthSetting'], ['increaseEditorWidthSetting']]);

  teardown(env);
});

test('PageDown pages down whichever Quill instance owns the pane it was pressed in, not the other one', function(){
  var env = setup();

  keydown('editor-container', 'PageDown');
  assert.strictEqual(env.editorQuill.setSelectionCallCount, 1);
  assert.strictEqual(env.notesQuill.setSelectionCallCount, 0);

  keydown('notes-editor', 'PageDown');
  assert.strictEqual(env.notesQuill.setSelectionCallCount, 1);
  assert.strictEqual(env.editorQuill.setSelectionCallCount, 1, 'unchanged from the first dispatch');

  teardown(env);
});

//---------------------------------------------------------------------------
// unregister()
//---------------------------------------------------------------------------

test('unregister() removes all four listeners, so a later keydown does nothing', function(){
  var env = setup();
  document.getElementById('writing-field').classList.add('visible');

  env.unregister();
  keydown(document, 'ArrowLeft', ctrl());
  keydown('editor-container', 'PageDown');

  assert.notStrictEqual(document.activeElement, env.editorQuill.root);
  assert.strictEqual(env.editorQuill.setSelectionCallCount, 0, 'PageDown should not have run after unregister');

  delete global.window;
  delete global.document;
  delete require.cache[keybindingsPath];
  delete require.cache[electronPath];
});

//---------------------------------------------------------------------------
// Text fields inside the panes
//---------------------------------------------------------------------------

//The chapter rename box is a real <input> living inside the sidebar pane, so the pane's own
//keydown listener sees everything typed into it. The global listener already stepped aside for
//Ctrl/Cmd+Left/Right there; the pane listener did not, so the shortcuts below still fired - and
//since each of them re-renders the sidebar, they tore the rename box down mid-edit.
function renameBoxInSidebar(){
  var box = document.createElement('input');
  box.type = 'text';
  box.classList.add('name-box');
  document.getElementById('chapter-list-sidebar').appendChild(box);
  return box;
}

test('Ctrl/Cmd+Shift+Left in the chapter rename box is left to the text field', function(){
  var env = setup();
  document.getElementById('chapter-list-sidebar').classList.add('visible');
  var box = renameBoxInSidebar();

  var evt = keydown(box, 'ArrowLeft', ctrl({ shiftKey: true }));

  assert.deepStrictEqual(env.actions.calls, [], 'no shortcut should have fired');
  assert.strictEqual(evt.defaultPrevented, false,
    'the field keeps its native extend-selection-by-word');
  teardown(env);
});

test('Ctrl/Cmd+Shift+Up in the chapter rename box does not reorder chapters', function(){
  var env = setup();
  var box = renameBoxInSidebar();

  keydown(box, 'ArrowUp', ctrl({ shiftKey: true }));

  assert.deepStrictEqual(env.actions.calls, []);
  teardown(env);
});

test('Ctrl/Cmd+Up in the chapter rename box does not change chapters', function(){
  var env = setup();
  var box = renameBoxInSidebar();

  keydown(box, 'ArrowUp', ctrl());

  assert.deepStrictEqual(env.actions.calls, []);
  teardown(env);
});

test('PageDown in the chapter rename box is left to the text field', function(){
  var env = setup();
  var box = renameBoxInSidebar();
  var before = env.editorQuill.setSelectionCallCount;

  var evt = keydown(box, 'PageDown');

  assert.strictEqual(env.editorQuill.setSelectionCallCount, before);
  assert.strictEqual(evt.defaultPrevented, false);
  teardown(env);
});

test('the same shortcuts still work when the pane itself has focus', function(){
  var env = setup();
  document.getElementById('chapter-list-sidebar').classList.add('visible');

  keydown('chapter-list-sidebar', 'ArrowUp', ctrl({ shiftKey: true }));
  keydown('chapter-list-sidebar', 'ArrowLeft', ctrl({ shiftKey: true }));

  assert.deepStrictEqual(env.actions.calls, [
    ['moveChapUp', 0],
    ['changeChapterTitle', 0]
  ]);
  teardown(env);
});
