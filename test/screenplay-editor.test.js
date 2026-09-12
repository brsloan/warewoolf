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

test('a script survives editor -> delta -> elements after the HTML load', function(){
  var quill = makeQuill();
  var parsed = parseFountain(SCRIPT);
  loadScreenplayDelta(quill, elementsToDelta(parsed.elements));

  assert.deepStrictEqual(deltaToElements(quill.getContents()), parsed.elements);
});
