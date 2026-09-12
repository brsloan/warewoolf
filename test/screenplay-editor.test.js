require('./quill-dom-setup');
const test = require('node:test');
const assert = require('node:assert');
const Quill = require('quill');

const { registerScreenplayFormats, SCREENPLAY_FORMATS } = require('../src/components/blots/screenplay');
const { loadScreenplayDelta, deltaToScreenplayHtml } = require('../src/components/controllers/screenplay-editor');
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
    ['dialogue', 'Hi.', 'character'],
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

test('Enter at the start of a line pushes it down under a new action line, and mid-line splits it', function(){
  var s = scriptQuill(delta([['character', 'BOB', { dual: true }]]));
  var enter = screenplayEnterBinding(s.quill, function(){ return 'screenplay'; });

  press(s.quill, enter, 0);
  assert.deepStrictEqual(lines(s.quill), [['action', ''], ['character', 'BOB', 'dual']]);
  assert.strictEqual(s.quill.getSelection().index, 1, 'the caret stays with the cue');

  press(s.quill, enter, 3);
  assert.deepStrictEqual(lines(s.quill), [['action', ''], ['character', 'BO', 'dual'], ['character', 'B']], 'the second half is a cue without the mark');
  assert.strictEqual(s.quill.getSelection().index, 4);
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

  s = scriptQuill(delta([['scene', 'INT. A']]));
  press(s.quill, tab(s), 2);
  assert.deepStrictEqual(lines(s.quill), [['scene', 'INT. A']], 'a heading with text is left alone');

  s = scriptQuill(delta([['action', 'bob']]));
  press(s.quill, tab(s), 1);
  assert.deepStrictEqual(lines(s.quill), [['character', 'BOB']]);

  s = scriptQuill(delta([['character', 'BOB']]));
  press(s.quill, tab(s), 1);
  assert.deepStrictEqual(lines(s.quill), [['character', 'BOB'], ['parenthetical', '()']]);
  assert.strictEqual(s.quill.getSelection().index, 5, 'the caret sits between the parentheses');

  s = scriptQuill(delta([['dialogue', 'Hi.'], ['action', 'Later.']]));
  press(s.quill, tab(s), 0);
  assert.deepStrictEqual(lines(s.quill), [['dialogue', 'Hi.'], ['parenthetical', '()'], ['action', 'Later.']], 'opened after the whole line, wherever the caret was');

  s = scriptQuill(delta([['parenthetical', '(low)']]));
  press(s.quill, tab(s), 5);
  assert.deepStrictEqual(lines(s.quill), [['parenthetical', '(low)'], ['dialogue', '']]);

  s = scriptQuill(delta([['transition', 'cut to:']]));
  press(s.quill, tab(s), 0);
  assert.deepStrictEqual(lines(s.quill), [['scene', 'CUT TO:']]);

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

test('the element shortcuts drive setElement on a real editor', function(){
  var s = scriptQuill(delta([['action', 'bob']]));
  applyQuillShortcuts(s.quill, resolveShortcuts(null), 'screenplay');

  //Ctrl+3 is elementCharacter; Quill keys its bindings by keyCode, and '3' is 51.
  var binding = s.quill.keyboard.bindings[51].find(function(b){ return b.warewoolfAction === 'elementCharacter'; });
  assert.ok(binding, 'bound');
  assert.ok(!s.quill.keyboard.bindings[51].some(function(b){ return b.warewoolfAction === 'formatHeading3'; }), 'and the prose heading is not');

  s.quill.setSelection(1, 0);
  binding.handler.call(s.quill.keyboard, { index: 1, length: 0 }, {});
  assert.deepStrictEqual(lines(s.quill), [['character', 'BOB']]);
});

//---- Phase 5: scenes -----------------------------------------------------------------------------

const { sceneIndex, sceneAt, previousSceneStart, nextSceneStart, moveScene } = require('../src/components/controllers/screenplay-editor');

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

//---- Phase 6: autocomplete -----------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { characterNames, locations, suggestionsFor, attachAutocomplete } = require('../src/components/controllers/screenplay-editor');

const CAST = 'INT. WILL\'S BEDROOM - NIGHT (1973)\n\nEDWARD (V.O.)\nOne.\n\nWILL\nTwo.\n\nEDWARD (CONT\'D)\nThree.\n\nEXT. CAMPFIRE - NIGHT\n\nSANDRA ^\nFour.\n\nINT. WILL\'S BEDROOM - DAY #4#\n\nwill\nFive.\n';

test('characterNames and locations come from the cues and headings, stripped, in capitals, once each', function(){
  var d = elementsToDelta(parseFountain(CAST).elements);
  assert.deepStrictEqual(characterNames(d), ['EDWARD', 'SANDRA', 'WILL']);
  assert.deepStrictEqual(locations(d), ['CAMPFIRE', 'WILL\'S BEDROOM']);
  assert.deepStrictEqual(characterNames(null), []);
});

test('suggestionsFor offers names a cue is the start of and places a heading is, after two characters', function(){
  var d = elementsToDelta(parseFountain(CAST).elements);

  assert.deepStrictEqual(suggestionsFor(d, 'character', 'ed'), { typed: 'ED', prefix: '', suggestions: ['EDWARD'] });
  assert.strictEqual(suggestionsFor(d, 'character', 'e'), null, 'one character is too few');
  assert.strictEqual(suggestionsFor(d, 'character', 'EDWARD'), null, 'already typed in full');
  assert.strictEqual(suggestionsFor(d, 'character', 'zz'), null);

  assert.deepStrictEqual(suggestionsFor(d, 'scene', 'INT. wi'), { typed: 'WI', prefix: 'INT. ', suggestions: ['WILL\'S BEDROOM'] });
  assert.deepStrictEqual(suggestionsFor(d, 'scene', 'ext. ca'), { typed: 'CA', prefix: 'ext. ', suggestions: ['CAMPFIRE'] });
  assert.strictEqual(suggestionsFor(d, 'scene', 'wi'), null, 'no prefix yet');
  assert.strictEqual(suggestionsFor(d, 'dialogue', 'ed'), null);
});

test('the suggestion box opens under a cue being typed, moves with the arrows, and accepts with Enter', function(){
  var s = scriptQuill(elementsToDelta(parseFountain(CAST).elements));
  var box = attachAutocomplete(s.quill, function(){ return s.state.mode; });
  var end = s.quill.getLength() - 1;

  //A new cue at the end of the script.
  s.quill.insertText(end, '\n', 'user');
  s.quill.formatLine(end + 1, 1, 'element', 'character', 'user');
  s.quill.setSelection(end + 1, 0, 'user');
  s.quill.insertText(end + 1, 'S', 'user');
  assert.strictEqual(box.isOpen(), false, 'one character is too few');

  s.quill.setSelection(end + 2, 0, 'user');
  s.quill.insertText(end + 2, 'A', 'user');
  assert.strictEqual(box.isOpen(), true);
  assert.deepStrictEqual(Array.from(document.querySelectorAll('.suggestion')).map(function(el){ return el.textContent; }), ['SANDRA']);

  s.quill.setSelection(end + 3, 0, 'user');
  var enter = s.quill.keyboard.bindings[13][0];
  assert.strictEqual(enter.handler.call(s.quill.keyboard, { index: end + 3, length: 0 }, {}), false, 'Enter is claimed while the box is open');
  assert.strictEqual(box.isOpen(), false);
  assert.strictEqual(s.quill.getText(end + 1, 6), 'SANDRA');
  assert.strictEqual(s.quill.getSelection().index, end + 7, 'the caret lands at the end of the name');

  //Closed, Enter falls through to the screenplay binding beneath it.
  assert.strictEqual(enter.handler.call(s.quill.keyboard, { index: end + 7, length: 0 }, {}), true);
});

test('the suggestion box closes on Escape, on moving off the line, and while the editor shows prose', function(){
  var s = scriptQuill(elementsToDelta(parseFountain(CAST).elements));
  var box = attachAutocomplete(s.quill, function(){ return s.state.mode; });
  var end = s.quill.getLength() - 1;
  s.quill.insertText(end, '\n', 'user');
  s.quill.formatLine(end + 1, 1, 'element', 'character', 'user');
  s.quill.setSelection(end + 1, 0, 'user');
  s.quill.insertText(end + 1, 'ED', 'user');
  s.quill.setSelection(end + 3, 0, 'user');
  assert.strictEqual(box.isOpen(), true);

  var escape = s.quill.keyboard.bindings[27][0];
  assert.strictEqual(escape.handler.call(s.quill.keyboard, { index: end + 3, length: 0 }, {}), false);
  assert.strictEqual(box.isOpen(), false);
  assert.strictEqual(escape.handler.call(s.quill.keyboard, { index: end + 3, length: 0 }, {}), true, 'closed, Escape is not claimed');

  box.refresh();
  assert.strictEqual(box.isOpen(), true);
  s.quill.setSelection(0, 0, 'user');
  assert.strictEqual(box.isOpen(), false, 'the caret left the line');

  s.state.mode = 'prose';
  s.quill.setSelection(end + 3, 0, 'user');
  box.refresh();
  assert.strictEqual(box.isOpen(), false);
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
