//Every keyboard shortcut a writer is allowed to rebind, and the rules for what a rebound one may
//be. This is the single source of truth the rest of the feature reads from: the Shortcuts popup
//renders its table from SHORTCUT_DEFS, keybindings.js dispatches by matching against the resolved
//bindings, and quill-utils.js builds the editor's formatting bindings from the same map. Before
//this existed the three of them each carried their own copy of the list, which is why the popup
//was able to document a shortcut the app did not actually implement.
//
//Deliberately NOT covered here: the "Tool/Menu Navigation" shortcuts (Escape, Tab, Alt, Ctrl+M)
//and the menu accelerators built in src/index.js. Those are structural - Escape has to keep
//closing dialogs for a rebind dialog to be escapable at all - and the menu ones live in the main
//process, out of this renderer's reach.
//
//A BINDING is { key, mod, alt, shift } plus an optional `code` and `keyCode`:
//
//  key   - a normalized key name: a single uppercase PRINTABLE character ('T', '1', ','), or one
//          of the named keys in KNOWN_NAMED_KEYS ('ArrowUp', 'F3', 'AudioVolumeUp'). This is what
//          dispatch matches on, against a KeyboardEvent's own `key`. Null on a binding that has no
//          name to be identified by - see below.
//  mod   - Ctrl on Windows/Linux, Cmd on Mac. One flag rather than two, because every shortcut
//          this app has ever shipped is a CmdOrCtrl one, and it keeps a settings file written on
//          one machine meaningful on another.
//  alt   - the Alt/Option key.
//  shift - the Shift key.
//  code  - the physical KeyboardEvent.code the binding was captured from ('KeyT', 'Digit1'), when
//          it is known. Optional. For a NAMED binding nothing dispatches on it and equality ignores
//          it; it exists because Quill's keyboard module matches on keyCode rather than on key, and
//          codeForKey() can only guess.
//  keyCode - the legacy KeyboardEvent.keyCode the binding was captured from, when it was a real one.
//          Optional, ignored by equality, and there for Quill alone - which matches on nothing else
//          and has no table that could ever cover an unusual keyboard.
//
//A binding is identified by the first of these its keyboard actually gave it, which is a cascade
//rather than a choice - see sameKey:
//
//  its key name  - almost everything.
//  its code      - a keyboard is free to report a key of U+0000, no name whatsoever, while still
//                  reporting a perfectly good physical code. Those carry `key: null`.
//  its keyCode   - and some report no code either. Three keys on the top row this was written for
//                  arrive with no name, no code, and keyCodes of 183, 218 and 232 - which is little
//                  to go on, but it is three DIFFERENT things to go on, so the keys can be told
//                  apart and there is no honest reason to refuse them. Those carry `key: null` and
//                  `code: null`.
//
//Only a key that gives none of the three is refused, that being a key nothing could tell from any
//other. Equality still compares two named bindings on their names, as it always has.
//
//A binding of `null` means the action is deliberately unbound - distinct from an action with no
//override at all, which falls back to its default.

//Function keys. F13 and up are on no ordinary keyboard, but a programmable one (QMK and the like)
//is free to emit them, and they are the natural home for a writerdeck's extra keys: they type
//nothing, so a writer gives up nothing by spending one on a shortcut.
const FUNCTION_KEYS = Array.from({ length: 24 }, function(unused, index){
  return 'F' + (index + 1);
});

//The media, browser and launch keys a keyboard sends when its F-row is on its default layer instead
//of acting as function keys - the two layers a compact board's Fn (often the Menu key) toggles
//between. Which of these actually reach the page is the OS's business: a desktop environment may
//keep the volume keys for itself, and a board's firmware may keep its own Fn key. The ones that do
//arrive are bindable, and like the function keys they type nothing.
const MEDIA_KEYS = [
  'AudioVolumeUp', 'AudioVolumeDown', 'AudioVolumeMute',
  'MediaPlayPause', 'MediaStop', 'MediaTrackNext', 'MediaTrackPrevious',
  'BrowserBack', 'BrowserForward', 'BrowserRefresh', 'BrowserHome',
  'BrowserSearch', 'BrowserFavorites',
  'LaunchMail', 'LaunchApplication1', 'LaunchApplication2',
  //The screen keys, which a laptop-style or Chromebook-style top row carries alongside the rest.
  'BrightnessUp', 'BrightnessDown', 'ZoomToggle'
];

//Every named key that types nothing AND that the app has no other use for - which is exactly the
//set that may be a shortcut on its own, with no Ctrl or Alt held (see canBindAlone). ContextMenu is
//the Menu key; nothing in this app opens a context menu from it, so it is as free as the rest.
const STANDALONE_NAMED_KEYS = FUNCTION_KEYS.concat(MEDIA_KEYS,
  ['ContextMenu', 'Pause', 'ScrollLock']);

//The named keys the app is navigated and edited by. These type nothing either, but a shortcut on a
//bare one would take the editor's own cursor movement away - so unlike the keys above, they are
//only bindable with a modifier held.
const NAVIGATION_NAMED_KEYS = [
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'PageUp', 'PageDown', 'Home', 'End', 'Insert',
  'Space', 'Enter', 'Tab', 'Escape', 'Backspace', 'Delete'
];

//Named keys that may appear in a binding. Anything else with a name longer than one character
//(dead keys, IME keys, 'Unidentified') is rejected rather than stored, so a shortcut can never be
//saved in a shape that could not fire again.
const KNOWN_NAMED_KEYS = NAVIGATION_NAMED_KEYS.concat(STANDALONE_NAMED_KEYS);

//The same list keyed by its own lowercased names, because normalizeKeyName is on the keystroke path:
//it runs for every shortcut the dispatcher considers, on every keydown, and a walk of the list was
//costing a string allocation per entry walked. Built once, so the list above can grow without the
//lookup noticing. Null-prototype, so a key name can never collide with something off Object.
const KNOWN_NAMED_KEYS_BY_LOWERCASE = KNOWN_NAMED_KEYS.reduce(function(map, name){
  map[name.toLowerCase()] = name;
  return map;
}, Object.create(null));

//Text with a glyph to print for every character of it - letters, numbers, punctuation, symbols and
//spaces, and nothing from the control, private-use or unassigned ranges.
//
//A single character is only a key name if it passes this. Chromium hands over a character for a key
//it has no name of its own for, and an unusual keyboard - a programmable board's media layer on a
//Pi, say - can land on a control or private-use codepoint with no glyph in any font, which the popup
//would print as an empty rectangle. Refused, so that the capture UI can say what actually arrived
//instead (see describeKeyEvent), which is the one thing an empty rectangle cannot tell a writer.
const PRINTABLE_TEXT = /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}]+$/u;

//A physical KeyboardEvent.code worth storing. Kept to plain alphanumerics because a code is handed
//straight to Quill and compared against what arrives on a keypress, so an arbitrary string out of a
//hand-edited settings file has no business getting that far. Long enough for the ones a Chromebook
//top row sends: 'KeyboardBacklightToggle' is 23 characters.
const USABLE_CODE = /^[A-Za-z0-9]{1,32}$/;

//How a key is written in the popup's table, where it differs from the name stored. Everything not
//listed prints as-is: 'T', 'F3', ','.
const KEY_DISPLAY_NAMES = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  ContextMenu: 'Menu',
  ScrollLock: 'Scroll Lock',
  AudioVolumeUp: 'Volume Up',
  AudioVolumeDown: 'Volume Down',
  AudioVolumeMute: 'Mute',
  MediaPlayPause: 'Play/Pause',
  MediaStop: 'Stop',
  MediaTrackNext: 'Next Track',
  MediaTrackPrevious: 'Previous Track',
  BrowserBack: 'Browser Back',
  BrowserForward: 'Browser Forward',
  BrowserRefresh: 'Browser Refresh',
  BrowserHome: 'Browser Home',
  BrowserSearch: 'Browser Search',
  BrowserFavorites: 'Browser Favorites',
  LaunchMail: 'Mail',
  LaunchApplication1: 'Launch App 1',
  LaunchApplication2: 'Launch App 2'
};

//The named keys whose physical `code` is not simply their key name. Only these two: the UI Events
//spec spells the key 'LaunchApplication1' and the code 'LaunchApp1'.
const NAMED_KEY_CODES = {
  LaunchApplication1: 'LaunchApp1',
  LaunchApplication2: 'LaunchApp2'
};

//Punctuation whose physical code is not derivable from the character itself. Only the ones a
//default uses, plus the handful next to them a writer might reach for.
const PUNCTUATION_CODES = {
  ',': 'Comma',
  '.': 'Period',
  '-': 'Minus',
  '=': 'Equal',
  '/': 'Slash',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '`': 'Backquote',
  'Space': 'Space'
};

//Keys that can never be part of a shortcut, whatever is held with them, and the reason to show a
//writer who tries. The first three would break the app's own keyboard-only navigation; the last
//two are how the capture UI clears a shortcut, so they can never also assign one.
const RESERVED_KEYS = {
  Escape: 'Escape closes dialogs and popups.',
  Tab: 'Tab moves between inputs.',
  Enter: 'Enter activates the focused button.',
  Backspace: 'Backspace clears a shortcut.',
  Delete: 'Delete clears a shortcut.'
};

//A keydown fired by pressing a modifier on its own carries that modifier's name as its key. Those
//are never a shortcut by themselves - the capture UI waits for a real key instead of assigning
//"Shift".
const MODIFIER_KEY_NAMES = ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS'];

const SECTIONS = ['Navigation', 'Alteration', 'Formatting', 'Display'];

function makeBinding(key, flags){
  return buildBinding(normalizeKeyName(key), flags);
}

//The half of makeBinding after the normalizing, for the one caller that has already done it.
//bindingFromEvent has to normalize in order to know whether it has a named binding at all, and
//handing the result back to makeBinding put every keydown through the lookup a second time.
function buildBinding(key, flags){
  flags = flags || {};

  var binding = {
    key: key,
    mod: Boolean(flags.mod),
    alt: Boolean(flags.alt),
    shift: Boolean(flags.shift)
  };

  if(typeof flags.code === 'string' && flags.code !== '')
    binding.code = flags.code;

  if(isRealKeyCode(flags.keyCode))
    binding.keyCode = flags.keyCode;

  return binding;
}

//A binding for a key with no name to it, identified by its physical code instead. Returns null when
//there is no code worth storing either, which is a keypress this app can do nothing with at all.
//
//These are always safe to bind on their own: a key Chromium could not name is a key that types
//nothing, so there is no character to be taken out of the editor by binding it.
function makeCodeBinding(code, flags){
  flags = flags || {};

  if(!usableCode(code))
    return null;

  var binding = {
    key: null,
    code: code,
    mod: Boolean(flags.mod),
    alt: Boolean(flags.alt),
    shift: Boolean(flags.shift)
  };

  if(isRealKeyCode(flags.keyCode))
    binding.keyCode = flags.keyCode;

  return binding;
}

//The last resort: a binding for a key that reported neither a name nor a code. There is nothing to
//call it but its number, and nothing to match it on either - but a keyCode of its own is enough to
//tell it from the key beside it, which is all binding one requires.
function makeKeyCodeBinding(keyCode, flags){
  flags = flags || {};

  if(!isRealKeyCode(keyCode))
    return null;

  return {
    key: null,
    code: null,
    keyCode: keyCode,
    mod: Boolean(flags.mod),
    alt: Boolean(flags.alt),
    shift: Boolean(flags.shift)
  };
}

function usableCode(code){
  //'Unidentified' is what Chromium reports for a code it has no name for. It is a placeholder rather
  //than an identity - two unrelated keys can both arrive under it - so binding to it would give a
  //writer a shortcut that fired on some other key too.
  return typeof code === 'string' && code !== 'Unidentified' && USABLE_CODE.test(code);
}

//A keyCode of 0 is the absence of one rather than a key, and every browser reports it for a key it
//has no legacy code for.
function isRealKeyCode(keyCode){
  return typeof keyCode === 'number' && Number.isInteger(keyCode) && keyCode > 0 && keyCode <= 255;
}

//The accelerators src/index.js hands to Electron's Menu. They are handled by the native menu
//before the page ever sees the keydown, so a shortcut rebound onto one of them would simply never
//fire - hence checking them here, in the renderer, with no way to ask the main process. Keep this
//in sync with src/index.js; test/shortcuts.test.js reads that file's own accelerators and fails if
//the two drift apart.
//
//Ctrl+H (Cmd+Shift+H on Mac) is the Shortcuts popup itself, and is listed under both spellings so
//neither platform's writer can bind over it.
const MENU_ACCELERATORS = [
  { label: 'New Project', key: 'N', mod: true, shift: true },
  { label: 'Open Project', key: 'O', mod: true, shift: true },
  { label: 'Save', key: 'S', mod: true },
  { label: 'Save As', key: 'S', mod: true, shift: true },
  //Backup has no accelerator: it used to hold Ctrl+Shift+B, which is the editor's own
  //Bullets/Numbered List shortcut, and the menu was winning. See the File menu in src/index.js.
  { label: 'Import', key: 'I', mod: true, shift: true },
  { label: 'Export', key: 'E', mod: true, shift: true },
  { label: 'Compile', key: 'C', mod: true, shift: true },
  { label: 'Send via Email', key: 'E', mod: true, alt: true },
  { label: 'Properties', key: 'P', mod: true },
  { label: 'File Manager', key: 'F', mod: true, shift: true },
  { label: 'Exit', key: 'X', mod: true, shift: true },
  { label: 'Undo', key: 'Z', mod: true },
  { label: 'Redo', key: 'Z', mod: true, shift: true },
  { label: 'Cut', key: 'X', mod: true },
  { label: 'Copy', key: 'C', mod: true },
  { label: 'Paste', key: 'V', mod: true },
  { label: 'Select All', key: 'A', mod: true },
  { label: 'Add New Chapter', key: 'N', mod: true },
  { label: 'Delete Chapter', key: 'D', mod: true, shift: true },
  { label: 'Restore Deleted Chapter', key: 'R', mod: true, shift: true },
  { label: 'Split Chapter', key: '\\', mod: true },
  { label: 'Word Count', key: '8', mod: true },
  { label: 'Find/Replace', key: 'F', mod: true },
  { label: 'Spell Check', key: '7', mod: true },
  { label: 'Outliner', key: 'O', mod: true },
  { label: 'Wi-Fi Manager', key: 'W', mod: true },
  { label: 'Shortcuts', key: 'H', mod: true },
  { label: 'Shortcuts', key: 'H', mod: true, shift: true },
  //Not written as an accelerator in index.js: the View menu's Toggle Full Screen is a role, and
  //Electron gives a role its platform's standard accelerator - F11 on Windows and Linux. A bare
  //function key is exactly what a writer reaches for when rebinding the display toggles, so it is
  //listed here even though the drift test that reads index.js cannot see it. The Mac-only roles
  //(Hide, Quit) are left off: their accelerators are Cmd+H, already listed above, and Cmd+Q.
  { label: 'Toggle Full Screen', key: 'F11' }
].map(function(accelerator){
  return {
    label: accelerator.label,
    binding: makeBinding(accelerator.key, accelerator)
  };
});

//Ctrl/Cmd+M opens the application menu (see keybindings.js). It is Tool/Menu Navigation rather
//than a listed shortcut, so it is not customizable and nothing may be bound over it.
const MENU_KEY_BINDING = makeBinding('M', { mod: true });

//Where an action's handler lives, which decides who binds it:
//
//  global - keybindings.js's document-level listener; works from anywhere in the window.
//  pane   - keybindings.js's per-pane listener, attached to the editor, chapter list and notes;
//           acts on whichever of the three has focus.
//  quill  - Quill's own keyboard module, added to both editors by quill-utils.js.
const SHORTCUT_DEFS = [
  { id: 'previousChapter', label: 'View Previous Chapter', section: 'Navigation', target: 'pane', defaultBinding: makeBinding('ArrowUp', { mod: true }) },
  { id: 'nextChapter', label: 'View Next Chapter', section: 'Navigation', target: 'pane', defaultBinding: makeBinding('ArrowDown', { mod: true }) },
  { id: 'focusEditor', label: 'Shift Focus To Editor', section: 'Navigation', target: 'global', defaultBinding: makeBinding('ArrowLeft', { mod: true }) },
  { id: 'focusNotes', label: 'Shift Focus To Notes', section: 'Navigation', target: 'global', defaultBinding: makeBinding('ArrowRight', { mod: true }) },

  { id: 'moveChapterUp', label: 'Move Chapter Up', section: 'Alteration', target: 'pane', defaultBinding: makeBinding('ArrowUp', { mod: true, shift: true }) },
  { id: 'moveChapterDown', label: 'Move Chapter Down', section: 'Alteration', target: 'pane', defaultBinding: makeBinding('ArrowDown', { mod: true, shift: true }) },
  { id: 'changeChapterLabel', label: 'Change Chapter Label', section: 'Alteration', target: 'pane', defaultBinding: makeBinding('ArrowLeft', { mod: true, shift: true }) },

  { id: 'formatTitle', label: 'Title (Heading 1, Centered)', section: 'Formatting', target: 'quill', defaultBinding: makeBinding('T', { mod: true }) },
  { id: 'formatHeading1', label: 'Heading 1', section: 'Formatting', target: 'quill', defaultBinding: makeBinding('1', { mod: true }) },
  { id: 'formatHeading2', label: 'Heading 2', section: 'Formatting', target: 'quill', defaultBinding: makeBinding('2', { mod: true }) },
  { id: 'formatHeading3', label: 'Heading 3', section: 'Formatting', target: 'quill', defaultBinding: makeBinding('3', { mod: true }) },
  { id: 'formatHeading4', label: 'Heading 4', section: 'Formatting', target: 'quill', defaultBinding: makeBinding('4', { mod: true }) },
  { id: 'formatClearHeading', label: 'Clear Heading', section: 'Formatting', target: 'quill', defaultBinding: makeBinding('0', { mod: true }) },
  { id: 'formatList', label: 'Bullets/Numbered List', section: 'Formatting', target: 'quill', defaultBinding: makeBinding('B', { mod: true, shift: true }) },
  { id: 'formatBlockquote', label: 'Blockquote', section: 'Formatting', target: 'quill', defaultBinding: makeBinding('Q', { mod: true, shift: true }) },
  //Not Ctrl+Shift+F: that is already File Manager (see MENU_ACCELERATORS above). Ctrl+Alt+T
  //(Typewriter Mode, below) is the precedent for the Ctrl+Alt row.
  { id: 'insertFootnote', label: 'Insert Footnote', section: 'Formatting', target: 'quill', defaultBinding: makeBinding('F', { mod: true, alt: true }) },
  { id: 'formatAlignLeft', label: 'Left Align', section: 'Formatting', target: 'quill', defaultBinding: makeBinding('L', { mod: true }) },
  { id: 'formatAlignRight', label: 'Right Align', section: 'Formatting', target: 'quill', defaultBinding: makeBinding('R', { mod: true }) },
  { id: 'formatAlignCenter', label: 'Center Align', section: 'Formatting', target: 'quill', defaultBinding: makeBinding('E', { mod: true }) },
  { id: 'formatAlignJustify', label: 'Justify Align', section: 'Formatting', target: 'quill', defaultBinding: makeBinding('J', { mod: true }) },
  { id: 'formatStrikethrough', label: 'Strikethrough', section: 'Formatting', target: 'quill', defaultBinding: makeBinding('K', { mod: true }) },
  { id: 'formatItalics', label: 'Italics', section: 'Formatting', target: 'quill', defaultBinding: makeBinding('I', { mod: true }) },
  { id: 'formatBold', label: 'Bold', section: 'Formatting', target: 'quill', defaultBinding: makeBinding('B', { mod: true }) },
  { id: 'formatUnderline', label: 'Underline', section: 'Formatting', target: 'quill', defaultBinding: makeBinding('U', { mod: true }) },

  //The help popup printed these four as two rows ("Adjust Editor Width: Ctrl + < or >"), which is
  //not a thing a writer can rebind half of - so each direction is its own action here. The keys
  //are also written as what is actually pressed: the comma and period keys, not the < and > their
  //keycaps show above them, and '=' rather than '+', neither of which ever needed Shift.
  { id: 'decreaseEditorWidth', label: 'Decrease Editor Width', section: 'Display', target: 'pane', defaultBinding: makeBinding(',', { mod: true }) },
  { id: 'increaseEditorWidth', label: 'Increase Editor Width', section: 'Display', target: 'pane', defaultBinding: makeBinding('.', { mod: true }) },
  { id: 'decreaseFontSize', label: 'Decrease Font Size', section: 'Display', target: 'global', defaultBinding: makeBinding('-', { mod: true }) },
  { id: 'increaseFontSize', label: 'Increase Font Size', section: 'Display', target: 'global', defaultBinding: makeBinding('=', { mod: true }) },
  { id: 'toggleChapterList', label: 'Toggle Chapter List Display', section: 'Display', target: 'global', defaultBinding: makeBinding('F1') },
  { id: 'toggleEditor', label: 'Toggle Editor Display', section: 'Display', target: 'global', defaultBinding: makeBinding('F2') },
  { id: 'toggleNotes', label: 'Toggle Notes Display', section: 'Display', target: 'global', defaultBinding: makeBinding('F3') },
  //Ctrl+F3 was already a keybinding but had never been listed in the popup. Leaving it off the
  //list while F3 above became rebindable would have made it an invisible conflict - a writer who
  //moved "Toggle Notes Display" onto Ctrl+F3 would have had two handlers fire and no way to see
  //why.
  { id: 'toggleChapterNotes', label: 'Toggle Chapter Notes', section: 'Display', target: 'global', defaultBinding: makeBinding('F3', { mod: true }) },
  { id: 'typewriterMode', label: 'Typewriter Mode', section: 'Display', target: 'global', defaultBinding: makeBinding('T', { mod: true, alt: true }) }
];

//Returns the canonical name for a key, or null for anything that may not be stored: an empty or
//non-string value, or a named key this app does not recognize. Single characters are uppercased so
//that Ctrl+B and Ctrl+Shift+B - which a browser reports as 'b' and 'B' - are told apart by their
//Shift flag alone rather than by their letter's case.
function normalizeKeyName(key){
  if(typeof key !== 'string' || key === '')
    return null;

  if(key === ' ')
    return 'Space';

  if(key.length === 1){
    //Nearly every keypress a writer makes is ordinary printable ASCII, and a codepoint comparison is
    //several times cheaper than the Unicode property test - which is left to the keys that are
    //something else. Space is excluded from the range deliberately: it is answered above, as 'Space'
    //rather than as itself.
    var codePoint = key.charCodeAt(0);

    if(codePoint > 0x20 && codePoint < 0x7f)
      return key.toUpperCase();

    return PRINTABLE_TEXT.test(key) ? key.toUpperCase() : null;
  }

  return KNOWN_NAMED_KEYS_BY_LOWERCASE[key.toLowerCase()] || null;
}

//The physical key a binding's key name most likely came from, for callers that need a
//KeyboardEvent.code rather than a key name - Quill's keyboard module being the only one. A binding
//captured from a real keypress carries its own `code`, which is always preferred over this; this
//covers the defaults above (written as key names, not codes) and any saved override from a version
//that did not store one.
function codeForKey(key){
  var normalized = normalizeKeyName(key);
  if(normalized == null)
    return null;

  if(PUNCTUATION_CODES[normalized])
    return PUNCTUATION_CODES[normalized];

  if(/^[A-Z]$/.test(normalized))
    return 'Key' + normalized;

  if(/^[0-9]$/.test(normalized))
    return 'Digit' + normalized;

  return NAMED_KEY_CODES[normalized] || normalized;
}

//The binding a keydown represents, or null when the event is not one a shortcut could ever be: a
//modifier pressed on its own, or a key this app will not store. Ctrl and Cmd both set `mod`,
//matching how every shortcut in the app has always tested `e.ctrlKey || e.metaKey` - a Mac writer
//pressing Cmd and a Windows one pressing Ctrl produce the same binding, which is what lets one
//settings file mean the same thing on both.
function bindingFromEvent(e){
  if(e == null || isModifierKeyEvent(e))
    return null;

  var key = normalizeKeyName(e.key);

  //A key this app cannot name is not necessarily a key it cannot use. An unusual keyboard can report
  //no name at all - a NUL character, on the Chromebook-style top row this was written for - while
  //still reporting a good physical code, and that code is enough to bind by. Failing even that, the
  //keyCode is. Null still comes back when there is none of the three, which is a key nothing could
  //tell apart from any other.
  if(key == null){
    var flags = {
      mod: e.ctrlKey || e.metaKey,
      alt: e.altKey,
      shift: e.shiftKey,
      keyCode: e.keyCode
    };

    return makeCodeBinding(e.code, flags) || makeKeyCodeBinding(e.keyCode, flags);
  }

  return buildBinding(key, {
    mod: e.ctrlKey || e.metaKey,
    alt: e.altKey,
    shift: e.shiftKey,
    code: typeof e.code === 'string' ? e.code : null,
    keyCode: e.keyCode
  });
}

//Whether a keydown is a modifier being held rather than a key being pressed - a writer part-way
//through a combination. The capture UI needs this apart from bindingFromEvent's null, because the
//two nulls mean opposite things: one is worth waiting through in silence, the other is a key this
//app could not name and is worth saying something about.
function isModifierKeyEvent(e){
  return e != null && MODIFIER_KEY_NAMES.indexOf(e.key) !== -1;
}

//What a keypress actually arrived as, for the capture UI to show when the key is one this app cannot
//name. This is the whole answer to "why did my key come out as a blank rectangle": an unrenderable
//character is printed as its codepoint rather than as itself, and the physical `code` is named
//alongside it, that being often the only readable thing about a key from an unusual keyboard - and
//the thing worth quoting in a bug report about one.
function describeKeyEvent(e){
  if(e == null)
    return '';

  var parts = ['key ' + describeKeyValue(e.key)];

  if(typeof e.code === 'string' && e.code !== '')
    parts.push('code ' + describeKeyValue(e.code));

  //With neither a name nor a code the keyCode is the last thing that could tell this key from
  //another - and a real one is now bound rather than reported, so anything that reaches here has a
  //keyCode of 0. Printed anyway, since 0 is itself the answer to why the key was refused.
  if(normalizeKeyName(e.key) == null && !usableCode(e.code) && typeof e.keyCode === 'number')
    parts.push('keyCode ' + e.keyCode);

  return 'Your keyboard reported ' + parts.join(', ') + '.';
}

function describeKeyValue(value){
  if(typeof value !== 'string' || value === '')
    return '(none)';

  //The point of the readout is to be legible, so the one thing it must not do is reprint the
  //rectangle the writer came here about. A key name is printable and is quoted as it stands;
  //anything with a character that has no glyph is written out as codepoints instead.
  if(PRINTABLE_TEXT.test(value))
    return '"' + value + '"';

  return Array.from(value).map(function(char){
    return 'U+' + char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
  }).join(' ');
}

function bindingsEqual(a, b){
  if(a == null || b == null)
    return a == null && b == null;

  return sameKey(a, b) && Boolean(a.mod) === Boolean(b.mod) &&
    Boolean(a.alt) === Boolean(b.alt) && Boolean(a.shift) === Boolean(b.shift);
}

//Between two NAMED bindings, `code` is deliberately not compared: it is a hint for Quill, not part
//of what a binding means, and two writers on different keyboard layouts can reach the same key from
//different codes.
//
//A binding with no name falls back to what it does have, and so does anything being compared with
//it - against a named binding too, which is what stops a code- or keyCode-identified shortcut from
//silently sharing a physical key with a named one and leaving both to fire.
//
//The cascade has to be driven by what the two bindings have in COMMON rather than by what either one
//is, or a binding carrying a code would never be found equal to the same key arriving without one.
function sameKey(a, b){
  if(a.key != null && b.key != null)
    return a.key === b.key;

  var codeA = effectiveCode(a);
  var codeB = effectiveCode(b);

  if(codeA != null && codeB != null)
    return codeA === codeB;

  return isRealKeyCode(a.keyCode) && a.keyCode === b.keyCode;
}

function effectiveCode(binding){
  return binding.code || codeForKey(binding.key);
}

//An unbound action matches nothing. Worth stating outright rather than leaving to bindingsEqual:
//that answers true for two nulls, and bindingFromEvent() returns null for a modifier pressed on
//its own - so an unbound shortcut would otherwise fire on every bare press of Shift.
function bindingMatchesEvent(binding, e){
  if(binding == null)
    return false;

  return bindingsEqual(binding, bindingFromEvent(e));
}

//How a binding is written in the popup's table: 'Ctrl + Shift + Up'. The modifier order matches
//what the popup has always printed, and Alt stays 'Alt' on Mac too, as it did before.
function formatBinding(binding, isMac){
  if(binding == null)
    return 'None';

  var parts = [];

  if(binding.mod)
    parts.push(isMac ? 'Cmd' : 'Ctrl');
  if(binding.alt)
    parts.push('Alt');
  if(binding.shift)
    parts.push('Shift');

  parts.push(describeBoundKey(binding));

  return parts.join(' + ');
}

function describeBoundKey(binding){
  if(binding.key != null)
    return KEY_DISPLAY_NAMES[binding.key] || binding.key;

  if(binding.code != null)
    return describeCode(binding.code);

  //Nothing to call it by but its number. Printed plainly rather than dressed up, so that a writer
  //can match it against the readout the popup gave them when the key was first pressed.
  return 'Key ' + binding.keyCode;
}

//A code is a spec identifier rather than a name meant for a writer, so it is spaced out into words
//for the table: 'ShowAllWindows' reads as 'Show All Windows'. Nothing is translated beyond that -
//the point is that a writer can match what the popup shows against what their keyboard's own
//documentation calls the key.
function describeCode(code){
  return String(code).replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function getShortcutDefs(){
  return SHORTCUT_DEFS.map(function(def){
    return {
      id: def.id,
      label: def.label,
      section: def.section,
      target: def.target,
      defaultBinding: copyBinding(def.defaultBinding)
    };
  });
}

function getShortcutDef(id){
  return SHORTCUT_DEFS.find(function(def){
    return def.id === id;
  }) || null;
}

function getDefaultBindings(){
  var defaults = {};

  SHORTCUT_DEFS.forEach(function(def){
    defaults[def.id] = copyBinding(def.defaultBinding);
  });

  return defaults;
}

//The bindings actually in force: the defaults with the writer's saved overrides laid over them. An
//override of null is kept as null rather than falling back - that is an action the writer
//deliberately unbound, and dispatch skips it.
function resolveShortcuts(overrides){
  var resolved = getDefaultBindings();
  var sanitized = sanitizeOverrides(overrides);

  Object.keys(sanitized).forEach(function(id){
    resolved[id] = sanitized[id];
  });

  return resolved;
}

//What gets written to user-settings.json: only what differs from the defaults, so a later change
//to a default reaches writers who never touched that shortcut, and "Restore Defaults" is simply an
//empty object rather than a snapshot of whatever the defaults happened to be on the day it ran.
function diffFromDefaults(bindings){
  var overrides = {};

  if(bindings == null || typeof bindings !== 'object')
    return overrides;

  SHORTCUT_DEFS.forEach(function(def){
    if(!(def.id in bindings))
      return;

    var binding = bindings[def.id] === null ? null : sanitizeBinding(bindings[def.id]);

    if(!bindingsEqual(binding, def.defaultBinding))
      overrides[def.id] = copyBinding(binding);
  });

  return overrides;
}

//user-settings.json is a plain file on disk that anything could have written to, so nothing from
//it is trusted: an unknown action id is dropped, and a binding that is not a shape this app could
//dispatch is dropped with it, leaving that action on its default rather than silently unbound.
function sanitizeOverrides(raw){
  var overrides = {};

  if(raw == null || typeof raw !== 'object' || Array.isArray(raw))
    return overrides;

  Object.keys(raw).forEach(function(id){
    if(getShortcutDef(id) == null)
      return;

    if(raw[id] === null){
      overrides[id] = null;
      return;
    }

    var binding = sanitizeBinding(raw[id]);
    if(binding != null)
      overrides[id] = binding;
  });

  return overrides;
}

function sanitizeBinding(raw){
  if(raw == null || typeof raw !== 'object' || Array.isArray(raw))
    return null;

  var key = normalizeKeyName(raw.key);

  //With no name, the binding has to be one identified by its code, and makeCodeBinding answers
  //whether it is a usable one. Something with neither is not a binding at all.
  var binding = key == null
    ? (makeCodeBinding(raw.code, raw) || makeKeyCodeBinding(raw.keyCode, raw))
    : makeBinding(key, { mod: raw.mod, alt: raw.alt, shift: raw.shift, keyCode: raw.keyCode });

  if(binding == null || !isSafeToBind(binding))
    return null;

  //A named binding's code is only carried through when it looks like one - it is handed straight to
  //Quill, and an arbitrary string from a hand-edited file has no business getting that far. A
  //code-identified one has already been through the same check, in makeCodeBinding.
  if(binding.key != null && usableCode(raw.code))
    binding.code = raw.code;

  return binding;
}

function copyBinding(binding){
  return binding == null ? null : Object.assign({}, binding);
}

//The rules a binding must satisfy to be stored at all, as opposed to the ones validateBinding adds
//on top when a writer is choosing one. The split is between what would BREAK the app and what
//merely would not work:
//
//  here             - a shortcut on Escape, Tab or Enter takes away the keys the app is navigated
//                     and escaped by, and one on an unmodified letter takes that letter out of the
//                     editor. user-settings.json is a file on disk, so neither may be reachable by
//                     hand-editing it: both fall back to the default instead.
//  validateBinding  - conflicts, and the menu accelerators. A shortcut on Ctrl+S simply never
//                     fires, which is worth refusing while a writer is picking one and not worth
//                     dropping a stored setting over.
function isSafeToBind(binding){
  //Read off the code as well as the key, since a binding identified by its code has no key to read.
  if(RESERVED_KEYS[binding.key] || RESERVED_KEYS[binding.code])
    return false;

  //Ctrl/Cmd+M opens the menu bar, which on Mac is the only way in to it. Reached by a code-identified
  //binding too: sameKey compares those against a named binding's code, so a binding on 'KeyM' is
  //caught here the same as one on 'M'.
  if(bindingsEqual(binding, MENU_KEY_BINDING))
    return false;

  //A key with no name types nothing - that is what having no name means here - so it needs no
  //modifier to be safe, which is the whole point of supporting it.
  if(binding.key == null)
    return true;

  return binding.mod || binding.alt || canBindAlone(binding.key);
}

//Whether a key may be a shortcut on its own, with nothing held down. The rule is that the key types
//nothing: giving up a letter would make it untypeable in the editor, while giving up F5 or Volume Up
//costs a writer nothing at all. Shift does not qualify a typing key either - Shift+B is still a
//character. The navigation keys are the awkward middle case and are excluded: they type nothing, but
//the editor moves its own cursor by them (see NAVIGATION_NAMED_KEYS).
function canBindAlone(key){
  return STANDALONE_NAMED_KEYS.indexOf(key) !== -1;
}

//Whether `binding` may be assigned to `actionId`, given every binding currently in force. Returns
//{ valid, message } - the message being what the popup shows the writer, so it names the thing in
//the way rather than reciting a rule.
//
//`bindings` is the full resolved map (see resolveShortcuts), including the action being changed.
function validateBinding(binding, actionId, bindings){
  //Clearing a shortcut is always allowed: an action nobody uses is better off out of the way of
  //the ones a writer does.
  if(binding == null)
    return { valid: true };

  //sanitizeBinding refuses the unstorable outright (see isSafeToBind), so the work here is saying
  //WHICH rule a refused binding fell foul of - a writer pressing Escape expecting it to be
  //bindable is owed better than "that key cannot be used".
  var candidate = sanitizeBinding(binding);
  if(candidate == null){
    var key = normalizeKeyName(binding.key);

    //A binding with no name is identified by its code, so the reason it was refused has to be read
    //off that instead. Those two are exhaustive: isSafeToBind turns a code-identified binding down
    //for nothing else.
    if(key == null && usableCode(binding.code)){
      return {
        valid: false,
        message: RESERVED_KEYS[binding.code] || 'That shortcut opens the menu bar.'
      };
    }

    if(key == null)
      return { valid: false, message: 'That key cannot be used in a shortcut.' };

    if(RESERVED_KEYS[key])
      return { valid: false, message: RESERVED_KEYS[key] };

    if(bindingsEqual(makeBinding(key, binding), MENU_KEY_BINDING))
      return { valid: false, message: 'That shortcut opens the menu bar.' };

    //Without Ctrl/Cmd or Alt, an ordinary key is just typing - binding one would make that key
    //unusable in the editor. The keys that type nothing stand alone (see canBindAlone).
    return {
      valid: false,
      message: 'A shortcut needs Ctrl (Cmd on Mac) or Alt, unless it uses a function or media key.'
    };
  }

  var def = getShortcutDef(actionId);
  if(def == null)
    return { valid: false, message: 'Unknown shortcut.' };

  //An action may always be put back on its own default, whatever the checks below would make of
  //it. Restoring defaults must never be the thing this refuses - if a default ever does collide
  //with a menu accelerator, the fix belongs in the menu (as it did when Backup and
  //Bullets/Numbered List both held Ctrl+Shift+B), not in a writer being unable to undo a rebind.
  if(bindingsEqual(candidate, def.defaultBinding))
    return { valid: true };

  var menuItem = findMenuAccelerator(candidate);
  if(menuItem != null)
    return { valid: false, message: 'The ' + menuItem.label + ' menu item already uses that shortcut.' };

  var conflict = findConflict(candidate, actionId, bindings);
  if(conflict != null)
    return { valid: false, message: conflict.label + ' already uses that shortcut.' };

  return { valid: true };
}

//The action, other than `actionId` itself, already bound to `binding` - or null. Returns the
//definition rather than the id so a caller has the writer-facing label to hand.
function findConflict(binding, actionId, bindings){
  if(binding == null || bindings == null)
    return null;

  var conflictingId = Object.keys(bindings).find(function(id){
    return id !== actionId && bindingsEqual(bindings[id], binding);
  });

  return conflictingId ? getShortcutDef(conflictingId) : null;
}

function findMenuAccelerator(binding){
  return MENU_ACCELERATORS.find(function(accelerator){
    return bindingsEqual(accelerator.binding, binding);
  }) || null;
}

module.exports = {
  SECTIONS,
  MENU_ACCELERATORS,
  getShortcutDefs,
  getShortcutDef,
  getDefaultBindings,
  resolveShortcuts,
  diffFromDefaults,
  sanitizeOverrides,
  sanitizeBinding,
  normalizeKeyName,
  codeForKey,
  makeBinding,
  makeCodeBinding,
  makeKeyCodeBinding,
  bindingFromEvent,
  isModifierKeyEvent,
  describeKeyEvent,
  canBindAlone,
  bindingsEqual,
  bindingMatchesEvent,
  formatBinding,
  validateBinding,
  findConflict,
  findMenuAccelerator
};
