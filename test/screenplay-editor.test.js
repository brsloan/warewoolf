require('./quill-dom-setup');
const test = require('node:test');
const assert = require('node:assert');
const Quill = require('quill');

const { registerScreenplayFormats, SCREENPLAY_FORMATS } = require('../src/components/blots/screenplay');
const { loadScreenplayDelta, deltaToScreenplayHtml, markEstimatedPages } = require('../src/components/controllers/screenplay-editor');
const { parseFountain, elementsToDelta, deltaToElements } = require('../src/components/controllers/fountain');

//docs/screenplay-plan.md, Phase 3: the attributors, and the load path that bypasses setContents.

registerScreenplayFormats();

function makeQuill(){
  var container = document.createElement('div');
  document.body.appendChild(container);
  return new Quill(container, {
    modules: { history: { userOnly: true } },
    formats: ['bold', 'italic', 'underline', 'strike', 'header'].concat(SCREENPLAY_FORMATS)
  });
}

const SCRIPT = 'INT. HOUSE - DAY\n\nA room.\nStill the room.\n\nBOB ^\n(low)\nHello *there* & <you>.\n\n> THE END <\n';

test('a delta loaded through the HTML path reads back as the same delta', function(){
  var quill = makeQuill();
  var delta = elementsToDelta(parseFountain(SCRIPT).elements);

  loadScreenplayDelta(quill, delta);

  //Quill merges adjacent inserts with the same attributes - "A room." and the plain "\n" after it
  //become one op - so both sides are put through the same merge before they are compared.
  var Delta = Quill.import('delta');
  var canonical = function(d){ return new Delta().compose(new Delta(d.ops)).ops; };
  assert.deepStrictEqual(canonical(quill.getContents()), canonical(delta));
});

test('the load path marks nothing dirty and leaves nothing to undo', function(){
  var quill = makeQuill();
  var sources = [];
  quill.on('text-change', function(d, o, source){ sources.push(source); });

  loadScreenplayDelta(quill, elementsToDelta(parseFountain(SCRIPT).elements));

  assert.deepStrictEqual(sources.filter(function(s){ return s === 'user'; }), []);
  assert.strictEqual(quill.history.stack.undo.length, 0);
});

test('the flags come back as booleans, not the strings the DOM holds', function(){
  var quill = makeQuill();
  loadScreenplayDelta(quill, { ops: [
    { insert: 'BOB' }, { insert: '\n', attributes: { element: 'character', dual: true } },
    { insert: 'x' }, { insert: '\n', attributes: { tight: true } }
  ] });

  var ops = quill.getContents().ops;
  assert.deepStrictEqual(ops[1].attributes, { element: 'character', dual: true });
  assert.deepStrictEqual(ops[3].attributes, { tight: true });
  assert.strictEqual(quill.root.querySelector('p').getAttribute('data-sp-dual'), 'true');
});

test('changing a line\'s element is one formatLine, and the flags survive it', function(){
  var quill = makeQuill();
  loadScreenplayDelta(quill, { ops: [{ insert: 'x' }, { insert: '\n', attributes: { element: 'dialogue', tight: true } }] });

  quill.formatLine(0, 1, 'element', 'character', 'user');
  assert.deepStrictEqual(quill.getContents().ops[1].attributes, { element: 'character', tight: true });

  quill.formatLine(0, 1, 'element', false, 'user');
  assert.deepStrictEqual(quill.getContents().ops[1].attributes, { tight: true }, 'action is the absence of an element');
  assert.strictEqual(quill.root.querySelector('p').className, '');
});

test('Quill\'s own Backspace merge gives the joined line the previous line\'s type', function(){
  var quill = makeQuill();
  loadScreenplayDelta(quill, { ops: [
    { insert: 'BOB' }, { insert: '\n', attributes: { element: 'character' } },
    { insert: 'Hi.' }, { insert: '\n', attributes: { element: 'dialogue' } }
  ] });

  //The caret at the start of "Hi.": index 4, offset 0 in its line. This is what handleBackspace
  //does with that (modules/keyboard.js:338), reproduced rather than dispatched, since jsdom has
  //no keyboard; the point is that the attributor makes the format diff mean what it says.
  quill.setSelection(4, 0);
  var handler = quill.keyboard.bindings[8].find(function(b){ return b.handler.name === 'handleBackspace'; }).handler;
  handler.call(quill.keyboard, { index: 4, length: 0 }, { offset: 0, prefix: '', suffix: 'Hi.', format: { element: 'dialogue' } });

  assert.deepStrictEqual(quill.getContents().ops, [{ insert: 'BOBHi.' }, { insert: '\n', attributes: { element: 'character' } }]);
});

test('the HTML is built from the delta and escaped', function(){
  var html = deltaToScreenplayHtml({ ops: [
    { insert: 'a<b>&' }, { insert: '\n', attributes: { element: 'scene' } },
    { insert: 'x', attributes: { bold: true, italic: true, underline: true } }, { insert: '\n', attributes: { tight: true, dual: true } },
    { insert: '\n' },
    { insert: 'ignored' }, { insert: '\n', attributes: { element: 'nonsense', header: 1 } }
  ] });

  assert.strictEqual(html,
    '<p class="sp-scene">a&lt;b&gt;&amp;</p>' +
    '<p data-sp-tight="true" data-sp-dual="true"><strong><em><u>x</u></em></strong></p>' +
    '<p><br></p>' +
    '<p>ignored</p>');
  assert.strictEqual(deltaToScreenplayHtml(null), '<p><br></p>');
});

//---- Phase 4: elements and keys ------------------------------------------------------------------

const {
  setElement,
  insertElement,
  attachScreenplayKeys,
  screenplayEnterBinding,
  screenplayShiftEnterBinding,
  screenplayTabBinding,
  screenplayShiftTabBinding
} = require('../src/components/controllers/screenplay-editor');
const { applyQuillShortcuts } = require('../src/components/controllers/quill-utils');
const { resolveShortcuts } = require('../src/components/models/shortcuts');

//A script editor with the keys attached, and the mode a test can flip.
function scriptQuill(delta, mode){
  var quill = makeQuill();
  var state = { mode: mode || 'screenplay' };
  attachScreenplayKeys(quill, function(){ return state.mode; });
  if(delta)
    loadScreenplayDelta(quill, delta);
  return { quill: quill, state: state };
}

//Calls a binding's handler the way Quill's listen() would for a caret at `index`, with the context
//fields the handlers read. jsdom has no keyboard; the handler is the unit under test.
function press(quill, binding, index, length){
  quill.setSelection(index, length || 0);
  var line = quill.getLine(index);
  return binding.handler.call(quill.keyboard, { index: index, length: length || 0 }, {
    collapsed: !length, offset: line[1], format: quill.getFormat(index, length || 0), prefix: '', suffix: '', empty: !length && line[0].length() <= 1
  });
}

function lines(quill){
  return deltaToElements(quill.getContents()).map(function(e){ return [e.type, e.text].concat(e.tight ? ['tight'] : []).concat(e.dual ? ['dual'] : []); });
}

function delta(pairs){
  var ops = [];
  pairs.forEach(function(pair){
    if(pair[1] !== '')
      ops.push({ insert: pair[1] });
    var attrs = {};
    if(pair[0] !== 'action') attrs.element = pair[0];
    if(pair[2]) Object.assign(attrs, pair[2]);
    ops.push(Object.keys(attrs).length ? { insert: '\n', attributes: attrs } : { insert: '\n' });
  });
  return { ops: ops };
}

test('setElement is one formatLine, upper-cases the three types that take capitals, and clears the dual mark', function(){
  var s = scriptQuill(delta([['action', 'bob'], ['character', 'jane', { dual: true }]]));

  setElement(s.quill, 'character', { index: 0, length: 0 });
  assert.deepStrictEqual(lines(s.quill)[0], ['character', 'BOB']);

  setElement(s.quill, 'dialogue', { index: 4, length: 0 });
  assert.deepStrictEqual(lines(s.quill)[1], ['dialogue', 'jane'], 'the dual mark comes off with the cue');

  setElement(s.quill, 'action', { index: 0, length: 0 });
  assert.deepStrictEqual(lines(s.quill)[0], ['action', 'BOB'], 'text is never lower-cased back');
  assert.strictEqual(s.quill.root.querySelector('p').className, '');
});

test('setElement upper-cases run by run, keeping inline formats, in one undo entry with the type', function(){
  var s = scriptQuill({ ops: [{ insert: 'a ' }, { insert: 'quiet', attributes: { italic: true } }, { insert: ' room\n' }] });
  s.quill.history.clear();

  setElement(s.quill, 'scene', { index: 0, length: 0 });
  assert.deepStrictEqual(s.quill.getContents().ops, [
    { insert: 'A ' }, { insert: 'QUIET', attributes: { italic: true } }, { insert: ' ROOM' }, { insert: '\n', attributes: { element: 'scene' } }
  ]);

  s.quill.history.undo();
  assert.deepStrictEqual(lines(s.quill), [['action', 'a quiet room']]);
});

test('setElement covers every line a selection touches', function(){
  var s = scriptQuill(delta([['action', 'one'], ['action', 'two'], ['action', 'three']]));
  setElement(s.quill, 'dialogue', { index: 1, length: 5 });
  assert.deepStrictEqual(lines(s.quill).map(function(l){ return l[0]; }), ['dialogue', 'dialogue', 'action']);
});

test('Enter at the end of a line makes the element that follows it', function(){
  var cases = [
    ['scene', 'INT. A - DAY', 'action'],
    ['action', 'A room.', 'action'],
    ['character', 'BOB', 'dialogue'],
    ['parenthetical', '(low)', 'dialogue'],
    ['dialogue', 'Hi.', 'action'],
    ['transition', 'CUT TO:', 'scene'],
    ['centered', 'THE END', 'action']
  ];

  cases.forEach(function(c){
    var s = scriptQuill(delta([[c[0], c[1], { dual: c[0] === 'character' }]]));
    var enter = screenplayEnterBinding(s.quill, function(){ return 'screenplay'; });
    var claimed = press(s.quill, enter, c[1].length) === false;

    assert.ok(claimed, c[0] + ': the keypress is claimed');
    assert.deepStrictEqual(lines(s.quill), [[c[0], c[1]].concat(c[0] === 'character' ? ['dual'] : []), [c[2], '']], 'after ' + c[0]);
    assert.strictEqual(s.quill.getSelection().index, c[1].length + 1, 'caret on the new line');
  });
});

test('Enter after an action line that reads as a heading or a transition converts it first', function(){
  var s = scriptQuill(delta([['action', 'int. kitchen - day']]));
  var enter = screenplayEnterBinding(s.quill, function(){ return 'screenplay'; });
  press(s.quill, enter, 18);
  assert.deepStrictEqual(lines(s.quill), [['scene', 'INT. KITCHEN - DAY'], ['action', '']]);

  s = scriptQuill(delta([['action', 'CUT TO:']]));
  enter = screenplayEnterBinding(s.quill, function(){ return 'screenplay'; });
  press(s.quill, enter, 7);
  assert.deepStrictEqual(lines(s.quill), [['transition', 'CUT TO:'], ['scene', '']]);

  //A capitalised line with nothing after it is action to the codec, and stays action here: cues
  //are made with Tab, not guessed.
  s = scriptQuill(delta([['action', 'BOB']]));
  enter = screenplayEnterBinding(s.quill, function(){ return 'screenplay'; });
  press(s.quill, enter, 3);
  assert.deepStrictEqual(lines(s.quill), [['action', 'BOB'], ['action', '']]);
});

test('Enter on an empty line makes it action; on an empty action line it opens another', function(){
  ['scene', 'character', 'parenthetical', 'dialogue', 'transition'].forEach(function(type){
    var s = scriptQuill(delta([[type, '']]));
    var enter = screenplayEnterBinding(s.quill, function(){ return 'screenplay'; });
    assert.strictEqual(press(s.quill, enter, 0), false);
    //One empty action line, which is an empty document to the codec.
    assert.deepStrictEqual(s.quill.getContents().ops, [{ insert: '\n' }], 'empty ' + type);
  });

  var s = scriptQuill(delta([['action', '']]));
  var enter = screenplayEnterBinding(s.quill, function(){ return 'screenplay'; });
  press(s.quill, enter, 0);
  assert.deepStrictEqual(lines(s.quill), [['action', ''], ['action', '']]);
  assert.strictEqual(s.quill.getSelection().index, 1);
});

test('Enter at the start of a line pushes it down under a new line of its own type, and mid-line splits it', function(){
  var s = scriptQuill(delta([['character', 'BOB', { dual: true }]]));
  var enter = screenplayEnterBinding(s.quill, function(){ return 'screenplay'; });

  //The empty line above is a cue too, without the dual mark.
  press(s.quill, enter, 0);
  assert.deepStrictEqual(lines(s.quill), [['character', ''], ['character', 'BOB', 'dual']]);
  assert.strictEqual(s.quill.getSelection().index, 1, 'the caret stays with the cue');

  press(s.quill, enter, 3);
  assert.deepStrictEqual(lines(s.quill), [['character', ''], ['character', 'BO', 'dual'], ['character', 'B']], 'the second half is a cue without the mark');
  assert.strictEqual(s.quill.getSelection().index, 4);

  s = scriptQuill(delta([['action', 'A room.', { tight: true }]]));
  enter = screenplayEnterBinding(s.quill, function(){ return 'screenplay'; });
  press(s.quill, enter, 0);
  assert.deepStrictEqual(lines(s.quill), [['action', ''], ['action', 'A room.', 'tight']], 'the pushed-down line keeps its own flags');
});

test('Enter at the end of a cue marks it (CONT\'D) when the same character spoke last in the scene, before something other than speech', function(){
  var enter = function(s){ return screenplayEnterBinding(s.quill, function(){ return 'screenplay'; }); };

  var s = scriptQuill(delta([['character', 'BOB'], ['dialogue', 'One.'], ['action', 'He waits.'], ['character', 'BOB']]));
  press(s.quill, enter(s), s.quill.getLength() - 1);
  assert.deepStrictEqual(lines(s.quill).slice(-2), [['character', "BOB (CONT'D)"], ['dialogue', '']]);

  s = scriptQuill(delta([['character', 'BOB'], ['dialogue', 'One.'], ['character', 'BOB']]));
  press(s.quill, enter(s), s.quill.getLength() - 1);
  assert.deepStrictEqual(lines(s.quill).slice(-2), [['character', 'BOB'], ['dialogue', '']], 'nothing between the speeches: not continued');

  s = scriptQuill(delta([['character', 'BOB'], ['dialogue', 'One.'], ['action', 'Later.'], ['character', 'ANN'], ['dialogue', 'Two.'], ['action', 'Later.'], ['character', 'BOB']]));
  press(s.quill, enter(s), s.quill.getLength() - 1);
  assert.deepStrictEqual(lines(s.quill).slice(-2), [['character', 'BOB'], ['dialogue', '']], 'someone else spoke in between');

  s = scriptQuill(delta([['character', 'BOB'], ['dialogue', 'One.'], ['scene', 'INT. B - DAY'], ['action', 'Later.'], ['character', 'BOB']]));
  press(s.quill, enter(s), s.quill.getLength() - 1);
  assert.deepStrictEqual(lines(s.quill).slice(-2), [['character', 'BOB'], ['dialogue', '']], 'a new scene is not a continuation');

  s = scriptQuill(delta([['character', 'BOB (V.O.)'], ['dialogue', 'One.'], ['action', 'Later.'], ['character', 'BOB (V.O.)']]));
  press(s.quill, enter(s), s.quill.getLength() - 1);
  assert.deepStrictEqual(lines(s.quill).slice(-2), [['character', 'BOB (V.O.)'], ['dialogue', '']], 'a cue with an extension is left to the writer');

  s = scriptQuill(delta([['character', 'BOB'], ['parenthetical', '(low)'], ['dialogue', 'One.'], ['action', ''], ['action', 'Later.'], ['note', 'fix'], ['character', 'BOB']]));
  press(s.quill, enter(s), s.quill.getLength() - 1);
  assert.deepStrictEqual(lines(s.quill).slice(-2), [['character', "BOB (CONT'D)"], ['dialogue', '']], 'back over the parenthetical, the blank line and the note');
});

test('Enter and Tab jump over trailing spaces', function(){
  var s = scriptQuill(delta([['character', 'BOB  ']]));
  var enter = screenplayEnterBinding(s.quill, function(){ return 'screenplay'; });
  press(s.quill, enter, 3);
  assert.deepStrictEqual(lines(s.quill), [['character', 'BOB  '], ['dialogue', '']], 'not split at the caret');
  assert.strictEqual(s.quill.getSelection().index, 6);

  s = scriptQuill(delta([['dialogue', 'Hi.  ']]));
  var tab = screenplayTabBinding(s.quill, function(){ return 'screenplay'; });
  press(s.quill, tab, 3);
  assert.deepStrictEqual(lines(s.quill), [['dialogue', 'Hi.  '], ['parenthetical', '()']]);
});

test('Enter just inside the closing bracket of a parenthetical opens the speech below; Shift+Enter breaks the line', function(){
  var enter = function(s){ return screenplayEnterBinding(s.quill, function(){ return 'screenplay'; }); };

  var s = scriptQuill(delta([['character', 'BOB'], ['parenthetical', '(low)']]));
  press(s.quill, enter(s), s.quill.getLength() - 2);
  assert.deepStrictEqual(lines(s.quill), [['character', 'BOB'], ['parenthetical', '(low)'], ['dialogue', '']], 'not split at the caret');
  assert.strictEqual(s.quill.getSelection().index, s.quill.getLength() - 1, 'the caret is on the speech');

  //Spaces after the bracket are jumped over with it.
  s = scriptQuill(delta([['parenthetical', '(low)  ']]));
  press(s.quill, enter(s), 5);
  assert.deepStrictEqual(lines(s.quill), [['parenthetical', '(low)  '], ['dialogue', '']]);

  //The bracket has to be the end of the line: a caret in the middle still splits.
  s = scriptQuill(delta([['parenthetical', '(low) then up)']]));
  press(s.quill, enter(s), 5);
  assert.deepStrictEqual(lines(s.quill), [['parenthetical', '(low)'], ['parenthetical', ' then up)']]);

  //And it is Enter alone: Shift+Enter breaks the parenthetical there, as it does anywhere.
  s = scriptQuill(delta([['parenthetical', '(low)']]));
  var shiftEnter = screenplayShiftEnterBinding(s.quill, function(){ return 'screenplay'; });
  assert.strictEqual(press(s.quill, shiftEnter, 4), false);
  assert.deepStrictEqual(lines(s.quill), [['parenthetical', '(low'], ['parenthetical', ')', 'tight']]);
});

test('Ctrl+Enter opens a new heading and Ctrl+Shift+Enter the element picker, as fixed bindings', function(){
  var s = scriptQuill(delta([['action', 'A room.']]));
  var ctrlEnter = s.quill.keyboard.bindings[13].find(function(b){ return b.ctrlKey && !b.shiftKey; });
  var picker = s.quill.keyboard.bindings[13].find(function(b){ return b.ctrlKey && b.shiftKey; });
  assert.ok(ctrlEnter && picker, 'both bound on Enter with the modifier');

  assert.strictEqual(press(s.quill, ctrlEnter, 7), false);
  assert.deepStrictEqual(lines(s.quill), [['action', 'A room.'], ['scene', '']]);

  assert.strictEqual(press(s.quill, picker, 8), false);
  var popup = document.getElementById('element-picker');
  assert.ok(popup, 'the picker is showing');
  var list = popup.querySelector('.element-picker-list');
  list.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
  list.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
  list.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
  assert.strictEqual(document.getElementById('element-picker'), null, 'closed on Enter');
  assert.deepStrictEqual(lines(s.quill), [['action', 'A room.'], ['character', '']], 'the empty heading was made the third type, Character');

  s.state.mode = 'prose';
  assert.strictEqual(press(s.quill, ctrlEnter, 7), true);
  assert.strictEqual(press(s.quill, picker, 7), true);
});

test('Enter with a selection, or while the editor shows prose, is left to Quill', function(){
  var s = scriptQuill(delta([['character', 'BOB']]), 'prose');
  var enter = screenplayEnterBinding(s.quill, function(){ return s.state.mode; });
  assert.strictEqual(press(s.quill, enter, 3), true);

  s.state.mode = 'screenplay';
  assert.strictEqual(press(s.quill, enter, 0, 2), true);
  assert.deepStrictEqual(lines(s.quill), [['character', 'BOB']], 'nothing changed');
});

test('Shift+Enter makes a tight line of the same type', function(){
  var s = scriptQuill(delta([['dialogue', 'One.']]));
  var shiftEnter = screenplayShiftEnterBinding(s.quill, function(){ return 'screenplay'; });

  assert.strictEqual(press(s.quill, shiftEnter, 4), false);
  assert.deepStrictEqual(lines(s.quill), [['dialogue', 'One.'], ['dialogue', '', 'tight']]);

  s.state.mode = 'prose';
  var prose = screenplayShiftEnterBinding(s.quill, function(){ return s.state.mode; });
  assert.strictEqual(press(s.quill, prose, 4), true);
});

test('Tab moves to the next element a writer reaches for', function(){
  var tab = function(s){ return screenplayTabBinding(s.quill, function(){ return 'screenplay'; }); };

  var s = scriptQuill(delta([['scene', '']]));
  press(s.quill, tab(s), 0);
  assert.deepStrictEqual(lines(s.quill), [['scene', 'INT. ']]);
  assert.strictEqual(s.quill.getSelection().index, 5);

  //A heading is stepped through: after the place, Tab puts in the " - " the
  //time follows, trailing spaces and all; with a time there already, or no place yet, nothing.
  s = scriptQuill(delta([['scene', 'INT. A  ']]));
  press(s.quill, tab(s), 2);
  assert.deepStrictEqual(lines(s.quill), [['scene', 'INT. A - ']], 'the separator after the place');
  assert.strictEqual(s.quill.getSelection().index, 9);
  press(s.quill, tab(s), 9);
  assert.deepStrictEqual(lines(s.quill), [['scene', 'INT. A - ']], 'once');
  s = scriptQuill(delta([['scene', 'INT. ']]));
  press(s.quill, tab(s), 5);
  assert.deepStrictEqual(lines(s.quill), [['scene', 'INT. ']], 'no place yet');

  s = scriptQuill(delta([['action', 'bob']]));
  press(s.quill, tab(s), 1);
  assert.deepStrictEqual(lines(s.quill), [['character', 'BOB']]);

  s = scriptQuill(delta([['character', 'BOB']]));
  press(s.quill, tab(s), 1);
  assert.deepStrictEqual(lines(s.quill), [['character', 'BOB'], ['parenthetical', '()']]);
  assert.strictEqual(s.quill.getSelection().index, 5, 'the caret sits between the parentheses');

  //An empty cue or speech becomes the parenthetical itself, rather than leaving an empty line.
  s = scriptQuill(delta([['character', 'BOB'], ['dialogue', '']]));
  press(s.quill, tab(s), 4);
  assert.deepStrictEqual(lines(s.quill), [['character', 'BOB'], ['parenthetical', '()']], 'in place');
  assert.strictEqual(s.quill.getSelection().index, 5);

  s = scriptQuill(delta([['dialogue', 'Hi.'], ['action', 'Later.']]));
  press(s.quill, tab(s), 0);
  assert.deepStrictEqual(lines(s.quill), [['dialogue', 'Hi.'], ['parenthetical', '()'], ['action', 'Later.']], 'opened after the whole line, wherever the caret was');

  s = scriptQuill(delta([['parenthetical', '(low)']]));
  press(s.quill, tab(s), 5);
  assert.deepStrictEqual(lines(s.quill), [['parenthetical', '(low)'], ['dialogue', '']]);

  //A transition: Tab at the start does nothing (but is not handed to Quill,
  //which would type a tab), and after the text it opens the action line under it.
  s = scriptQuill(delta([['transition', 'CUT TO:']]));
  assert.strictEqual(press(s.quill, tab(s), 0), false);
  assert.deepStrictEqual(lines(s.quill), [['transition', 'CUT TO:']]);
  press(s.quill, tab(s), 3);
  assert.deepStrictEqual(lines(s.quill), [['transition', 'CUT TO:'], ['action', '']], 'opened after the whole line');
  assert.strictEqual(s.quill.getSelection().index, 8);

  s = scriptQuill(delta([['centered', 'x']]));
  press(s.quill, tab(s), 0);
  assert.deepStrictEqual(lines(s.quill), [['action', 'x']]);
});

test('Tab and Shift+Tab are handed to Quill in prose and Shift+Tab is swallowed in a script', function(){
  var s = scriptQuill(delta([['action', 'x']]), 'prose');
  var mode = function(){ return s.state.mode; };
  assert.strictEqual(press(s.quill, screenplayTabBinding(s.quill, mode), 0), true);
  assert.strictEqual(press(s.quill, screenplayShiftTabBinding(mode), 0), true);

  s.state.mode = 'screenplay';
  assert.strictEqual(press(s.quill, screenplayShiftTabBinding(mode), 0), false);
});

test('attachScreenplayKeys puts the bindings ahead of Quill\'s own for Enter and Tab', function(){
  var s = scriptQuill();
  var enterHandlers = s.quill.keyboard.bindings[13];
  var tabHandlers = s.quill.keyboard.bindings[9];

  assert.strictEqual(enterHandlers[0].shiftKey, undefined, 'plain Enter first');
  assert.strictEqual(enterHandlers[1].shiftKey, true);
  assert.ok(enterHandlers.some(function(b){ return b.handler.name === 'handleEnter'; }), 'Quill\'s own is still there, after ours');
  assert.strictEqual(tabHandlers[0].shiftKey, undefined);
  assert.strictEqual(tabHandlers[1].shiftKey, true);
});

//The element shortcuts: Ctrl+digit opens a new element on a line with text
//and sets the type of an empty line or a selection; Ctrl+Alt+digit sets the type outright.
test('insertElement opens a new line of the type where the caret is, and sets the type of an empty line or a selection', function(){
  var s = scriptQuill(delta([['action', 'A room.']]));

  s.quill.setSelection(7, 0);
  insertElement(s.quill, 'character');
  assert.deepStrictEqual(lines(s.quill), [['action', 'A room.'], ['character', '']], 'at the end: below');
  assert.strictEqual(s.quill.getSelection().index, 8);

  s = scriptQuill(delta([['dialogue', 'Hi there.', { tight: true }]]));
  s.quill.setSelection(0, 0);
  insertElement(s.quill, 'parenthetical');
  assert.deepStrictEqual(lines(s.quill), [['parenthetical', ''], ['dialogue', 'Hi there.', 'tight']], 'at the start: above, and the line keeps its flags');
  assert.strictEqual(s.quill.getSelection().index, 0);

  s = scriptQuill(delta([['action', 'One. Two.']]));
  s.quill.setSelection(5, 0);
  insertElement(s.quill, 'character');
  assert.deepStrictEqual(lines(s.quill), [['action', 'One. '], ['character', ''], ['action', 'Two.']], 'mid-line: between the halves');
  assert.strictEqual(s.quill.getSelection().index, 6);

  s = scriptQuill(delta([['action', '']]));
  s.quill.setSelection(0, 0);
  insertElement(s.quill, 'scene');
  assert.deepStrictEqual(lines(s.quill), [['scene', '']], 'an empty line is made the type');

  s = scriptQuill(delta([['action', 'bob'], ['action', 'Hi.']]));
  s.quill.setSelection(0, 5);
  insertElement(s.quill, 'transition');
  assert.deepStrictEqual(lines(s.quill), [['transition', 'BOB'], ['transition', 'HI.']], 'a selection is made the type');
});

test('the element shortcuts drive insertElement and setElement on a real editor', function(){
  var s = scriptQuill(delta([['action', 'bob']]));
  applyQuillShortcuts(s.quill, resolveShortcuts(null), 'screenplay');

  //Ctrl+3 is elementCharacter and Ctrl+Alt+3 reformatCharacter; Quill keys its bindings by
  //keyCode, and '3' is 51.
  var insert = s.quill.keyboard.bindings[51].find(function(b){ return b.warewoolfAction === 'elementCharacter'; });
  var reformat = s.quill.keyboard.bindings[51].find(function(b){ return b.warewoolfAction === 'reformatCharacter'; });
  assert.ok(insert && !insert.altKey, 'Ctrl+3 bound');
  assert.ok(reformat && reformat.altKey, 'Ctrl+Alt+3 bound');
  assert.ok(!s.quill.keyboard.bindings[51].some(function(b){ return b.warewoolfAction === 'formatHeading3'; }), 'and the prose heading is not');

  s.quill.setSelection(3, 0);
  insert.handler.call(s.quill.keyboard, { index: 3, length: 0 }, {});
  assert.deepStrictEqual(lines(s.quill), [['action', 'bob'], ['character', '']], 'a new cue under the action');

  s.quill.setSelection(1, 0);
  reformat.handler.call(s.quill.keyboard, { index: 1, length: 0 }, {});
  assert.deepStrictEqual(lines(s.quill), [['character', 'BOB'], ['character', '']], 'the action line made a cue');
});

//An action line typed as "INT. " becomes a heading on the space, and cues, headings and
//transitions are kept in capitals as they are typed, with the caret where it was.
test('typing "INT. " on an action line makes it a heading, and typed text in a cue, heading or transition goes to capitals', function(){
  var s = scriptQuill(delta([['action', '']]));
  attachScreenplayTyping(s.quill, function(){ return s.state.mode; });

  var type = function(index, text){
    s.quill.setSelection(index, 0, 'user');
    s.quill.insertText(index, text, 'user');
    s.quill.setSelection(index + text.length, 0, 'user');
  };

  type(0, 'int.');
  assert.deepStrictEqual(lines(s.quill), [['action', 'int.']], 'not yet');
  type(4, ' ');
  assert.deepStrictEqual(lines(s.quill), [['scene', 'INT. ']], 'on the space');
  type(5, 'kitchen');
  assert.deepStrictEqual(lines(s.quill), [['scene', 'INT. KITCHEN']], 'and in capitals from then on');
  assert.strictEqual(s.quill.getSelection().index, 12, 'the caret kept up');

  //Mid-line too, with the caret staying where it typed.
  type(5, 'the ');
  assert.deepStrictEqual(lines(s.quill), [['scene', 'INT. THE KITCHEN']]);
  assert.strictEqual(s.quill.getSelection().index, 9);

  //Not in prose, not in action, and not "int." inside a sentence.
  s = scriptQuill(delta([['action', 'The int. shot.'], ['dialogue', '']]));
  attachScreenplayTyping(s.quill, function(){ return s.state.mode; });
  type(15, 'hello');
  assert.deepStrictEqual(lines(s.quill), [['action', 'The int. shot.'], ['dialogue', 'hello']]);
  s.state.mode = 'prose';
  s = scriptQuill(delta([['character', '']]), 'prose');
  attachScreenplayTyping(s.quill, function(){ return s.state.mode; });
  type(0, 'bob');
  assert.deepStrictEqual(lines(s.quill), [['character', 'bob']]);
});

test('toggleDual marks the cue the caret is on or under, and unmarks it again', function(){
  var s = scriptQuill(delta([['character', 'BOB'], ['dialogue', 'Hi.'], ['action', 'Later.']]));

  s.quill.setSelection(5, 0);
  toggleDual(s.quill);
  assert.deepStrictEqual(lines(s.quill), [['character', 'BOB', 'dual'], ['dialogue', 'Hi.'], ['action', 'Later.']], 'from the speech');

  s.quill.setSelection(1, 0);
  toggleDual(s.quill);
  assert.deepStrictEqual(lines(s.quill), [['character', 'BOB'], ['dialogue', 'Hi.'], ['action', 'Later.']], 'off again from the cue');

  s.quill.setSelection(9, 0);
  toggleDual(s.quill);
  assert.deepStrictEqual(lines(s.quill), [['character', 'BOB'], ['dialogue', 'Hi.'], ['action', 'Later.']], 'nothing from action');
});

test('cycleCase takes the selection, or the word at the caret, through capitals, lower case and Title Case', function(){
  var s = scriptQuill(delta([['action', 'a quiet room']]));

  s.quill.setSelection(0, 12);
  cycleCase(s.quill);
  assert.deepStrictEqual(lines(s.quill), [['action', 'A Quiet Room']], 'lower case goes to Title Case');
  assert.deepStrictEqual([s.quill.getSelection().index, s.quill.getSelection().length], [0, 12], 'still selected');
  cycleCase(s.quill);
  assert.deepStrictEqual(lines(s.quill), [['action', 'A QUIET ROOM']], 'mixed goes to capitals');
  cycleCase(s.quill);
  assert.deepStrictEqual(lines(s.quill), [['action', 'a quiet room']], 'capitals go to lower case');

  s.quill.setSelection(3, 0);
  cycleCase(s.quill);
  assert.deepStrictEqual(lines(s.quill), [['action', 'a Quiet room']], 'the word at the caret');
});

//---- Phase 5: scenes -----------------------------------------------------------------------------

const { sceneIndex, sceneAt, previousSceneStart, nextSceneStart, moveScene, moveScenes, sceneBlock, splitScenes, appendScenes } = require('../src/components/controllers/screenplay-editor');

const THREE_SCENES = 'FADE IN:\n\nINT. A - DAY\n\nOne.\n\nBOB\nHi.\n\nEXT. B - NIGHT\n\nTwo.\n\nINT. C - DAY\n\nThree.\n';

test('sceneIndex lists the headings with the index each starts at', function(){
  var scenes = sceneIndex(elementsToDelta(parseFountain(THREE_SCENES).elements));
  assert.deepStrictEqual(scenes, [
    { title: 'INT. A - DAY', index: 9 },
    { title: 'EXT. B - NIGHT', index: 35 },
    { title: 'INT. C - DAY', index: 55 }
  ]);
  assert.deepStrictEqual(sceneIndex({ ops: [{ insert: '\n' }] }), []);
  assert.deepStrictEqual(sceneIndex(null), []);
});

test('sceneAt, previousSceneStart and nextSceneStart work from the caret', function(){
  var scenes = sceneIndex(elementsToDelta(parseFountain(THREE_SCENES).elements));

  assert.strictEqual(sceneAt(scenes, 0), -1, 'FADE IN: belongs to no scene');
  assert.strictEqual(sceneAt(scenes, 9), 0);
  assert.strictEqual(sceneAt(scenes, 30), 0);
  assert.strictEqual(sceneAt(scenes, 35), 1);
  assert.strictEqual(sceneAt(scenes, 999), 2);

  assert.strictEqual(previousSceneStart(scenes, 0), null);
  assert.strictEqual(previousSceneStart(scenes, 9), null, 'from a heading, the one above');
  assert.strictEqual(previousSceneStart(scenes, 30), 9, 'from inside a scene, its own heading');
  assert.strictEqual(previousSceneStart(scenes, 35), 9);
  assert.strictEqual(nextSceneStart(scenes, 0), 9);
  assert.strictEqual(nextSceneStart(scenes, 9), 35);
  assert.strictEqual(nextSceneStart(scenes, 55), null);
});

test('moveScene swaps a scene with its neighbour and leaves the text before the first heading alone', function(){
  var parsed = parseFountain(THREE_SCENES);
  var delta = elementsToDelta(parsed.elements);

  var down = moveScene(delta, 0, 1);
  var downText = deltaToElements(down).map(function(e){ return e.text; }).filter(Boolean);
  assert.deepStrictEqual(downText, ['FADE IN:', 'EXT. B - NIGHT', 'Two.', 'INT. A - DAY', 'One.', 'BOB', 'Hi.', 'INT. C - DAY', 'Three.']);
  assert.strictEqual(down.start, 29, 'the moved heading now starts after FADE IN: and scene B');
  assert.strictEqual(sceneIndex(down)[1].index, down.start);

  var up = moveScene(delta, 2, -1);
  var upText = deltaToElements(up).map(function(e){ return e.text; }).filter(Boolean);
  assert.deepStrictEqual(upText, ['FADE IN:', 'INT. A - DAY', 'One.', 'BOB', 'Hi.', 'INT. C - DAY', 'Three.', 'EXT. B - NIGHT', 'Two.']);
  assert.strictEqual(sceneIndex(up)[1].index, up.start);

  assert.strictEqual(moveScene(delta, 0, -1), null, 'nothing above the first');
  assert.strictEqual(moveScene(delta, 2, 1), null, 'nothing below the last');
  assert.strictEqual(moveScene(delta, -1, 1), null, 'the preamble is not a scene');

  //Everything the elements carried survives: the flags and the inline formats travel with the lines.
  assert.deepStrictEqual(deltaToElements(down).length, parsed.elements.length);
});

//---- Scene blocks: docs/screenplay-plan.md, "One script" --------------------------------------

//THREE_SCENES by index: FADE IN: 0-8, INT. A 9-34 (One. BOB Hi.), EXT. B 35-54 (Two.), INT. C 55-74.
function textsOf(delta){
  return deltaToElements(delta).map(function(e){ return e.text; }).filter(Boolean);
}

test('sceneBlock is the scenes a selection covers, a partly selected one included', function(){
  var scenes = sceneIndex(elementsToDelta(parseFountain(THREE_SCENES).elements));

  assert.deepStrictEqual(sceneBlock(scenes, { index: 30, length: 0 }), { from: 0, to: 0 }, 'the caret\'s scene');
  assert.deepStrictEqual(sceneBlock(scenes, { index: 60, length: 0 }), { from: 2, to: 2 });
  assert.deepStrictEqual(sceneBlock(scenes, { index: 12, length: 30 }), { from: 0, to: 1 }, 'a range reaching into B takes B');
  assert.deepStrictEqual(sceneBlock(scenes, { index: 9, length: 26 }), { from: 0, to: 0 }, 'ending where B\'s heading begins does not take B');
  assert.deepStrictEqual(sceneBlock(scenes, { index: 9, length: 27 }), { from: 0, to: 1 });
  assert.deepStrictEqual(sceneBlock(scenes, { index: 0, length: 20 }), { from: 0, to: 0 }, 'from the preamble into A covers from A');
  assert.strictEqual(sceneBlock(scenes, { index: 0, length: 0 }), null, 'the preamble is no scene');
  assert.strictEqual(sceneBlock(scenes, { index: 0, length: 5 }), null);
  assert.strictEqual(sceneBlock([], { index: 0, length: 0 }), null, 'no headings, no blocks');
  assert.strictEqual(sceneBlock(scenes, null), null);
});

test('splitScenes says where a block sits and hands back the block on its own', function(){
  var delta = elementsToDelta(parseFountain(THREE_SCENES).elements);

  var one = splitScenes(delta, 1, 1);
  assert.strictEqual(one.start, 35);
  assert.strictEqual(one.length, 20);
  assert.deepStrictEqual(textsOf(one.extracted), ['EXT. B - NIGHT', 'Two.']);

  var all = splitScenes(delta, 0, 2);
  assert.strictEqual(all.start, 9);
  assert.strictEqual(all.length, 66);
  assert.deepStrictEqual(textsOf(all.extracted), ['INT. A - DAY', 'One.', 'BOB', 'Hi.', 'EXT. B - NIGHT', 'Two.', 'INT. C - DAY', 'Three.']);
  assert.strictEqual(deltaToElements(all.extracted)[2].type, 'character', 'the element types travel with the block');

  assert.strictEqual(splitScenes(delta, 2, 3), null);
  assert.strictEqual(splitScenes(delta, -1, 0), null);
  assert.strictEqual(splitScenes(delta, 1, 0), null);
});

test('moveScenes moves a block of scenes as one and says where it landed', function(){
  var delta = elementsToDelta(parseFountain(THREE_SCENES).elements);

  var down = moveScenes(delta, 0, 1, 1);
  assert.deepStrictEqual(textsOf(down), ['FADE IN:', 'INT. C - DAY', 'Three.', 'INT. A - DAY', 'One.', 'BOB', 'Hi.', 'EXT. B - NIGHT', 'Two.']);
  assert.strictEqual(down.start, 29, 'after FADE IN: and scene C');
  assert.strictEqual(down.length, 46, 'A and B together');
  assert.strictEqual(sceneIndex(down)[1].index, down.start);

  var up = moveScenes(delta, 1, 2, -1);
  assert.deepStrictEqual(textsOf(up), ['FADE IN:', 'EXT. B - NIGHT', 'Two.', 'INT. C - DAY', 'Three.', 'INT. A - DAY', 'One.', 'BOB', 'Hi.']);
  assert.strictEqual(up.start, 9);
  assert.strictEqual(up.length, 40);

  assert.strictEqual(moveScenes(delta, 1, 2, 1), null, 'nothing below the last');
  assert.strictEqual(moveScenes(delta, 0, 1, -1), null, 'nothing above the first');
  assert.strictEqual(moveScene(delta, 1, 1).start, moveScenes(delta, 1, 1, 1).start, 'moveScene is the one-scene case');
});

//A blank line inside a scene (Fountain's "two spaces" empty dialogue line, or a plain empty action
//line) is one run of empty text to parseDelta. Written back as an empty insert, Delta.diff could not
//align the rebuilt delta with the editor's and answered with a change touching every line.
test('a rebuilt delta carries no empty inserts, so the change applied is the move and nothing else', function(){
  var Delta = require('quill-delta');
  var delta = elementsToDelta(parseFountain('INT. A - DAY\n\nOne.\n\n\n\nBOB\nHi.\n  \nBye.\n\nEXT. B - NIGHT\n\nTwo.\n\nINT. C - DAY\n\nThree.\n').elements);
  delta.ops.splice(3, 0, { insert: '\n' }); //and a bare empty line, as the editor holds one

  var moved = moveScenes(delta, 2, 2, -1);
  assert.ok(moved.ops.every(function(op){ return op.insert !== ''; }));

  var diff = new Delta(delta).diff(new Delta(moved.ops));
  assert.ok(diff.ops.length <= 8, 'a retain, the inserted lines, a retain and a delete - not ' + diff.ops.length);
  var canonical = function(ops){ return new Delta().compose(new Delta(ops)).ops; };
  assert.deepStrictEqual(canonical(new Delta(delta).compose(diff).ops), canonical(moved.ops));

  var still = moveScenes(moveScenes(delta, 1, 1, 1), 2, 2, -1);
  assert.strictEqual(new Delta(delta).diff(new Delta(still.ops)).ops.length, 0, 'there and back is no change at all');
});

test('appendScenes puts a block after the script, or in place of an empty one', function(){
  var delta = elementsToDelta(parseFountain(THREE_SCENES).elements);
  var block = splitScenes(delta, 1, 1).extracted;

  var onto = appendScenes(delta, block);
  assert.strictEqual(onto.start, 75);
  assert.deepStrictEqual(textsOf(onto), ['FADE IN:', 'INT. A - DAY', 'One.', 'BOB', 'Hi.', 'EXT. B - NIGHT', 'Two.', 'INT. C - DAY', 'Three.', 'EXT. B - NIGHT', 'Two.']);
  assert.strictEqual(sceneIndex(onto)[3].index, onto.start);

  var fresh = appendScenes({ ops: [{ insert: '\n' }] }, block);
  assert.strictEqual(fresh.start, 0);
  assert.deepStrictEqual(textsOf(fresh), ['EXT. B - NIGHT', 'Two.']);
  assert.strictEqual(fresh.ops.length, block.ops.length, 'no blank line left above it');
});

//---- Phase 6: autocomplete -----------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { characterNames, locations, speakersFor, suggestionsFor, attachAutocomplete, attachScreenplayTyping, toggleDual } = require('../src/components/controllers/screenplay-editor');
const { cycleCase } = require('../src/components/controllers/quill-utils');

const CAST = 'INT. WILL\'S BEDROOM - NIGHT (1973)\n\nEDWARD (V.O.)\nOne.\n\nWILL\nTwo.\n\nEDWARD (CONT\'D)\nThree.\n\nEXT. CAMPFIRE - NIGHT\n\nSANDRA ^\nFour.\n\nINT. WILL\'S BEDROOM - DAY #4#\n\nwill\nFive.\n';

test('characterNames and locations come from the cues and headings, stripped, in capitals, once each', function(){
  var d = elementsToDelta(parseFountain(CAST).elements);
  assert.deepStrictEqual(characterNames(d), ['EDWARD', 'SANDRA', 'WILL']);
  assert.deepStrictEqual(locations(d), ['CAMPFIRE', 'WILL\'S BEDROOM']);
  assert.deepStrictEqual(characterNames(null), []);
});

//What a result says: what was typed, what is offered, and how an accepted one goes in.
function offered(found){
  return found ? { typed: found.typed, suggestions: found.suggestions, replacement: found.prefix + found.suggestions[0] + found.suffix, from: found.from, to: found.to } : null;
}

test('suggestionsFor offers names a cue is the start of and places a heading is, from one character', function(){
  var d = elementsToDelta(parseFountain(CAST).elements);

  assert.deepStrictEqual(offered(suggestionsFor(d, 'character', 'e')), { typed: 'E', suggestions: ['EDWARD'], replacement: 'EDWARD', from: 0, to: 1 });
  assert.strictEqual(suggestionsFor(d, 'character', 'EDWARD'), null, 'already typed in full');
  assert.strictEqual(suggestionsFor(d, 'character', 'zz'), null);

  assert.deepStrictEqual(offered(suggestionsFor(d, 'scene', 'INT. wi')), { typed: 'WI', suggestions: ['WILL\'S BEDROOM'], replacement: 'WILL\'S BEDROOM', from: 5, to: 7 }, 'the place goes in after the prefix');
  assert.deepStrictEqual(suggestionsFor(d, 'scene', 'ext. c').suggestions, ['CAMPFIRE']);
  assert.strictEqual(suggestionsFor(d, 'dialogue', 'ed'), null);
});

test('suggestionsFor offers the intros, times, transitions and extensions every script shares', function(){
  var d = elementsToDelta(parseFountain(CAST).elements);

  //An empty heading offers the intros, with a space after; a typed letter narrows them.
  assert.deepStrictEqual(offered(suggestionsFor(d, 'scene', '')), { typed: '', suggestions: ['INT.', 'EXT.', 'INT./EXT.', 'EST.'], replacement: 'INT. ', from: 0, to: 0 });
  assert.deepStrictEqual(offered(suggestionsFor(d, 'scene', 'e')), { typed: 'E', suggestions: ['EXT.', 'EST.'], replacement: 'EXT. ', from: 0, to: 1 });
  assert.strictEqual(suggestionsFor(d, 'scene', '').handOn, false, 'an intro is the start of the heading, so Enter stays on the line');

  //After the separator, the times; the typed part alone is replaced.
  var times = suggestionsFor(d, 'scene', 'INT. KITCHEN - ');
  assert.deepStrictEqual([times.typed, times.from, times.to, times.suggestions[0]], ['', 15, 15, 'DAY']);
  var typedTime = suggestionsFor(d, 'scene', 'INT. KITCHEN - mo');
  assert.deepStrictEqual([typedTime.suggestions, typedTime.from, typedTime.to], [['MOMENTS LATER', 'MORNING'], 15, 17]);
  assert.strictEqual(suggestionsFor(d, 'scene', 'INT. KITCHEN - DAY'), null);

  //The places right after the prefix, before anything is typed.
  assert.deepStrictEqual(suggestionsFor(d, 'scene', 'INT. ').suggestions, ['CAMPFIRE', 'WILL\'S BEDROOM']);

  //A transition: the usual ones and the script's own.
  assert.deepStrictEqual(suggestionsFor(d, 'transition', 'cu').suggestions, ['CUT TO:']);
  assert.ok(suggestionsFor(d, 'transition', '').suggestions.indexOf('FADE OUT.') !== -1);

  //An extension after the name, with the space put in if it was not.
  assert.deepStrictEqual(offered(suggestionsFor(d, 'character', 'BOB(')), { typed: '', suggestions: ['(V.O.)', '(O.S.)', '(O.C.)', '(CONT\'D)'], replacement: 'BOB (V.O.)', from: 0, to: 4 });
  assert.deepStrictEqual(suggestionsFor(d, 'character', 'BOB (o').suggestions, ['(O.S.)', '(O.C.)']);
  assert.strictEqual(suggestionsFor(d, 'character', 'BOB (V.O.)'), null, 'closed');
  assert.strictEqual(suggestionsFor(d, 'character', '('), null, 'no name yet');
});

test('an empty cue offers the next speaker first: whoever spoke before the last speaker, then the scene, then the rest', function(){
  var d = elementsToDelta(parseFountain('INT. A - DAY\n\nANNA\nOne.\n\nBOB\nTwo.\n\nCARL\nThree.\n\nEXT. B - DAY\n\nDAVE\nFour.\n\nBOB\nFive.\n\n').elements);
  var index = 0;
  d.ops.forEach(function(op){ index += typeof op.insert === 'string' ? op.insert.length : 1; });

  //A cue at the very end: BOB spoke last, DAVE before him, so DAVE is the guess, then BOB, then
  //the earlier scene's speakers by recency, then nobody left.
  assert.deepStrictEqual(speakersFor(d, index), ['DAVE', 'BOB', 'CARL', 'ANNA']);
  assert.deepStrictEqual(suggestionsFor(d, 'character', '', index).suggestions[0], 'DAVE');

  //A cue at the start of the second scene: nobody has spoken in it, so the first scene's speakers
  //by recency.
  var secondScene = 'INT. A - DAY\n'.length + 'ANNA\nOne.\nBOB\nTwo.\nCARL\nThree.\nEXT. B - DAY\n'.length;
  assert.deepStrictEqual(speakersFor(d, secondScene), ['CARL', 'BOB', 'ANNA', 'DAVE']);
});

//A script editor with the box attached and the keys the box answers, for the tests below.
function boxQuill(delta){
  var s = scriptQuill(delta);
  s.box = attachAutocomplete(s.quill, function(){ return s.state.mode; }, function(){ return s.state.autocomplete !== false; });
  s.key = function(code, index){
    var binding = s.quill.keyboard.bindings[code][0];
    return binding.handler.call(s.quill.keyboard, { index: index, length: 0 }, {});
  };
  s.type = function(index, text){
    s.quill.setSelection(index, 0, 'user');
    s.quill.insertText(index, text, 'user');
    s.quill.setSelection(index + text.length, 0, 'user');
  };
  return s;
}

function shown(){
  return Array.from(document.querySelectorAll('.suggestion-box .suggestion')).map(function(el){ return el.textContent; });
}

test('the suggestion box opens under a cue being typed, accepts with Enter, and Enter then opens the speech', function(){
  var s = boxQuill(elementsToDelta(parseFountain(CAST).elements));
  var end = s.quill.getLength() - 1;

  //A new cue at the end of the script.
  s.quill.insertText(end, '\n', 'user');
  s.quill.formatLine(end + 1, 1, 'element', 'character', 'user');
  s.type(end + 1, 'S');
  assert.strictEqual(s.box.isOpen(), true, 'one character is enough');
  assert.deepStrictEqual(shown(), ['SANDRA']);

  assert.strictEqual(s.key(13, end + 2), false, 'Enter is claimed while the box is open');
  assert.strictEqual(s.box.isOpen(), false);
  assert.deepStrictEqual(lines(s.quill).slice(-2), [['character', 'SANDRA'], ['dialogue', '']], 'the name went in and the speech opened under it');
  assert.strictEqual(s.quill.getSelection().index, end + 8, 'the caret is on the speech');

  //Closed, Enter falls through to the screenplay binding beneath it.
  assert.strictEqual(s.key(13, end + 8), true);
});

test('Tab accepts and opens the parenthetical; the right arrow and a click accept and stay', function(){
  var s = boxQuill(elementsToDelta(parseFountain(CAST).elements));
  var end = s.quill.getLength() - 1;
  s.quill.insertText(end, '\n', 'user');
  s.quill.formatLine(end + 1, 1, 'element', 'character', 'user');

  s.type(end + 1, 'E');
  assert.strictEqual(s.key(9, end + 2), false);
  assert.deepStrictEqual(lines(s.quill).slice(-2), [['character', 'EDWARD'], ['parenthetical', '()']]);

  s = boxQuill(elementsToDelta(parseFountain(CAST).elements));
  end = s.quill.getLength() - 1;
  s.quill.insertText(end, '\n', 'user');
  s.quill.formatLine(end + 1, 1, 'element', 'character', 'user');
  s.type(end + 1, 'E');
  assert.strictEqual(s.key(39, end + 2), false, 'the right arrow accepts');
  assert.deepStrictEqual(lines(s.quill).slice(-1), [['character', 'EDWARD']]);
  assert.strictEqual(s.quill.getSelection().index, end + 7);
});

test('an empty cue offers the next speaker, and Enter takes the guess straight into the speech', function(){
  var s = boxQuill(elementsToDelta(parseFountain('INT. A - DAY\n\nANNA\nOne.\n\nBOB\nTwo.\n').elements));
  var end = s.quill.getLength() - 1;

  //Enter after the last speech opens an empty action line, and Tab turns that into the cue, which
  //offers the speakers.
  var enter = s.quill.keyboard.bindings[13].find(function(b){ return b.screenplayKey === 'enter'; });
  s.quill.setSelection(end, 0, 'user');
  enter.handler.call(s.quill.keyboard, { index: end, length: 0 }, {});
  assert.deepStrictEqual(lines(s.quill).slice(-1), [['action', '']]);
  var tab = s.quill.keyboard.bindings[9].find(function(b){ return b.screenplayKey === 'tab'; });
  s.quill.setSelection(end + 1, 0, 'user');
  tab.handler.call(s.quill.keyboard, { index: end + 1, length: 0 }, {});
  assert.deepStrictEqual(lines(s.quill).slice(-1), [['character', '']]);
  assert.strictEqual(s.box.isOpen(), true);
  assert.deepStrictEqual(shown(), ['ANNA', 'BOB'], 'ANNA spoke before BOB, so ANNA is the guess');

  //Enter takes the first entry with no arrowing, and goes on into the speech.
  assert.strictEqual(s.key(13, end + 1), false);
  assert.deepStrictEqual(lines(s.quill).slice(-2), [['character', 'ANNA'], ['dialogue', '']]);

  //Escape is the way past the guess: the cue is then empty with no list, and Enter makes it action.
  s = boxQuill(elementsToDelta(parseFountain('INT. A - DAY\n\nANNA\nOne.\n\nBOB\nTwo.\n').elements));
  enter = s.quill.keyboard.bindings[13].find(function(b){ return b.screenplayKey === 'enter'; });
  tab = s.quill.keyboard.bindings[9].find(function(b){ return b.screenplayKey === 'tab'; });
  s.quill.setSelection(end, 0, 'user');
  enter.handler.call(s.quill.keyboard, { index: end, length: 0 }, {});
  s.quill.setSelection(end + 1, 0, 'user');
  tab.handler.call(s.quill.keyboard, { index: end + 1, length: 0 }, {});
  assert.strictEqual(s.key(27, end + 1), false);
  assert.strictEqual(s.box.isOpen(), false);
  assert.strictEqual(s.key(13, end + 1), true, 'closed, Enter is handed on');
  enter.handler.call(s.quill.keyboard, { index: end + 1, length: 0 }, {});
  assert.deepStrictEqual(lines(s.quill).slice(-1), [['action', '']]);
});

test('accepting an intro fills the start of the heading and stays on the line', function(){
  var s = boxQuill(delta([['action', 'A room.']]));
  s.quill.setSelection(7, 0, 'user');
  insertElement(s.quill, 'scene');
  assert.strictEqual(s.box.isOpen(), true, 'a new heading offers the intros');
  assert.deepStrictEqual(shown(), ['INT.', 'EXT.', 'INT./EXT.', 'EST.']);

  s.type(8, 'e');
  assert.deepStrictEqual(shown(), ['EXT.', 'EST.']);
  assert.strictEqual(s.key(13, 9), false);
  assert.deepStrictEqual(lines(s.quill), [['action', 'A room.'], ['scene', 'EXT. ']], 'no new line');
  assert.strictEqual(s.quill.getSelection().index, 13);
});

test('the suggestion box closes on Escape and comes back on Escape, closes on moving off the line, in prose, and when switched off', function(){
  var s = boxQuill(elementsToDelta(parseFountain(CAST).elements));
  var end = s.quill.getLength() - 1;
  s.quill.insertText(end, '\n', 'user');
  s.quill.formatLine(end + 1, 1, 'element', 'character', 'user');
  s.type(end + 1, 'ED');
  assert.strictEqual(s.box.isOpen(), true);

  assert.strictEqual(s.key(27, end + 3), false);
  assert.strictEqual(s.box.isOpen(), false);
  assert.strictEqual(s.key(27, end + 3), false, 'Escape again brings it back');
  assert.strictEqual(s.box.isOpen(), true);
  s.key(27, end + 3);

  s.box.refresh();
  assert.strictEqual(s.box.isOpen(), true);
  s.quill.setSelection(0, 0, 'user');
  assert.strictEqual(s.box.isOpen(), false, 'the caret left the line');
  assert.strictEqual(s.key(27, 0), true, 'nothing to bring back here: Escape is not claimed');

  s.quill.setSelection(end + 3, 0, 'user');
  s.state.autocomplete = false;
  s.box.refresh();
  assert.strictEqual(s.box.isOpen(), false, 'switched off in Settings');
  s.state.autocomplete = true;

  s.state.mode = 'prose';
  s.box.refresh();
  assert.strictEqual(s.box.isOpen(), false);
});

const BIG_FISH = path.join(__dirname, '..', 'screenplay', 'Big-Fish.fountain');

test('Big Fish: the cast and the places', { skip: !fs.existsSync(BIG_FISH) && 'screenplay/Big-Fish.fountain is not present' }, function(){
  var d = elementsToDelta(parseFountain(fs.readFileSync(BIG_FISH, 'utf8')).elements);
  var names = characterNames(d);
  var places = locations(d);

  ['EDWARD', 'WILL', 'SANDRA', 'JOSEPHINE'].forEach(function(name){
    assert.ok(names.indexOf(name) !== -1, name + ' is in the cast');
  });
  assert.ok(names.indexOf('EDWARD (V.O.)') === -1, 'extensions are stripped');
  assert.ok(places.indexOf('WILL\'S BEDROOM') !== -1);
  assert.ok(places.indexOf('CAMPFIRE') !== -1);
  assert.ok(places.every(function(p){ return !/^INT|^EXT/.test(p); }), 'prefixes are stripped');
});

test('a script survives editor -> delta -> elements after the HTML load', function(){
  var quill = makeQuill();
  var parsed = parseFountain(SCRIPT);
  loadScreenplayDelta(quill, elementsToDelta(parsed.elements));

  assert.deepStrictEqual(deltaToElements(quill.getContents()), parsed.elements);
});

//docs/screenplay-plan.md, "Page count": the estimated page turns are drawn on the paragraphs that
//begin each page, as an attribute outside the content.
test('the estimated page turns mark the first paragraph of each page, outside the content', function(){
  var quill = makeQuill();
  var ops = [];
  for(var i = 0; i < 40; i++)
    ops.push({ insert: 'x' }, { insert: '\n' });
  loadScreenplayDelta(quill, { ops: ops });

  var before = quill.getContents().ops;
  var changes = 0;
  quill.on('text-change', function(){ changes++; });

  //The 28th of forty one-line actions is the first on page two - see fountain.test.js.
  markEstimatedPages(quill, true);
  var marked = quill.root.querySelectorAll('p[data-sp-page]');
  assert.strictEqual(marked.length, 1);
  assert.strictEqual(marked[0], quill.root.children[28]);
  assert.strictEqual(marked[0].getAttribute('data-sp-page'), '2');

  //The mark is not content: nothing changed, nothing to undo, nothing in the delta.
  quill.update();
  assert.strictEqual(changes, 0);
  assert.strictEqual(quill.history.stack.undo.length, 0);
  assert.deepStrictEqual(quill.getContents().ops, before);

  //A line typed above the turn moves the turn down one paragraph, and the old one is cleared.
  quill.insertText(0, 'a\n', 'user');
  markEstimatedPages(quill, true);
  marked = quill.root.querySelectorAll('p[data-sp-page]');
  assert.strictEqual(marked.length, 1);
  assert.strictEqual(marked[0], quill.root.children[28]);

  markEstimatedPages(quill, false);
  assert.strictEqual(quill.root.querySelectorAll('p[data-sp-page]').length, 0);
});


//---- Characters/Locations: the name lists a script is collected into ------------------------------
//docs/screenplay-plan.md, "Characters and locations". The dialog itself is
//test/screenplay-names_display.test.js; these are the parts it is made of.

const { nameCounts, mergeNames, namesList, renameName } = require('../src/components/controllers/screenplay-editor');

test('nameCounts says how many lines of the script each name is written into', function(){
  var d = elementsToDelta(parseFountain(CAST).elements);

  //EDWARD has two cues, one with an extension and one with (CONT'D); the lower-case "will" is not
  //a cue at all to Fountain, so it adds nothing to the one WILL has.
  assert.deepStrictEqual(nameCounts(d).characters, { EDWARD: 2, WILL: 1, SANDRA: 1 });
  //WILL'S BEDROOM twice - once with a time of day, once with a scene number after it.
  assert.deepStrictEqual(nameCounts(d).locations, { "WILL'S BEDROOM": 2, CAMPFIRE: 1 });
  assert.deepStrictEqual(nameCounts(null), { characters: {}, locations: {} });
});

test('mergeNames is the script\'s names, plus the project\'s added ones, minus the ones it removed', function(){
  assert.deepStrictEqual(mergeNames(['BOB'], ['anna ', 'BOB']), ['ANNA', 'BOB'], 'capitalised, trimmed, once each');
  assert.deepStrictEqual(mergeNames(['BOB'], null), ['BOB']);
  assert.deepStrictEqual(mergeNames([], ['']), []);

  //A removal takes a name out whether the script wrote it or the project added it, and is compared
  //in the same capitals everything else is.
  assert.deepStrictEqual(mergeNames(['BOB', 'ANNA'], null, ['bob']), ['ANNA']);
  assert.deepStrictEqual(mergeNames(['ANNA'], ['ZELDA'], ['ZELDA']), ['ANNA']);
  assert.deepStrictEqual(mergeNames(['ANNA'], null, ['NOBODY']), ['ANNA'], 'a removal for a name nothing offers costs nothing');
});

test('namesList reads a project\'s list whatever shape the .woolf actually held', function(){
  assert.deepStrictEqual(namesList({ characters: { added: ['A'], removed: ['B'] } }, 'characters'),
    { added: ['A'], removed: ['B'] });
  assert.deepStrictEqual(namesList(null, 'characters'), { added: [], removed: [] });
  assert.deepStrictEqual(namesList({}, 'locations'), { added: [], removed: [] });
  assert.deepStrictEqual(namesList({ characters: 'ZELDA' }, 'characters'), { added: [], removed: [] });
  assert.deepStrictEqual(namesList({ characters: { added: 'ZELDA' } }, 'characters'), { added: [], removed: [] });
});

test('a cue and a heading complete from the names added to the project as well as the script\'s', function(){
  var d = elementsToDelta(parseFountain(CAST).elements);
  var names = { characters: { added: ['ZELDA'] }, locations: { added: ['ZOO'] } };

  assert.deepStrictEqual(suggestionsFor(d, 'character', 'z', 0, names).suggestions, ['ZELDA']);
  assert.strictEqual(suggestionsFor(d, 'character', 'z', 0, null), null, 'without the added list there is no such name');
  assert.deepStrictEqual(suggestionsFor(d, 'scene', 'INT. z', 0, names).suggestions, ['ZOO']);

  //An empty cue guesses the next speaker, and someone who has never spoken cannot be the guess -
  //so an added name comes last, after every speaker the script has.
  var speakers = suggestionsFor(d, 'character', '', 0, names).suggestions;
  assert.strictEqual(speakers[speakers.length - 1], 'ZELDA');
});

//The one the dialog exists for: a name the script uses, taken out of the list without the script
//losing a word of it - docs/screenplay-plan.md, "Characters and locations".
test('a name the project has removed is offered from nowhere, though the script still writes it', function(){
  var d = elementsToDelta(parseFountain('INT. A - DAY\n\nDAN\nOne line only.\n\nDANIELLE\nAll the rest.\n\nEXT. DANCE HALL - NIGHT\n\nDANIELLE\nMore.\n').elements);
  var names = { characters: { removed: ['DAN'] }, locations: { removed: ['A'] } };

  //Typing towards DANIELLE is no longer met with DAN first.
  assert.deepStrictEqual(suggestionsFor(d, 'character', 'DAN', 0, names).suggestions, ['DANIELLE']);
  assert.deepStrictEqual(suggestionsFor(d, 'scene', 'INT. ', 0, names).suggestions, ['DANCE HALL']);

  //Nor on an empty cue, where he would otherwise be the guess: DAN spoke before DANIELLE last did.
  var end = 0;
  d.ops.forEach(function(op){ end += typeof op.insert === 'string' ? op.insert.length : 1; });
  assert.deepStrictEqual(speakersFor(d, end, names.characters), ['DANIELLE']);

  //And the script is untouched - the count is what it always was.
  assert.deepStrictEqual(nameCounts(d).characters, { DAN: 1, DANIELLE: 2 });
});

//What renameName rewrote, as the lines of the script with their element types.
function linesOf(ops){
  var lines = [];
  var text = '';
  ops.forEach(function(op){
    if(typeof op.insert !== 'string')
      return;
    op.insert.split('\n').forEach(function(part, i, parts){
      text += part;
      if(i < parts.length - 1){
        lines.push(text);
        text = '';
      }
    });
  });
  return lines;
}

test('renameName rewrites every cue for a character and leaves the rest of the line alone', function(){
  var d = elementsToDelta(parseFountain(CAST).elements);
  var renamed = renameName(d, 'character', 'edward', 'ed hyde');

  assert.strictEqual(renamed.count, 2);
  var lines = linesOf(renamed.ops);
  assert.ok(lines.indexOf('ED HYDE (V.O.)') > -1, 'the extension stays where it is');
  assert.ok(lines.indexOf("ED HYDE (CONT'D)") > -1);
  assert.ok(lines.indexOf('One.') > -1, 'the speech is untouched');
  assert.deepStrictEqual(nameCounts({ ops: renamed.ops }).characters, { 'ED HYDE': 2, WILL: 1, SANDRA: 1 });
});

test('renameName rewrites the place in every heading and leaves the prefix, the time and the number', function(){
  var d = elementsToDelta(parseFountain(CAST).elements);
  var renamed = renameName(d, 'location', "will's bedroom", 'the attic');

  assert.strictEqual(renamed.count, 2);
  var lines = linesOf(renamed.ops);
  assert.ok(lines.indexOf('INT. THE ATTIC - NIGHT (1973)') > -1);
  assert.ok(lines.indexOf('INT. THE ATTIC - DAY #4#') > -1);
  assert.ok(lines.indexOf('EXT. CAMPFIRE - NIGHT') > -1, 'the other place is untouched');
});

test('renaming a cue keeps what the line is, dual marker and all, and can merge two characters', function(){
  var d = elementsToDelta(parseFountain(CAST).elements);

  //SANDRA's cue is marked dual, which is a line attribute rather than the "^" the writer typed, so
  //renaming the name has to leave the attribute on the line it renamed.
  var dual = renameName(d, 'character', 'SANDRA', 'JOSEPHINE').ops.filter(function(op){
    return op.attributes && op.attributes.dual;
  });
  assert.deepStrictEqual(dual, [{ insert: '\n', attributes: { element: 'character', dual: true } }]);

  //Two characters made one: SANDRA's cue now reads WILL, and the list has one name where it had two.
  var merged = renameName(d, 'character', 'SANDRA', 'WILL');
  assert.deepStrictEqual(nameCounts({ ops: merged.ops }).characters, { EDWARD: 2, WILL: 2 });
});

test('renameName answers null when there is nothing to rename', function(){
  var d = elementsToDelta(parseFountain(CAST).elements);

  assert.strictEqual(renameName(d, 'character', 'NOBODY', 'SOMEBODY'), null);
  assert.strictEqual(renameName(d, 'character', 'EDWARD', ''), null, 'a name cannot be renamed to nothing');
  assert.strictEqual(renameName(d, 'character', '', 'EDWARD'), null);
  assert.strictEqual(renameName(d, 'character', 'EDWARD', 'edward'), null, 'the same name in lower case is the same name');

  //A place is read out of headings and nowhere else, so a character's name is not one.
  assert.strictEqual(renameName(d, 'location', 'EDWARD', 'ED'), null);
});

//A character's name is not only in his cues - docs/screenplay-plan.md, "Characters and locations".
const DAN = 'INT. DAN\'S BEDROOM - NIGHT\n\nDAN\nI am Dan.\n\nDANIELLE\nAnd I am not.\n\nDAN crosses to the window. Danielle watches dan go, and the dandelions with him.\n\n> DAN OUT.\n';

test('renaming a character rewrites the name everywhere it is written with a capital', function(){
  var renamed = renameName(elementsToDelta(parseFountain(DAN).elements), 'character', 'DAN', 'Ben');
  var lines = linesOf(renamed.ops);

  //His own cue, in the capitals a cue is written in.
  assert.ok(lines.indexOf('DAN') === -1, 'the cue is gone');
  assert.ok(lines.indexOf('BEN') > -1);

  //The heading his bedroom is in, and the action and transition that name him - each in the case
  //it was written in.
  assert.ok(lines.indexOf("INT. BEN'S BEDROOM - NIGHT") > -1, 'a possessive in a heading');
  assert.ok(lines.indexOf('BEN crosses to the window. Danielle watches dan go, and the dandelions with him.') > -1);
  assert.ok(lines.indexOf('BEN OUT.') > -1, 'a transition');

  //Dialogue, where the name is written as an ordinary capitalised word.
  assert.ok(lines.indexOf('I am Ben.') > -1);

  assert.deepStrictEqual([renamed.nameLines, renamed.otherLines], [1, 4]);
});

test('a lower-case spelling is left alone outside a cue, and a longer word is never part of a name', function(){
  var renamed = renameName(elementsToDelta(parseFountain(DAN).elements), 'character', 'DAN', 'BEN');
  var action = linesOf(renamed.ops).filter(function(line){ return line.indexOf('crosses') > -1; })[0];

  //"dan" is also a word, so it stays; DANIELLE and "dandelions" are longer words, not the name.
  assert.strictEqual(action, 'BEN crosses to the window. Danielle watches dan go, and the dandelions with him.');
  assert.ok(linesOf(renamed.ops).indexOf('DANIELLE') > -1, 'the other cue is untouched');
});

test('renaming a character takes the case of each line it rewrites, not the case it was typed in', function(){
  var script = 'INT. A - DAY\n\nBOB\nHello.\n\nBOB waves. Bob waves again. bob does not.\n';
  var lines = linesOf(renameName(elementsToDelta(parseFountain(script).elements), 'character', 'bob', 'mcclane').ops);

  assert.ok(lines.indexOf('MCCLANE') > -1, 'the cue takes the capitals a cue is written in');
  assert.strictEqual(lines.filter(function(line){ return line.indexOf('waves') > -1; })[0],
    'MCCLANE waves. Mcclane waves again. bob does not.');
});

test('a place is renamed in its headings and nowhere else', function(){
  var script = 'INT. THE CAR - DAY\n\nBOB\nGet in the car.\n\nThe Car is where they are. THE CAR is filthy.\n';
  var renamed = renameName(elementsToDelta(parseFountain(script).elements), 'location', 'THE CAR', 'THE VAN');
  var lines = linesOf(renamed.ops);

  assert.deepStrictEqual([renamed.nameLines, renamed.otherLines], [1, 0]);
  assert.ok(lines.indexOf('INT. THE VAN - DAY') > -1);
  assert.ok(lines.indexOf('The Car is where they are. THE CAR is filthy.') > -1, 'the action is left as it stands');
  assert.ok(lines.indexOf('Get in the car.') > -1);
});

//The one thing the rules cannot settle: a capital at the start of a sentence belongs to the
//sentence as much as to a name, so a word spelled like the name is rewritten there too. Not fixed
//but declared - the dialog says so, and Ctrl+Z takes the rename back. docs/screenplay-plan.md,
//"Renaming".
test('a word spelled like the name is rewritten where a sentence begins with it', function(){
  var script = 'INT. A - DAY\n\nWILL\nHello.\n\nWill you come? Edward asks Will again. WILL waits.\n\nSandra will not hear of it.\n';
  var lines = linesOf(renameName(elementsToDelta(parseFountain(script).elements), 'character', 'WILL', 'DANIEL').ops);

  //"Will you come?" is not him, and there is no rule that knows it.
  assert.ok(lines.indexOf('Daniel you come? Edward asks Daniel again. DANIEL waits.') > -1);
  //The lower-case rule still holds, which is what keeps this to the start of a sentence.
  assert.ok(lines.indexOf('Sandra will not hear of it.') > -1);
});

test('renameName counts the cues and the other lines separately, for the warning to report', function(){
  var script = 'INT. DAN\'S BEDROOM - NIGHT\n\nDAN\nI am Dan.\n\nDAN crosses the room.\n\nNobody else is here.\n';
  var renamed = renameName(elementsToDelta(parseFountain(script).elements), 'character', 'DAN', 'BEN');

  assert.deepStrictEqual([renamed.nameLines, renamed.otherLines, renamed.count], [1, 3, 4]);
});


test('renaming a cue keeps the inline formats of the rest of its line', function(){
  var renamed = renameName({ ops: [
    { insert: 'BOB', attributes: { italic: true } },
    { insert: ' (V.O.)' },
    { insert: '\n', attributes: { element: 'character' } },
    { insert: 'Hi.\n' }
  ] }, 'character', 'BOB', 'ROB');

  assert.deepStrictEqual(renamed.ops.slice(0, 3), [
    { insert: 'ROB', attributes: { italic: true } },
    { insert: ' (V.O.)' },
    { insert: '\n', attributes: { element: 'character' } }
  ]);
});
