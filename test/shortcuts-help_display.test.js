const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const shortcutsHelpDisplayPath = require.resolve('../src/components/views/shortcuts-help_display');
const shortcuts = require('../src/components/models/shortcuts');

//closePopups() also calls disableSearchView()/focusEditor(), which reach for this fixed shell by
//id - same shell used in outliner_display.test.js / renumber-chapters_display.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

function keydown(target, key, extra){
  var event = new window.KeyboardEvent('keydown', Object.assign({
    key: key,
    bubbles: true,
    cancelable: true
  }, extra || {}));

  target.dispatchEvent(event);
  return event;
}

//The popup as render.js opens it: the bindings in force, and somewhere to save a change to. The
//saves it records are what render.js would have been handed.
function showEditable(t, options){
  var showShortcutsHelp = require(shortcutsHelpDisplayPath);
  var saved = [];

  showShortcutsHelp(Object.assign({
    isMac: false,
    bindings: shortcuts.resolveShortcuts(null),
    onSave: function(overrides){ saved.push(overrides); }
  }, options || {}));

  return saved;
}

function buttonLabelled(text){
  return Array.from(document.querySelectorAll('button')).find(function(button){
    return button.textContent === text;
  });
}

//The button showing a given shortcut's keys, found by the row it sits in.
function keyButtonFor(label){
  var row = Array.from(document.querySelectorAll('.shortcuts-table tr')).find(function(candidate){
    return candidate.cells[0].innerText === label;
  });

  return row ? row.cells[1].querySelector('button') : null;
}

//The message a shortcut is currently showing, which lives in a row of its own directly beneath
//that shortcut - the list is longer than the popup, so a message about the row a writer is looking
//at has to be next to it rather than at the end. Empty when it has nothing to say, so a test can
//assert silence the same way it asserts a message.
function messageFor(label){
  var rows = Array.from(document.querySelectorAll('.shortcuts-table tr'));
  var index = rows.findIndex(function(row){
    return row.cells[0].innerText === label;
  });
  var next = rows[index + 1];

  if(next == null || !next.classList.contains('shortcut-message-row') || next.hidden)
    return '';

  return next.cells[0].innerText;
}

//The message about the list as a whole, next to the buttons that act on all of it.
function listMessage(){
  return document.querySelector('p.shortcut-message').innerText;
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[shortcutsHelpDisplayPath];
  delete global.window;
  delete global.document;
});

//---------------------------------------------------------------------------
// the list
//---------------------------------------------------------------------------

test('renders a table of shortcuts per section using Cmd on Mac and Ctrl elsewhere', function(t){
  var showShortcutsHelp = require(shortcutsHelpDisplayPath);

  showShortcutsHelp({ isMac: true });
  assert.match(document.querySelector('.shortcuts-table td').innerText, /^View Previous Chapter$/);
  assert.match(document.querySelectorAll('.shortcuts-table td')[1].innerText, /^Cmd \+ Up$/);

  showShortcutsHelp({ isMac: false });
  assert.match(document.querySelectorAll('.shortcuts-table td')[1].innerText, /^Ctrl \+ Up$/);
});

//The list used to be a copy of its own, which is how it came to document a shortcut the app did not
//implement. Every rebindable action now has a row, and the row shows what it is actually bound to.
test('every rebindable shortcut has a row showing the binding in force', function(t){
  showEditable(t, {
    bindings: shortcuts.resolveShortcuts({ formatBold: { key: 'W', mod: true, alt: false, shift: true } })
  });

  shortcuts.getShortcutDefs().forEach(function(def){
    assert.ok(keyButtonFor(def.label) != null, def.label + ' should have a row');
  });

  assert.strictEqual(keyButtonFor('Bold').textContent, 'Ctrl + Shift + W');
  assert.strictEqual(keyButtonFor('View Previous Chapter').textContent, 'Ctrl + Up');
});

//Escape, Tab and the menu key are the app's own structural keys - the popup documents them, but
//they are not on offer, since Escape is how a writer gets out of this dialog.
test('the Tool/Menu Navigation shortcuts are printed rather than offered', function(t){
  showEditable(t);

  var row = Array.from(document.querySelectorAll('.shortcuts-table tr')).find(function(candidate){
    return candidate.cells[0].innerText === 'Close Tool Dialog';
  });

  assert.strictEqual(row.cells[1].innerText, 'Escape');
  assert.strictEqual(row.cells[1].querySelector('button'), null);
});

//Nothing to save to means the list rather than the editor - no buttons in the rows, and none of
//the controls that change anything.
test('without somewhere to save, the shortcuts are shown as plain text', function(t){
  var showShortcutsHelp = require(shortcutsHelpDisplayPath);
  showShortcutsHelp({ isMac: false });

  assert.strictEqual(keyButtonFor('Bold'), null);
  assert.strictEqual(buttonLabelled('Save'), undefined);
  assert.strictEqual(buttonLabelled('Restore Defaults'), undefined);
  assert.ok(buttonLabelled('Close') != null);
});

test('Close button removes the popup', function(t){
  var showShortcutsHelp = require(shortcutsHelpDisplayPath);
  showShortcutsHelp({ isMac: false });

  buttonLabelled('Close').onclick();

  assert.strictEqual(document.getElementsByClassName('popup').length, 0);
});

//Regression: the popup's own "Close Tool Dialog: Escape" row documented a shortcut it didn't
//actually implement - it never listened for Escape, so the only way to close it was clicking Close.
test('pressing Escape inside the popup closes it', function(t){
  var showShortcutsHelp = require(shortcutsHelpDisplayPath);
  showShortcutsHelp({ isMac: false });

  var popup = document.querySelector('.popup');
  keydown(popup, 'Escape');

  assert.strictEqual(document.getElementsByClassName('popup').length, 0);
});

test('other keys pressed inside the popup do not close it', function(t){
  var showShortcutsHelp = require(shortcutsHelpDisplayPath);
  showShortcutsHelp({ isMac: false });

  var popup = document.querySelector('.popup');
  keydown(popup, 'Tab');

  assert.strictEqual(document.getElementsByClassName('popup').length, 1);
});

//---------------------------------------------------------------------------
// rebinding
//---------------------------------------------------------------------------

test('choosing a shortcut and pressing keys assigns them to it', function(t){
  showEditable(t);
  var button = keyButtonFor('Bold');

  button.onclick();
  assert.strictEqual(button.textContent, 'Press keys...');

  keydown(document, 'w', { ctrlKey: true, shiftKey: true, code: 'KeyW' });

  assert.strictEqual(button.textContent, 'Ctrl + Shift + W');
  assert.match(messageFor('Bold'), /Bold is now Ctrl \+ Shift \+ W/);
});

//Nothing may act on the keypress that is being captured - not the popup's own Escape handler, not
//the app's shortcuts underneath it, not the editor.
test('a captured keypress is stopped rather than acted on', function(t){
  showEditable(t);
  var reachedDocument = false;
  document.addEventListener('keydown', function(){ reachedDocument = true; });

  keyButtonFor('Bold').onclick();
  var event = keydown(document, 'y', { ctrlKey: true, code: 'KeyY' });

  assert.strictEqual(event.defaultPrevented, true);
  assert.strictEqual(reachedDocument, false);
});

//A writer part-way through a combination has pressed Ctrl and nothing else yet.
test('a modifier held on its own does not end the capture', function(t){
  showEditable(t);
  var button = keyButtonFor('Bold');

  button.onclick();
  keydown(document, 'Control', { ctrlKey: true });

  assert.strictEqual(button.textContent, 'Press keys...');
});

//The reported symptom, from a writer whose keyboard sends something Chromium has no name for: the
//capture said nothing at all, so there was no telling a refused key from one the app had not seen.
//The readout is the diagnostic - and it names the codepoint rather than reprinting the glyphless
//character that started the whole question.
test('a key the app cannot name says so, and says what arrived', function(t){
  showEditable(t);
  var button = keyButtonFor('Bold');

  button.onclick();
  keydown(document, 'Unidentified', { ctrlKey: true, code: 'F25' });

  assert.match(messageFor('Bold'), /cannot be used in a shortcut/);
  assert.match(messageFor('Bold'), /key "Unidentified", code "F25"/);
  assert.strictEqual(button.textContent, 'Press keys...', 'still capturing, so another key can be tried');
});

test('an unrenderable character is reported as its codepoint, not reprinted', function(t){
  showEditable(t);
  var button = keyButtonFor('Bold');

  button.onclick();
  keydown(document, '\ue011', { ctrlKey: true, code: 'Unidentified' });

  assert.match(messageFor('Bold'), /key U\+E011/);
  assert.ok(messageFor('Bold').indexOf('\ue011') === -1, 'the glyphless character must not be echoed');
  assert.strictEqual(button.textContent, 'Press keys...');
});

//Now bindable, and with nothing held: these type nothing, so a writer whose F-row sits on its media
//layer can bind the keys their board actually sends.
test('a key that types nothing is bound bare, under a readable name', function(t){
  var saved = showEditable(t);
  var button = keyButtonFor('Bold');

  button.onclick();
  keydown(document, 'AudioVolumeUp', { code: 'AudioVolumeUp' });

  assert.strictEqual(button.textContent, 'Volume Up');

  buttonLabelled('Save').onclick();
  assert.deepStrictEqual(saved, [{
    formatBold: { key: 'AudioVolumeUp', mod: false, alt: false, shift: false, code: 'AudioVolumeUp' }
  }]);
});

test('Escape cancels a rebind and leaves the shortcut as it was', function(t){
  var saved = showEditable(t);
  var button = keyButtonFor('Bold');

  button.onclick();
  keydown(document, 'Escape');

  assert.strictEqual(button.textContent, 'Ctrl + B');

  //The popup must still be open: the keypress that cancelled the rebind cannot also close it.
  assert.strictEqual(document.getElementsByClassName('popup').length, 1);

  buttonLabelled('Save').onclick();
  assert.deepStrictEqual(saved, [{}]);
});

test('Backspace clears a shortcut, and the cleared state is what gets saved', function(t){
  var saved = showEditable(t);
  var button = keyButtonFor('Bold');

  button.onclick();
  keydown(document, 'Backspace');

  assert.strictEqual(button.textContent, 'None');
  assert.match(messageFor('Bold'), /unassigned/);

  buttonLabelled('Save').onclick();
  assert.deepStrictEqual(saved, [{ formatBold: null }]);
});

test('a refused binding says why and leaves the writer still choosing', function(t){
  showEditable(t);
  var button = keyButtonFor('Bold');

  button.onclick();
  keydown(document, 'k', { ctrlKey: true, code: 'KeyK' });

  assert.match(messageFor('Bold'), /Strikethrough already uses that shortcut/);
  assert.strictEqual(button.textContent, 'Press keys...', 'still capturing, so another key can be tried');

  keydown(document, 'y', { ctrlKey: true, code: 'KeyY' });
  assert.strictEqual(button.textContent, 'Ctrl + Y');
});

test('a key the app needs for itself is refused with the reason', function(t){
  showEditable(t);
  var button = keyButtonFor('Bold');

  button.onclick();
  keydown(document, 'Tab', { ctrlKey: true });

  assert.match(messageFor('Bold'), /Tab moves between inputs/);
  assert.strictEqual(button.textContent, 'Press keys...');
});

test('a menu accelerator is refused, naming the menu item that holds it', function(t){
  showEditable(t);
  var button = keyButtonFor('Bold');

  button.onclick();
  keydown(document, 's', { ctrlKey: true, code: 'KeyS' });

  assert.match(messageFor('Bold'), /Save menu item/);
});

//Regression: every message used to appear in one line under the buttons at the end of the popup.
//The list is longer than the screen, so a writer being told why their key was refused had to scroll
//past thirty rows to find out - if they knew there was anything to find.
test('a message about a shortcut appears in the row directly beneath it', function(t){
  showEditable(t);

  keyButtonFor('Bold').onclick();
  keydown(document, 's', { ctrlKey: true, code: 'KeyS' });

  assert.match(messageFor('Bold'), /Save menu item/);
  assert.strictEqual(listMessage(), '', 'nothing should be left at the end of the popup');
  assert.strictEqual(messageFor('Italics'), '', 'no other shortcut should be showing a message');
});

//Only one message at a time, or a refusal would be left behind under a shortcut the writer has
//since moved on from.
test('a message is taken down when another shortcut is chosen', function(t){
  showEditable(t);

  keyButtonFor('Bold').onclick();
  keydown(document, 's', { ctrlKey: true, code: 'KeyS' });
  assert.notStrictEqual(messageFor('Bold'), '');

  keyButtonFor('Italics').onclick();

  assert.strictEqual(messageFor('Bold'), '');
});

//Starting a second rebind must not leave the first one stuck asking for keys.
test('choosing another shortcut ends the rebind in progress', function(t){
  showEditable(t);
  var bold = keyButtonFor('Bold');
  var italics = keyButtonFor('Italics');

  bold.onclick();
  italics.onclick();

  assert.strictEqual(bold.textContent, 'Ctrl + B');
  assert.strictEqual(italics.textContent, 'Press keys...');
});

//---------------------------------------------------------------------------
// saving and restoring
//---------------------------------------------------------------------------

//Only what differs from the defaults is handed over, which is what gets stored.
test('Save reports only the shortcuts that were changed, and closes the popup', function(t){
  var saved = showEditable(t);

  keyButtonFor('Bold').onclick();
  keydown(document, 'y', { ctrlKey: true, code: 'KeyY' });
  buttonLabelled('Save').onclick();

  assert.deepStrictEqual(saved, [{ formatBold: { key: 'Y', mod: true, alt: false, shift: false, code: 'KeyY' } }]);
  assert.strictEqual(document.getElementsByClassName('popup').length, 0);
});

//The popup edits a copy, so walking away from a rebind leaves the app's own bindings alone.
test('Close abandons the changes rather than saving them', function(t){
  var bindings = shortcuts.resolveShortcuts(null);
  var saved = showEditable(t, { bindings: bindings });

  keyButtonFor('Bold').onclick();
  keydown(document, 'y', { ctrlKey: true, code: 'KeyY' });
  buttonLabelled('Close').onclick();

  assert.deepStrictEqual(saved, []);
  assert.deepStrictEqual(bindings.formatBold, shortcuts.getDefaultBindings().formatBold);
});

test('Restore Defaults puts every shortcut back, and saves as no overrides at all', function(t){
  var saved = showEditable(t, {
    bindings: shortcuts.resolveShortcuts({
      formatBold: { key: 'W', mod: true, alt: false, shift: false },
      toggleNotes: null
    })
  });

  assert.strictEqual(keyButtonFor('Bold').textContent, 'Ctrl + W');

  buttonLabelled('Restore Defaults').onclick();

  assert.strictEqual(keyButtonFor('Bold').textContent, 'Ctrl + B');
  assert.strictEqual(keyButtonFor('Toggle Notes Display').textContent, 'F3');
  assert.match(listMessage(), /Defaults restored/);

  buttonLabelled('Save').onclick();
  assert.deepStrictEqual(saved, [{}]);
});

//Restoring is a change like any other, held until Save - so Close walks away from it too.
test('Restore Defaults does not take effect until Save', function(t){
  var saved = showEditable(t, {
    bindings: shortcuts.resolveShortcuts({ formatBold: { key: 'W', mod: true, alt: false, shift: false } })
  });

  buttonLabelled('Restore Defaults').onclick();
  buttonLabelled('Close').onclick();

  assert.deepStrictEqual(saved, []);
});
