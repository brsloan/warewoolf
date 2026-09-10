const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const shortcuts = require('../src/components/models/shortcuts');

//The model is pure data and pure functions - no DOM, no platform, nothing to stub - so unlike most
//of this suite these tests need no fixture beyond the module itself.

//A stand-in for the KeyboardEvent a listener is handed. Only the five properties the model reads.
function keyEvent(key, extra){
  return Object.assign({ key: key, code: undefined, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false },
    extra || {});
}

//---------------------------------------------------------------------------
// defaults
//---------------------------------------------------------------------------

test('every default shortcut is a complete, normalized binding', function(){
  var defaults = shortcuts.getDefaultBindings();

  shortcuts.getShortcutDefs().forEach(function(def){
    var binding = defaults[def.id];
    assert.ok(binding != null, def.id + ' should have a default binding');
    assert.strictEqual(shortcuts.normalizeKeyName(binding.key), binding.key, def.id + ' key should be stored normalized');
    ['mod', 'alt', 'shift'].forEach(function(flag){
      assert.strictEqual(typeof binding[flag], 'boolean', def.id + '.' + flag + ' should be a boolean');
    });
    assert.ok(shortcuts.SECTIONS.indexOf(def.section) !== -1, def.id + ' should be in a known section');
    assert.ok(['global', 'pane', 'quill'].indexOf(def.target) !== -1, def.id + ' should have a known target');
  });
});

test('the defaults carry over the shortcuts the app shipped with', function(){
  var defaults = shortcuts.getDefaultBindings();

  assert.deepStrictEqual(defaults.previousChapter, { key: 'ArrowUp', mod: true, alt: false, shift: false });
  assert.deepStrictEqual(defaults.moveChapterUp, { key: 'ArrowUp', mod: true, alt: false, shift: true });
  assert.deepStrictEqual(defaults.formatBold, { key: 'B', mod: true, alt: false, shift: false });
  assert.deepStrictEqual(defaults.formatList, { key: 'B', mod: true, alt: false, shift: true });
  assert.deepStrictEqual(defaults.formatBlockquote, { key: 'Q', mod: true, alt: false, shift: true });
  assert.deepStrictEqual(defaults.toggleChapterList, { key: 'F1', mod: false, alt: false, shift: false });
  assert.deepStrictEqual(defaults.typewriterMode, { key: 'T', mod: true, alt: true, shift: false });
});

//Two actions sharing a binding would mean one of them silently never fires. The defaults are the
//one set of bindings nothing validates before use, so they get checked here instead.
test('no two default shortcuts share a binding', function(){
  var defaults = shortcuts.getDefaultBindings();
  var ids = Object.keys(defaults);

  ids.forEach(function(id){
    var conflict = shortcuts.findConflict(defaults[id], id, defaults);
    assert.strictEqual(conflict, null,
      id + ' shares its default binding with ' + (conflict && conflict.id));
  });
});

test('action ids are unique', function(){
  var ids = shortcuts.getShortcutDefs().map(function(def){ return def.id; });
  assert.strictEqual(new Set(ids).size, ids.length);
});

//getShortcutDefs()/getDefaultBindings() hand out copies. A caller that edits what it gets back -
//the popup does exactly that while a writer is rebinding - must not be editing the defaults.
test('the defaults cannot be mutated through what the getters return', function(){
  var defs = shortcuts.getShortcutDefs();
  defs[0].defaultBinding.key = 'Z';

  var bindings = shortcuts.getDefaultBindings();
  bindings.formatBold.mod = false;

  assert.strictEqual(shortcuts.getShortcutDefs()[0].defaultBinding.key, 'ArrowUp');
  assert.strictEqual(shortcuts.getDefaultBindings().formatBold.mod, true);
});

//---------------------------------------------------------------------------
// key normalization
//---------------------------------------------------------------------------

test('normalizeKeyName uppercases single characters and canonicalizes named keys', function(){
  assert.strictEqual(shortcuts.normalizeKeyName('b'), 'B');
  assert.strictEqual(shortcuts.normalizeKeyName('B'), 'B');
  assert.strictEqual(shortcuts.normalizeKeyName(','), ',');
  assert.strictEqual(shortcuts.normalizeKeyName(' '), 'Space');
  assert.strictEqual(shortcuts.normalizeKeyName('arrowup'), 'ArrowUp');
  assert.strictEqual(shortcuts.normalizeKeyName('f3'), 'F3');
});

test('normalizeKeyName rejects anything that could not be dispatched again', function(){
  [null, undefined, '', 42, {}, 'Unidentified', 'F25', 'Meta'].forEach(function(value){
    assert.strictEqual(shortcuts.normalizeKeyName(value), null, String(value) + ' should not normalize');
  });
});

//A programmable keyboard's extra keys, and the media layer a compact board's F-row sits on until its
//Fn key is held. Refusing these left a writer on such a board unable to bind their F-row at all.
test('normalizeKeyName accepts the keys an unusual keyboard sends', function(){
  ['F13', 'F24', 'AudioVolumeUp', 'MediaPlayPause', 'BrowserSearch', 'ContextMenu', 'ScrollLock']
    .forEach(function(key){
      assert.strictEqual(shortcuts.normalizeKeyName(key), key, key + ' should be storable');
    });

  assert.strictEqual(shortcuts.normalizeKeyName('audiovolumeup'), 'AudioVolumeUp');
});

//The reported symptom: a key Chromium had no name for arrived as a character with no glyph, and the
//popup stored it and printed it as an empty rectangle - a shortcut a writer could neither read nor
//describe. Refused, so it comes back through describeKeyEvent as something legible instead.
test('normalizeKeyName rejects a character with no glyph to print', function(){
  ['\u0000', '\u001b', '\u007f', '\ue011', '\uf8ff'].forEach(function(char){
    assert.strictEqual(shortcuts.normalizeKeyName(char), null,
      'U+' + char.codePointAt(0).toString(16) + ' should not normalize');
  });

  //Ordinary printable keys are untouched by that check.
  ['b', '1', ',', '=', '-', '`', '/', '\\', ';', "'", '[', ']'].forEach(function(char){
    assert.strictEqual(shortcuts.normalizeKeyName(char), char.toUpperCase(),
      char + ' should still normalize');
  });
});

//The keys that report a name of their own bind by it, as any key does. Brightness was missing from
//the list purely because it was written from the standard media keys and these sit beside them.
test('the screen keys are bindable by name like the rest of a top row', function(){
  ['BrightnessUp', 'BrightnessDown', 'ZoomToggle'].forEach(function(key){
    assert.strictEqual(shortcuts.normalizeKeyName(key), key);
    assert.strictEqual(shortcuts.canBindAlone(key), true);
  });
});

//---------------------------------------------------------------------------
// bindings identified by their code
//---------------------------------------------------------------------------

//A keyboard is free to report no key name at all - U+0000, on the top row this was reported from -
//while still reporting a good physical code. The code is enough to bind by, and the alternative is
//telling a writer their key is unusable when it plainly is not.
test('a key with no name is bound by its code instead', function(){
  var binding = shortcuts.bindingFromEvent(keyEvent('\u0000', { code: 'ShowAllWindows', keyCode: 182 }));

  assert.deepStrictEqual(binding,
    { key: null, code: 'ShowAllWindows', mod: false, alt: false, shift: false, keyCode: 182 });
  assert.strictEqual(shortcuts.formatBinding(binding, false), 'Show All Windows');
});

//A code-identified binding dispatches on its code, so it has to match the key it came from and
//nothing else.
test('a code-identified binding matches its own key and no other', function(){
  var binding = shortcuts.makeCodeBinding('ShowAllWindows', {});

  assert.ok(shortcuts.bindingMatchesEvent(binding, keyEvent('\u0000', { code: 'ShowAllWindows' })));
  assert.ok(!shortcuts.bindingMatchesEvent(binding, keyEvent('\u0000', { code: 'BrightnessUp' })));
  assert.ok(!shortcuts.bindingMatchesEvent(binding, keyEvent('\u0000', { code: 'ShowAllWindows', ctrlKey: true })));
});

//Both keys would fire, and the popup would have shown no conflict to explain it.
test('a code-identified binding conflicts with a named one on the same physical key', function(){
  var named = shortcuts.makeBinding('T', { mod: true, code: 'KeyT' });
  var byCode = shortcuts.makeCodeBinding('KeyT', { mod: true });

  assert.ok(shortcuts.bindingsEqual(named, byCode));
  assert.ok(!shortcuts.bindingsEqual(named, shortcuts.makeCodeBinding('KeyW', { mod: true })));
});

//Two named bindings are still compared on their names alone - a writer on another layout reaches the
//same key from a different code, and that has to keep meaning the same shortcut.
test('two named bindings are still compared without their codes', function(){
  assert.ok(shortcuts.bindingsEqual(
    shortcuts.makeBinding('T', { mod: true, code: 'KeyT' }),
    shortcuts.makeBinding('T', { mod: true, code: 'KeyY' })));
});

test('a key with neither a name nor a usable code is no binding at all', function(){
  assert.strictEqual(shortcuts.bindingFromEvent(keyEvent('\u0000', { code: '' })), null);
  assert.strictEqual(shortcuts.bindingFromEvent(keyEvent('Unidentified', { code: 'Unidentified' })), null);
  assert.strictEqual(shortcuts.makeCodeBinding('not a code!', {}), null);
  assert.strictEqual(shortcuts.makeCodeBinding(undefined, {}), null);
});

//A code long enough for the ones a Chromebook top row sends: the old 20-character cap would have
//dropped this one out of the settings file without a word.
test('a code is stored up to the length the longest real one needs', function(){
  var binding = shortcuts.sanitizeBinding({ key: null, code: 'KeyboardBacklightToggle' });

  assert.strictEqual(binding.code, 'KeyboardBacklightToggle');
  assert.strictEqual(shortcuts.sanitizeBinding({ key: null, code: 'x'.repeat(33) }), null);
});

test('a code-identified binding survives the settings file round trip', function(){
  var overrides = shortcuts.sanitizeOverrides({
    formatBold: { key: null, code: 'ShowAllWindows', mod: false, alt: false, shift: false }
  });

  assert.deepStrictEqual(overrides.formatBold,
    { key: null, code: 'ShowAllWindows', mod: false, alt: false, shift: false });
  assert.deepStrictEqual(shortcuts.resolveShortcuts(overrides).formatBold, overrides.formatBold);
});

//The keys the app cannot give up are refused however they are spelled - a hand-edited file naming
//them by code would otherwise get in through the door the code path opened.
test('a code-identified binding cannot take a key the app needs', function(){
  ['Escape', 'Tab', 'Enter'].forEach(function(code){
    assert.strictEqual(shortcuts.sanitizeBinding({ key: null, code: code }), null, code);
  });

  assert.strictEqual(shortcuts.sanitizeBinding({ key: null, code: 'KeyM', mod: true }), null,
    'the menu bar shortcut, reached by its code');
});

test('a code-identified binding says why when it is refused', function(){
  var bindings = shortcuts.getDefaultBindings();

  var menu = shortcuts.validateBinding({ key: null, code: 'KeyM', mod: true }, 'formatBold', bindings);
  assert.strictEqual(menu.valid, false);
  assert.match(menu.message, /menu bar/);

  var reserved = shortcuts.validateBinding({ key: null, code: 'Escape' }, 'formatBold', bindings);
  assert.strictEqual(reserved.valid, false);
  assert.match(reserved.message, /Escape closes dialogs/);
});

//---------------------------------------------------------------------------

test('describeKeyEvent says what arrived, without reprinting an unrenderable character', function(){
  assert.strictEqual(shortcuts.describeKeyEvent(keyEvent('Unidentified', { code: 'F13' })),
    'Your keyboard reported key "Unidentified", code "F13".');

  assert.strictEqual(shortcuts.describeKeyEvent(keyEvent('\ue011', { code: '' })),
    'Your keyboard reported key U+E011.');

  assert.strictEqual(shortcuts.describeKeyEvent(keyEvent(undefined, { code: 'Unidentified' })),
    'Your keyboard reported key (none), code "Unidentified".');
});

//With neither a name nor a code the keyCode is the last thing that could tell one such key from
//another, so the readout has to carry it - including when it is 0, which is the answer that they
//cannot be told apart at all.
test('describeKeyEvent falls back to the keyCode when there is nothing else', function(){
  assert.strictEqual(shortcuts.describeKeyEvent(keyEvent('\u0000', { code: '', keyCode: 182 })),
    'Your keyboard reported key U+0000, keyCode 182.');

  assert.strictEqual(shortcuts.describeKeyEvent(keyEvent('\u0000', { code: '', keyCode: 0 })),
    'Your keyboard reported key U+0000, keyCode 0.');

  //A key with a usable code is identified by it, so the keyCode adds nothing worth printing.
  assert.strictEqual(shortcuts.describeKeyEvent(keyEvent('\u0000', { code: 'ShowAllWindows', keyCode: 182 })),
    'Your keyboard reported key U+0000, code "ShowAllWindows".');
});

test('isModifierKeyEvent tells a held modifier from a key with no usable name', function(){
  assert.strictEqual(shortcuts.isModifierKeyEvent(keyEvent('Shift', { shiftKey: true })), true);
  assert.strictEqual(shortcuts.isModifierKeyEvent(keyEvent('Unidentified')), false);
  assert.strictEqual(shortcuts.isModifierKeyEvent(null), false);
});

test('codeForKey guesses the physical key behind a key name', function(){
  assert.strictEqual(shortcuts.codeForKey('T'), 'KeyT');
  assert.strictEqual(shortcuts.codeForKey('1'), 'Digit1');
  assert.strictEqual(shortcuts.codeForKey(','), 'Comma');
  assert.strictEqual(shortcuts.codeForKey('='), 'Equal');
  assert.strictEqual(shortcuts.codeForKey('ArrowUp'), 'ArrowUp');
  assert.strictEqual(shortcuts.codeForKey('F3'), 'F3');
  assert.strictEqual(shortcuts.codeForKey('F13'), 'F13');
  assert.strictEqual(shortcuts.codeForKey('AudioVolumeUp'), 'AudioVolumeUp');
  //The one pair the spec spells differently for key and code.
  assert.strictEqual(shortcuts.codeForKey('LaunchApplication1'), 'LaunchApp1');
  assert.strictEqual(shortcuts.codeForKey('nonsense'), null);
});

//---------------------------------------------------------------------------
// bindings from events
//---------------------------------------------------------------------------

test('Ctrl and Cmd both produce the same binding', function(){
  var withCtrl = shortcuts.bindingFromEvent(keyEvent('b', { ctrlKey: true }));
  var withCmd = shortcuts.bindingFromEvent(keyEvent('b', { metaKey: true }));

  assert.ok(shortcuts.bindingsEqual(withCtrl, withCmd));
  assert.strictEqual(withCtrl.mod, true);
});

//Ctrl+B and Ctrl+Shift+B arrive as 'b' and 'B'. Normalizing the case is what leaves the Shift flag
//as the only thing telling Bold from Bullets/Numbered List.
test('a shifted letter is told from an unshifted one by its flag, not its case', function(){
  var bold = shortcuts.bindingFromEvent(keyEvent('b', { ctrlKey: true }));
  var list = shortcuts.bindingFromEvent(keyEvent('B', { ctrlKey: true, shiftKey: true }));

  assert.strictEqual(bold.key, list.key);
  assert.strictEqual(bold.shift, false);
  assert.strictEqual(list.shift, true);
  assert.ok(!shortcuts.bindingsEqual(bold, list));
});

test('bindingFromEvent keeps the physical code when the event carries one', function(){
  var binding = shortcuts.bindingFromEvent(keyEvent('t', { ctrlKey: true, code: 'KeyT' }));
  assert.strictEqual(binding.code, 'KeyT');

  var noCode = shortcuts.bindingFromEvent(keyEvent('t', { ctrlKey: true }));
  assert.ok(!('code' in noCode));
});

test('a modifier pressed on its own is not a binding', function(){
  ['Control', 'Shift', 'Alt', 'Meta', 'CapsLock'].forEach(function(key){
    assert.strictEqual(shortcuts.bindingFromEvent(keyEvent(key, { shiftKey: true })), null, key);
  });

  assert.strictEqual(shortcuts.bindingFromEvent(null), null);
  assert.strictEqual(shortcuts.bindingFromEvent(keyEvent('Unidentified')), null);
});

test('bindingMatchesEvent matches on the modifiers as well as the key', function(){
  var binding = shortcuts.makeBinding('ArrowUp', { mod: true, shift: true });

  assert.ok(shortcuts.bindingMatchesEvent(binding, keyEvent('ArrowUp', { ctrlKey: true, shiftKey: true })));
  assert.ok(!shortcuts.bindingMatchesEvent(binding, keyEvent('ArrowUp', { ctrlKey: true })));
  assert.ok(!shortcuts.bindingMatchesEvent(binding, keyEvent('ArrowDown', { ctrlKey: true, shiftKey: true })));
  assert.ok(!shortcuts.bindingMatchesEvent(binding, keyEvent('ArrowUp', { ctrlKey: true, shiftKey: true, altKey: true })));
});

//Regression: bindingsEqual answers true for two nulls, and a bare modifier press is not a binding
//at all - so an unbound shortcut would have fired on every press of Shift by itself.
test('an unbound shortcut matches nothing, not even a bare modifier press', function(){
  assert.strictEqual(shortcuts.bindingMatchesEvent(null, keyEvent('Shift', { shiftKey: true })), false);
  assert.strictEqual(shortcuts.bindingMatchesEvent(null, keyEvent('b', { ctrlKey: true })), false);
});

test('bindings are equal regardless of the code they were captured from', function(){
  var typed = shortcuts.makeBinding('T', { mod: true, code: 'KeyT' });
  var declared = shortcuts.makeBinding('T', { mod: true });

  assert.ok(shortcuts.bindingsEqual(typed, declared));
  assert.ok(shortcuts.bindingsEqual(null, null));
  assert.ok(!shortcuts.bindingsEqual(null, declared));
  assert.ok(!shortcuts.bindingsEqual(declared, null));
});

//---------------------------------------------------------------------------
// display
//---------------------------------------------------------------------------

test('formatBinding writes a binding the way the popup prints it', function(){
  var defaults = shortcuts.getDefaultBindings();

  assert.strictEqual(shortcuts.formatBinding(defaults.moveChapterUp, false), 'Ctrl + Shift + Up');
  assert.strictEqual(shortcuts.formatBinding(defaults.moveChapterUp, true), 'Cmd + Shift + Up');
  assert.strictEqual(shortcuts.formatBinding(defaults.typewriterMode, true), 'Cmd + Alt + T');
  assert.strictEqual(shortcuts.formatBinding(defaults.toggleChapterList, false), 'F1');
  assert.strictEqual(shortcuts.formatBinding(defaults.decreaseEditorWidth, false), 'Ctrl + ,');
  assert.strictEqual(shortcuts.formatBinding(shortcuts.makeBinding(' ', { mod: true }), false), 'Ctrl + Space');
});

test('formatBinding gives the exotic keys a readable name', function(){
  assert.strictEqual(shortcuts.formatBinding(shortcuts.makeBinding('AudioVolumeUp'), false), 'Volume Up');
  assert.strictEqual(shortcuts.formatBinding(shortcuts.makeBinding('ContextMenu'), false), 'Menu');
  assert.strictEqual(shortcuts.formatBinding(shortcuts.makeBinding('MediaTrackPrevious', { mod: true }), false),
    'Ctrl + Previous Track');
  //Anything without a display name of its own prints as stored, which for these is already readable.
  assert.strictEqual(shortcuts.formatBinding(shortcuts.makeBinding('F13'), false), 'F13');
  assert.strictEqual(shortcuts.formatBinding(shortcuts.makeBinding('Pause'), false), 'Pause');
});

test('an unbound shortcut prints as None', function(){
  assert.strictEqual(shortcuts.formatBinding(null, false), 'None');
});

//---------------------------------------------------------------------------
// resolving and persisting
//---------------------------------------------------------------------------

test('resolveShortcuts lays overrides over the defaults', function(){
  var resolved = shortcuts.resolveShortcuts({ formatBold: { key: 'W', mod: true } });

  assert.deepStrictEqual(resolved.formatBold, { key: 'W', mod: true, alt: false, shift: false });
  assert.deepStrictEqual(resolved.formatItalics, shortcuts.getDefaultBindings().formatItalics);
});

test('an override of null leaves that shortcut unbound rather than falling back', function(){
  var resolved = shortcuts.resolveShortcuts({ formatBold: null });

  assert.strictEqual(resolved.formatBold, null);
  assert.ok('formatBold' in resolved);
});

test('resolveShortcuts returns the defaults when there is nothing saved', function(){
  [null, undefined, {}, 'nonsense', [], 42].forEach(function(value){
    assert.deepStrictEqual(shortcuts.resolveShortcuts(value), shortcuts.getDefaultBindings(), String(value));
  });
});

//Only the difference is written, so a default changed in a later version reaches a writer who
//never touched that shortcut, and restoring defaults leaves nothing behind in the settings file.
test('diffFromDefaults keeps only what a writer actually changed', function(){
  var bindings = shortcuts.getDefaultBindings();
  bindings.formatBold = shortcuts.makeBinding('W', { mod: true });
  bindings.formatItalics = null;

  assert.deepStrictEqual(shortcuts.diffFromDefaults(bindings), {
    formatBold: { key: 'W', mod: true, alt: false, shift: false },
    formatItalics: null
  });

  assert.deepStrictEqual(shortcuts.diffFromDefaults(shortcuts.getDefaultBindings()), {});
});

test('diffFromDefaults ignores anything that is not a known action', function(){
  var bindings = Object.assign(shortcuts.getDefaultBindings(), { madeUp: { key: 'W', mod: true } });

  assert.deepStrictEqual(shortcuts.diffFromDefaults(bindings), {});
  assert.deepStrictEqual(shortcuts.diffFromDefaults(null), {});
});

//user-settings.json is a file on disk anything could have written to - the same reason the settings
//schema exists. A binding that could never fire has to fall back to the default rather than leaving
//the action quietly dead.
test('sanitizeOverrides drops unknown actions and unusable bindings', function(){
  var sanitized = shortcuts.sanitizeOverrides({
    formatBold: { key: 'W', mod: true },
    madeUpAction: { key: 'W', mod: true },
    formatItalics: { key: 'Unidentified', mod: true },
    formatUnderline: 'Ctrl+U',
    formatTitle: { key: 'F25' },
    formatList: null
  });

  assert.deepStrictEqual(sanitized, {
    formatBold: { key: 'W', mod: true, alt: false, shift: false },
    formatList: null
  });
});

test('sanitizeOverrides copes with a settings file that is not an object', function(){
  [null, undefined, 'nope', 42, []].forEach(function(value){
    assert.deepStrictEqual(shortcuts.sanitizeOverrides(value), {}, String(value));
  });
});

//The popup will not let a writer bind these, but user-settings.json is a file on disk that can be
//hand-edited - and a shortcut sitting on Escape takes away the key every dialog is closed with,
//including the one a writer would go to in order to undo it. Dropped on the way in, so the action
//falls back to its default rather than stranding them.
test('a stored override on a key the app cannot give up falls back to the default', function(){
  var overrides = {
    toggleNotes: { key: 'Escape', mod: true },
    toggleEditor: { key: 'Tab', mod: true },
    focusNotes: { key: 'M', mod: true },
    formatBold: { key: 'Q' }
  };

  assert.deepStrictEqual(shortcuts.sanitizeOverrides(overrides), {});

  var resolved = shortcuts.resolveShortcuts(overrides);
  assert.deepStrictEqual(resolved.toggleNotes, shortcuts.getDefaultBindings().toggleNotes);
  assert.deepStrictEqual(resolved.formatBold, shortcuts.getDefaultBindings().formatBold);
});

test('sanitizeBinding coerces the flags and refuses a code that is not one', function(){
  assert.deepStrictEqual(shortcuts.sanitizeBinding({ key: 'w', mod: 1, alt: 'yes', shift: 0 }),
    { key: 'W', mod: true, alt: true, shift: false });

  assert.ok(!('code' in shortcuts.sanitizeBinding({ key: 'W', mod: true, code: '../../etc/passwd' })));
  assert.strictEqual(shortcuts.sanitizeBinding({ key: 'W', mod: true, code: 'KeyW' }).code, 'KeyW');
  assert.strictEqual(shortcuts.sanitizeBinding(null), null);
  assert.strictEqual(shortcuts.sanitizeBinding([]), null);
});

//---------------------------------------------------------------------------
// validation
//---------------------------------------------------------------------------

test('an ordinary modified key is a valid shortcut', function(){
  var bindings = shortcuts.getDefaultBindings();

  assert.deepStrictEqual(shortcuts.validateBinding(shortcuts.makeBinding('W', { mod: true, shift: true }), 'formatBold', bindings),
    { valid: true });
  assert.deepStrictEqual(shortcuts.validateBinding(shortcuts.makeBinding('Q', { alt: true }), 'formatBold', bindings),
    { valid: true });
});

test('clearing a shortcut is always allowed', function(){
  assert.deepStrictEqual(shortcuts.validateBinding(null, 'formatBold', shortcuts.getDefaultBindings()), { valid: true });
});

//An unmodified letter would stop being typeable in the editor the moment it became a shortcut.
test('a key with no Ctrl or Alt is refused unless it types nothing', function(){
  var bindings = shortcuts.getDefaultBindings();

  var letter = shortcuts.validateBinding(shortcuts.makeBinding('Q'), 'formatBold', bindings);
  assert.strictEqual(letter.valid, false);
  assert.match(letter.message, /Ctrl/);

  var shifted = shortcuts.validateBinding(shortcuts.makeBinding('Q', { shift: true }), 'formatBold', bindings);
  assert.strictEqual(shifted.valid, false);

  assert.strictEqual(shortcuts.validateBinding(shortcuts.makeBinding('F5'), 'formatBold', bindings).valid, true);
  assert.strictEqual(shortcuts.validateBinding(shortcuts.makeBinding('F5', { shift: true }), 'formatBold', bindings).valid, true);
});

//The rule is "types nothing", not "is a function key" - which is what lets a writer whose F-row sits
//on its media layer bind the keys their board actually sends.
test('a key that types nothing may be bound on its own', function(){
  var bindings = shortcuts.getDefaultBindings();

  ['F13', 'F24', 'AudioVolumeUp', 'MediaPlayPause', 'ContextMenu', 'ScrollLock'].forEach(function(key){
    assert.strictEqual(shortcuts.canBindAlone(key), true, key + ' should stand alone');
    assert.strictEqual(shortcuts.validateBinding(shortcuts.makeBinding(key), 'formatBold', bindings).valid,
      true, key + ' should be bindable bare');
  });
});

//The awkward middle case: these type nothing either, but the editor moves its own cursor by them, so
//a bare shortcut on one would take that away.
test('a navigation key still needs a modifier, though it types nothing', function(){
  var bindings = shortcuts.getDefaultBindings();

  ['ArrowUp', 'PageDown', 'Home', 'End', 'Insert', 'Space'].forEach(function(key){
    assert.strictEqual(shortcuts.canBindAlone(key), false, key + ' should not stand alone');

    var result = shortcuts.validateBinding(shortcuts.makeBinding(key), 'formatBold', bindings);
    assert.strictEqual(result.valid, false, key + ' should be refused bare');
  });
});

test('the keys the app itself needs cannot be bound', function(){
  var bindings = shortcuts.getDefaultBindings();

  ['Escape', 'Tab', 'Enter', 'Backspace', 'Delete'].forEach(function(key){
    var result = shortcuts.validateBinding(shortcuts.makeBinding(key, { mod: true }), 'formatBold', bindings);
    assert.strictEqual(result.valid, false, key + ' should be refused');
    assert.ok(result.message.length > 0, key + ' should say why');
  });
});

test('the menu bar shortcut cannot be bound over', function(){
  var result = shortcuts.validateBinding(shortcuts.makeBinding('M', { mod: true }), 'formatBold', shortcuts.getDefaultBindings());

  assert.strictEqual(result.valid, false);
  assert.match(result.message, /menu bar/);
});

//A menu accelerator is handled natively before the page sees the key, so a shortcut moved onto one
//would look bound and never fire.
test('a menu accelerator is refused, and says which menu item holds it', function(){
  var bindings = shortcuts.getDefaultBindings();

  var save = shortcuts.validateBinding(shortcuts.makeBinding('S', { mod: true }), 'formatBold', bindings);
  assert.strictEqual(save.valid, false);
  assert.match(save.message, /Save/);

  var email = shortcuts.validateBinding(shortcuts.makeBinding('E', { mod: true, alt: true }), 'formatBold', bindings);
  assert.strictEqual(email.valid, false);
  assert.match(email.message, /Send via Email/);

  var fullscreen = shortcuts.validateBinding(shortcuts.makeBinding('F11'), 'toggleNotes', bindings);
  assert.strictEqual(fullscreen.valid, false);
  assert.match(fullscreen.message, /Full Screen/);
});

//Regression: the Backup menu item held Ctrl+Shift+B, the same combination the popup documents for
//Bullets/Numbered List - and a menu accelerator is handled before the page sees the key, so the
//editor shortcut could not fire. Backup gave the key up rather than the editor.
test('the bullets shortcut is not shadowed by a menu accelerator', function(){
  var bullets = shortcuts.makeBinding('B', { mod: true, shift: true });

  assert.strictEqual(shortcuts.findMenuAccelerator(bullets), null);
  assert.deepStrictEqual(shortcuts.getDefaultBindings().formatList, {
    key: 'B', mod: true, alt: false, shift: true
  });
});

test('a binding another shortcut already holds is refused, and names it', function(){
  var bindings = shortcuts.getDefaultBindings();

  var result = shortcuts.validateBinding(shortcuts.makeBinding('K', { mod: true }), 'formatBold', bindings);

  assert.strictEqual(result.valid, false);
  assert.match(result.message, /Strikethrough/);
});

test('reassigning a shortcut to the binding it already has is not a conflict with itself', function(){
  var bindings = shortcuts.getDefaultBindings();

  assert.deepStrictEqual(shortcuts.validateBinding(bindings.formatBold, 'formatBold', bindings), { valid: true });
});

//Restore Defaults must never be a thing the validator can veto, whatever the rules above would
//make of a particular default.
test('a shortcut can always be put back on its own default', function(){
  var bindings = shortcuts.getDefaultBindings();

  shortcuts.getShortcutDefs().forEach(function(def){
    assert.strictEqual(shortcuts.validateBinding(def.defaultBinding, def.id, bindings).valid, true,
      def.id + ' should accept its own default');
  });
});

test('an unusable binding, or an unknown action, is refused rather than thrown at', function(){
  var bindings = shortcuts.getDefaultBindings();

  assert.strictEqual(shortcuts.validateBinding({ key: 'Unidentified' }, 'formatBold', bindings).valid, false);
  assert.strictEqual(shortcuts.validateBinding(shortcuts.makeBinding('W', { mod: true }), 'madeUpAction', bindings).valid, false);
});

//---------------------------------------------------------------------------
// drift guard
//---------------------------------------------------------------------------

//MENU_ACCELERATORS is a copy of what src/index.js hands Electron, because the renderer has no way
//to ask the main process for the menu. A copy drifts; this reads the real list and fails when it
//does. One-directional on purpose: the model also lists accelerators Electron supplies for a menu
//ROLE (Toggle Full Screen's F11), which never appear as an `accelerator:` line to be found here.
test('every accelerator in the menu is one the model knows about', function(){
  var indexSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
  //Anchored to the start of the line so that prose mentioning the word - the File menu's note on
  //why Backup no longer has one - is not read as a menu entry.
  var acceleratorLines = indexSource.match(/^\s*accelerator:[^\n]+/gm) || [];

  assert.ok(acceleratorLines.length > 20, 'expected to find the menu accelerators in index.js');

  acceleratorLines.forEach(function(line){
    //Every quoted string on such a line is an accelerator - the label is always its own line, and
    //the Help item's platform ternary puts two of them here. Anything that will not parse fails
    //rather than being skipped: an accelerator this cannot read is one it cannot check either.
    var quotedStrings = line.match(/'([^']+)'/g) || [];
    assert.ok(quotedStrings.length > 0, 'could not read the accelerator out of: ' + line);

    quotedStrings.forEach(function(quoted){
      //index.js is JavaScript source, so a lone backslash key is written '\\' in it.
      var accelerator = quoted.slice(1, -1).replace(/\\\\/g, '\\');
      var binding = bindingFromAccelerator(accelerator);

      assert.ok(binding != null, 'could not parse the accelerator ' + accelerator + ' from src/index.js');
      assert.ok(shortcuts.findMenuAccelerator(binding) != null,
        'src/index.js binds ' + shortcuts.formatBinding(binding, false) +
        ' but shortcuts.js does not list it - add it to MENU_ACCELERATORS');
    });
  });
});

//Electron accelerator strings ('CmdOrCtrl+Shift+B') into this model's bindings. Returns null for
//anything that does not parse cleanly as one, including a key the model has no name for.
function bindingFromAccelerator(accelerator){
  var parts = accelerator.split('+');
  var flags = { mod: false, alt: false, shift: false };
  var key = null;

  var recognized = parts.every(function(part){
    var lowered = part.toLowerCase();

    if(lowered === 'cmdorctrl' || lowered === 'commandorcontrol' || lowered === 'ctrl' || lowered === 'control'){
      flags.mod = true;
      return true;
    }
    if(lowered === 'alt' || lowered === 'option'){
      flags.alt = true;
      return true;
    }
    if(lowered === 'shift'){
      flags.shift = true;
      return true;
    }

    //An accelerator's own key comes last, and there is exactly one of them.
    if(key != null)
      return false;

    key = shortcuts.normalizeKeyName(part);
    return key != null;
  });

  //A '+' as the accelerator's own key would split into an empty part; nothing in the menu uses
  //one, and a string that does not parse cleanly is not treated as an accelerator at all.
  if(!recognized || key == null)
    return null;

  return shortcuts.makeBinding(key, flags);
}
