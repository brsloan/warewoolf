const { JSDOM } = require('jsdom');
const test = require('node:test');
const assert = require('node:assert');

const keybindingsPath = require.resolve('../src/components/controllers/keybindings');
//A pure module with no state of its own, so unlike keybindings.js it does not need re-requiring
//between tests.
const shortcutsModel = require('../src/components/models/shortcuts');

//keybindings.js creates its own platform instance (createPlatform(createIpcBacking())) at
//require-time, same pattern (and same reason) as render.js itself. As of Phase 9a that backing
//talks to window.warewoolf - the object preload.js publishes - rather than to ipcRenderer, so what
//this file installs is a bridge on the global instead of a fake 'electron' in require.cache.
//keybindings.js reaches for exactly one command (showAppMenu), which is why this can stay a
//recording stub rather than a node-backed one.
function fakeBridge(){
  var invoked = [];
  return {
    invoked: invoked,
    invoke: function(name, args){ invoked.push(name); return Promise.resolve(undefined); },
    on: function(){},
    off: function(){}
  };
}

//Escape is one of the two ways out of the Spell Check popup (the other is its own Cancel button),
//so it is where the dictionaries a pass parsed get dropped - see spellcheck.js's getSpellchecker.
//Stubbed rather than exercised for real: what this file has to prove is that the key calls it, and
//the controller would otherwise drag nspell and a platform round trip into every test here.
var spellcheckControllerPath = require.resolve('../src/components/controllers/spellcheck');
var releaseCalls = 0;

function freshKeybindings(){
  delete require.cache[keybindingsPath];
  releaseCalls = 0;
  require.cache[spellcheckControllerPath] = {
    id: spellcheckControllerPath,
    filename: spellcheckControllerPath,
    loaded: true,
    exports: { releaseSpellchecker: function(){ releaseCalls++; } }
  };
  globalThis.warewoolf = fakeBridge();
  return require(keybindingsPath);
}

function currentBridge(){
  return globalThis.warewoolf;
}

//Resolving a promise still takes at least one microtask tick - platform.js's own wrapper adds a
//second, and platform-ipc.js's .then() a third - so anything triggered by a keydown needs this
//before checking what it invoked.
function flushMicrotasks(){
  return new Promise(function(resolve){ setImmediate(resolve); });
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
//getSelection()/setSelection()/root/container/selection.getBounds() for the movement shortcuts (see
//quill-utils.test.js's own tests for the geometry those cover), and on()/off() for
//typewriter-mode.js's editor-change binding. `root` is the real DOM node a shortcut moves focus to.
//
//getBounds() finds nothing, so both paging shortcuts run their "no further to go" path and land at
//index 0 - enough to prove paging ran against THIS instance (setSelectionCallCount) without
//re-testing its own geometry here. The six positions are what tells the two ENDS apart: goToStart
//lands at 0 and goToEnd at 5, so selectionIndex says which of them a key reached.
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
    getLength: function(){ return 6; },
    get setSelectionCallCount(){ return setSelectionCallCount; },
    get selectionIndex(){ return selection.index; },
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
    'jumpToReference', 'togglePanelDisplay', 'toggleChapterNotes', 'updatePanelDisplays',
    'increaseFontSizeSetting', 'decreaseFontSizeSetting', 'increaseEditorWidthSetting',
    'descreaseEditorWidthSetting'
  ].forEach(function(name){
    actions[name] = function(){ calls.push([name].concat(Array.prototype.slice.call(arguments))); };
  });
  actions.calls = calls;
  return actions;
}

//`shortcutOverrides` is what a writer has rebound, in the shape user-settings.json stores (see
//shortcuts.js) - omitted, every shortcut is on its default, which is what all but the rebinding
//tests below want. The map is read through a getter on every keypress, exactly as render.js hands
//it over, so setShortcuts() below can change it mid-test without re-registering anything.
function setup(projectOverrides, shortcutOverrides){
  var dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;

  var project = Object.assign({ activeChapterIndex: 0 }, projectOverrides || {});
  var userSettings = { typewriterMode: false, saveCount: 0, save: function(){ this.saveCount++; } };
  var editorQuill = stubQuill(document.getElementById('editor-container'));
  var notesQuill = stubQuill(document.getElementById('notes-editor'));
  var actions = recordingActions();
  var bindings = shortcutsModel.resolveShortcuts(shortcutOverrides);

  var keybindings = freshKeybindings();
  var unregister = keybindings.registerKeybindings({
    getProject: function(){ return project; },
    getShortcuts: function(){ return bindings; },
    userSettings: userSettings,
    editorQuill: editorQuill,
    notesQuill: notesQuill,
    actions: actions
  });

  return {
    project: project, userSettings: userSettings, editorQuill: editorQuill, notesQuill: notesQuill,
    actions: actions, unregister: unregister,
    setShortcuts: function(overrides){ bindings = shortcutsModel.resolveShortcuts(overrides); }
  };
}

function teardown(env){
  env.unregister();
  delete global.window;
  delete global.document;
  delete require.cache[keybindingsPath];
  delete globalThis.warewoolf;
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

//Escape does not go through closePopups(), so without this the dictionaries a spellcheck pass
//parsed - tens of megabytes each - stayed resident for the rest of the session whenever a writer
//left the popup with the key rather than the Cancel button.
test('Escape releases the dictionaries a spellcheck pass parsed', function(){
  var env = setup();
  document.body.appendChild(Object.assign(document.createElement('div'), { className: 'popup' }));

  keydown(document, 'Escape');

  assert.strictEqual(releaseCalls, 1);

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

test('Ctrl/Cmd+M asks the main process to show the menu', async function(){
  var env = setup();

  keydown(document, 'm', ctrl());
  await flushMicrotasks();

  assert.ok(currentBridge().invoked.includes('showAppMenu'));

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

test('Ctrl/Cmd+Alt+R jumps to Reference from any pane, and leaves the focus where it lands', function(){
  var env = setup();

  keydown('editor-container', 'r', ctrl({ altKey: true }));
  keydown('chapter-list-sidebar', 'r', ctrl({ altKey: true }));

  //From the notes, unlike the chapter keys above, it does NOT hand the focus back to the notes: the
  //jump is a move to a document to read or write in, so the editor is where it should end.
  keydown('notes-editor', 'r', ctrl({ altKey: true }));
  assert.notStrictEqual(document.activeElement, env.notesQuill.root);

  assert.deepStrictEqual(env.actions.calls,
    [['jumpToReference'], ['jumpToReference'], ['jumpToReference']]);

  //A pane shortcut, so it is nothing at all from outside the three.
  env.actions.calls.length = 0;
  keydown(document.body, 'r', ctrl({ altKey: true }));
  assert.deepStrictEqual(env.actions.calls, []);

  teardown(env);
});

test('the Reference jump is rebindable like any other shortcut', function(){
  var env = setup(null, { jumpToReference: { key: 'F9', mod: false, alt: false, shift: false } });

  keydown('editor-container', 'r', ctrl({ altKey: true }));
  assert.deepStrictEqual(env.actions.calls, [], 'no longer on its default');

  keydown('editor-container', 'F9');
  assert.deepStrictEqual(env.actions.calls, [['jumpToReference']]);

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
// Rebound shortcuts
//---------------------------------------------------------------------------

test('a rebound shortcut fires on its new keys, and no longer on its old ones', function(){
  var env = setup(null, { toggleChapterList: { key: 'F8', mod: true, alt: false, shift: false } });

  keydown(document, 'F1');
  assert.deepStrictEqual(env.actions.calls, [], 'the default keys should do nothing once rebound');

  keydown(document, 'F8', ctrl());
  assert.deepStrictEqual(env.actions.calls, [['togglePanelDisplay', 1]]);

  teardown(env);
});

test('a rebound pane shortcut is dispatched from the pane, not the document', function(){
  var env = setup({ activeChapterIndex: 4 }, { moveChapterUp: { key: 'U', mod: true, alt: true, shift: false } });

  keydown(document, 'u', ctrl({ altKey: true }));
  assert.deepStrictEqual(env.actions.calls, [], 'a pane shortcut should not fire from the document');

  keydown('editor-container', 'u', ctrl({ altKey: true }));
  assert.deepStrictEqual(env.actions.calls, [['moveChapUp', 4]]);

  teardown(env);
});

//The bindings are read on every keypress rather than captured when the listeners were registered,
//which is what lets a writer's change take effect the moment they save it.
test('changing the bindings takes effect without re-registering anything', function(){
  var env = setup();

  keydown(document, 'F1');
  assert.deepStrictEqual(env.actions.calls, [['togglePanelDisplay', 1]]);

  env.setShortcuts({ toggleChapterList: { key: 'F9', mod: false, alt: false, shift: false } });

  keydown(document, 'F1');
  keydown(document, 'F9');

  assert.deepStrictEqual(env.actions.calls, [['togglePanelDisplay', 1], ['togglePanelDisplay', 1]]);

  teardown(env);
});

test('a shortcut a writer has unassigned does nothing at all', function(){
  var env = setup(null, { toggleChapterList: null });

  keydown(document, 'F1');
  //A bare modifier press is not a binding, and an unassigned shortcut must not be mistaken for one.
  keydown(document, 'Shift', { shiftKey: true });

  assert.deepStrictEqual(env.actions.calls, []);

  teardown(env);
});

//The other way bindingFromEvent answers null: a key that reported nothing to be identified by. It
//has to be told from an unassigned shortcut for the same reason a bare modifier does - two nulls
//compare equal, so an action nobody bound would otherwise fire on a key nobody can name.
test('a key with nothing to identify it does not fire an unassigned shortcut', function(){
  var env = setup(null, { toggleChapterList: null });

  keydown(document, '\u0000', { code: '', keyCode: 0 });
  keydown(document, 'Unidentified', { code: 'Unidentified', keyCode: 0 });

  assert.deepStrictEqual(env.actions.calls, []);

  teardown(env);
});

//The dispatcher works the pressed key out once for the keypress rather than once per shortcut
//considered, so the binding it compares against is built outside the search. Worth a test of its own
//that the search still finds the right shortcut and still stops at it.
test('the right shortcut fires when several are considered first', function(){
  var env = setup();
  document.getElementById('writing-field').classList.add('visible');

  //Late in the list, so the search walks past every focus and display shortcut to reach it.
  keydown(document, 'F3', { ctrlKey: true });

  assert.deepStrictEqual(env.actions.calls, [['toggleChapterNotes']]);

  teardown(env);
});

//The old if/else chain tested the modifiers it cared about and ignored the rest, so Ctrl+Alt+= was
//a font-size increase and Ctrl+Shift+Left was a focus change as well as a rename.
test('a shortcut does not fire when a modifier it does not name is held', function(){
  var env = setup();
  document.getElementById('writing-field').classList.add('visible');

  keydown(document, '=', ctrl({ altKey: true }));
  keydown(document, 'ArrowLeft', ctrl({ shiftKey: true }));

  assert.deepStrictEqual(env.actions.calls, []);
  assert.notStrictEqual(document.activeElement, env.editorQuill.root);

  teardown(env);
});

//Escape and the menu key are not in the list of what can be rebound, and a settings file that tries
//to put a shortcut on them is refused before this ever sees it (see shortcuts.js isSafeToBind) - so
//they keep working whatever else has been rebound.
test('Escape still closes dialogs even when a settings file tried to bind a shortcut to it', function(){
  var env = setup(null, { toggleChapterList: { key: 'Escape', mod: false, alt: false, shift: false } });
  document.body.appendChild(Object.assign(document.createElement('div'), { className: 'popup' }));

  keydown(document, 'Escape');

  assert.strictEqual(document.querySelector('.popup'), null);
  assert.deepStrictEqual(env.actions.calls, [['updatePanelDisplays']]);

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
  delete globalThis.warewoolf;
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


//---------------------------------------------------------------------------
// Movement within a document
//---------------------------------------------------------------------------

test('Page Up pages up whichever Quill owns the pane it was pressed in', function(){
  var env = setup();

  keydown('editor-container', 'PageUp');
  assert.strictEqual(env.editorQuill.setSelectionCallCount, 1);
  assert.strictEqual(env.notesQuill.setSelectionCallCount, 0);

  keydown('notes-editor', 'PageUp');
  assert.strictEqual(env.notesQuill.setSelectionCallCount, 1);
  assert.strictEqual(env.editorQuill.setSelectionCallCount, 1, 'unchanged from the first dispatch');

  teardown(env);
});

test('Ctrl/Cmd+Home and Ctrl/Cmd+End reach the two ends of the pane they were pressed in', function(){
  var env = setup();

  keydown('editor-container', 'End', ctrl());
  assert.strictEqual(env.editorQuill.selectionIndex, 5, 'the last position a caret can hold');

  keydown('editor-container', 'Home', ctrl());
  assert.strictEqual(env.editorQuill.selectionIndex, 0);

  keydown('notes-editor', 'End', ctrl());
  assert.strictEqual(env.notesQuill.selectionIndex, 5);
  assert.strictEqual(env.editorQuill.selectionIndex, 0, 'the editor is left where it was');

  teardown(env);
});

//The chapter list is on the same listener but holds no text, so there is no caret for these to
//move. The keypress is left alone rather than swallowed to no effect, which is what keeps the list
//scrolling by Page Down the way any list does.
test('paging in the chapter list is left to the list itself', function(){
  var env = setup();

  var evt = keydown('chapter-list-sidebar', 'PageDown');

  assert.strictEqual(env.editorQuill.setSelectionCallCount, 0, 'the editor should not have paged');
  assert.strictEqual(env.notesQuill.setSelectionCallCount, 0);
  assert.strictEqual(evt.defaultPrevented, false, 'the list keeps its own native paging');

  teardown(env);
});

test('a caret key moved onto another shortcut runs that shortcut instead', function(){
  var env = setup({}, { toggleNotes: { key: 'End' }, jumpToEnd: null });

  keydown(document, 'End');

  assert.deepStrictEqual(env.actions.calls, [['togglePanelDisplay', 3]]);
  assert.strictEqual(env.editorQuill.selectionIndex, 0, 'End no longer reaches the end of a document');

  teardown(env);
});

//The reason that guard is read off the keypress rather than off what is bound to it: while a name
//is being typed, Home is the start of the name, whatever the popup has it doing elsewhere.
test('a caret key bound to a shortcut is still left to a text field', function(){
  var env = setup({}, { toggleNotes: { key: 'Home' }, jumpToStart: null });
  var input = document.createElement('input');
  document.body.appendChild(input);

  var evt = keydown(input, 'Home');

  assert.deepStrictEqual(env.actions.calls, [], 'no shortcut should have fired');
  assert.strictEqual(evt.defaultPrevented, false);

  teardown(env);
});

//A matched shortcut swallows its key, without exception. The font-size and editor-width shortcuts
//used to let the keypress through, which was harmless only while they sat on keys with nothing
//native to do - a writer may now put either on a caret key, where it would have meant one press
//doing two things.
test('a shortcut that nudges a setting swallows its key like any other', function(){
  var env = setup({}, { increaseFontSize: { key: 'End' }, jumpToEnd: null });

  var evt = keydown(document, 'End');

  assert.deepStrictEqual(env.actions.calls, [['increaseFontSizeSetting']]);
  assert.strictEqual(evt.defaultPrevented, true);

  teardown(env);
});

test('paging follows a rebind off its own key', function(){
  var env = setup({}, { pageDown: { key: 'J', mod: true } });

  keydown('editor-container', 'PageDown');
  assert.strictEqual(env.editorQuill.setSelectionCallCount, 0, 'the key it was moved off does nothing');

  keydown('editor-container', 'J', ctrl());
  assert.strictEqual(env.editorQuill.setSelectionCallCount, 1);

  teardown(env);
});
