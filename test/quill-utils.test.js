const test = require('node:test');
const assert = require('node:assert');

const { getOrderedListNumbers, getListMarker, parseDelta, generateChapTitleFromFirstLine, addBindingsToQuill, goPageDown } = require('../src/components/controllers/quill-utils');

//getOrderedListNumbers works on the paragraph shape parseDelta produces. Building them by hand here
//keeps these tests on the numbering rule itself rather than on delta parsing.
function para(attributes){
  return attributes ? { textRuns: [{text: 'x'}], attributes: attributes } : { textRuns: [{text: 'x'}] };
}

const ordered = { list: 'ordered' };

test('a flat numbered list counts up from one', function(){
  assert.deepStrictEqual(
    getOrderedListNumbers([para(ordered), para(ordered), para(ordered)]),
    [1, 2, 3]
  );
});

test('paragraphs that are not numbered list items get zero', function(){
  assert.deepStrictEqual(
    getOrderedListNumbers([para(), para({list: 'bullet'}), para({header: 1})]),
    [0, 0, 0]
  );
});

test('a numbered list restarts after any paragraph that breaks it', function(){
  assert.deepStrictEqual(
    getOrderedListNumbers([para(ordered), para(ordered), para(), para(ordered)]),
    [1, 2, 0, 1]
  );
  assert.deepStrictEqual(
    getOrderedListNumbers([para(ordered), para({list: 'bullet'}), para(ordered)]),
    [1, 0, 1]
  );
});

test('each nesting level counts independently', function(){
  assert.deepStrictEqual(
    getOrderedListNumbers([
      para(ordered),
      para({list: 'ordered', indent: 1}),
      para({list: 'ordered', indent: 1}),
      para(ordered)
    ]),
    [1, 1, 2, 2]
  );
});

test('a level resumes its own count after dropping back out and in', function(){
  assert.deepStrictEqual(
    getOrderedListNumbers([
      para(ordered),
      para({list: 'ordered', indent: 1}),
      para(ordered),
      para({list: 'ordered', indent: 1})
    ]),
    [1, 1, 2, 2]
  );
});

test('nesting deeper than three levels is folded into the third', function(){
  assert.deepStrictEqual(
    getOrderedListNumbers([
      para({list: 'ordered', indent: 2}),
      para({list: 'ordered', indent: 3}),
      para({list: 'ordered', indent: 9})
    ]),
    [1, 2, 3]
  );
});

test('an empty paragraph list produces no numbers', function(){
  assert.deepStrictEqual(getOrderedListNumbers([]), []);
});

test('getListMarker renders bullets and numbers at each level', function(){
  assert.strictEqual(getListMarker({list: 'bullet'}), '* ');
  assert.strictEqual(getListMarker({list: 'bullet', indent: 1}), '\t* ');
  assert.strictEqual(getListMarker({list: 'bullet', indent: 2}), '\t\t* ');
  assert.strictEqual(getListMarker({list: 'ordered'}, 1), '1. ');
  assert.strictEqual(getListMarker({list: 'ordered', indent: 1}, 4), '\t4. ');
  assert.strictEqual(getListMarker({list: 'ordered', indent: 2}, 2), '\t\t2. ');
});

test('getListMarker returns nothing for anything that is not a list item', function(){
  assert.strictEqual(getListMarker(null), '');
  assert.strictEqual(getListMarker(undefined), '');
  assert.strictEqual(getListMarker({}), '');
  assert.strictEqual(getListMarker({header: 1}), '');
  assert.strictEqual(getListMarker({blockquote: true}), '');
});

test('parseDelta gives each real paragraph a single run holding its text', function(){
  var parsed = parseDelta({ ops: [{ insert: 'Hello\n\nWorld\n' }] });

  assert.deepStrictEqual(parsed.paragraphs, [
    { textRuns: [{ text: 'Hello' }] },
    { textRuns: [{ text: '' }] },
    { textRuns: [{ text: 'World' }] }
  ]);
});

test('parseDelta preserves per-run attributes and paragraph (line) attributes', function(){
  var parsed = parseDelta({
    ops: [
      { insert: 'Bold', attributes: { bold: true } },
      { insert: 'Plain' },
      { insert: '\n', attributes: { header: 1 } }
    ]
  });

  assert.deepStrictEqual(parsed.paragraphs, [
    {
      textRuns: [
        { text: 'Bold', attributes: { bold: true } },
        { text: 'Plain' }
      ],
      attributes: { header: 1 }
    }
  ]);
});

test('parseDelta on an empty delta produces no paragraphs', function(){
  assert.deepStrictEqual(parseDelta({ ops: [] }), { paragraphs: [] });
});

test('generateChapTitleFromFirstLine takes the first line of the first insert', function(){
  assert.strictEqual(
    generateChapTitleFromFirstLine({ ops: [{ insert: 'Chapter One\nSome body text\n' }] }),
    'Chapter One'
  );
});

test('generateChapTitleFromFirstLine returns an empty string instead of throwing on an empty delta', function(){
  assert.strictEqual(generateChapTitleFromFirstLine({ ops: [] }), '');
});

test('generateChapTitleFromFirstLine returns an empty string when the first insert is not text', function(){
  assert.strictEqual(
    generateChapTitleFromFirstLine({ ops: [{ insert: { image: 'foo.png' } }] }),
    ''
  );
});

//---------------------------------------------------------------------------
// addBindingsToQuill
//---------------------------------------------------------------------------

//addBindingsToQuill only ever calls q.keyboard.addBinding(), q.getFormat() and q.format(), so a
//recording stand-in exercises the bindings without a real editor or a DOM. Quill invokes a binding
//handler with `this` bound to a context carrying the instance, which is why some of the handlers
//reach for this.quill and others close over q directly - fire() supplies both.
function recordingQuill(currentFormat){
  var q = {
    bindings: [],
    formatCalls: [],
    keyboard: {
      addBinding: function(binding){ q.bindings.push(binding); }
    },
    getFormat: function(){ return currentFormat || {}; },
    format: function(name, value, source){ q.formatCalls.push([name, value, source]); }
  };

  addBindingsToQuill(q);

  q.find = function(key, modifiers){
    modifiers = modifiers || {};
    return q.bindings.find(function(b){
      return b.key === key && Boolean(b.shiftKey) === Boolean(modifiers.shiftKey);
    });
  };
  q.fire = function(key, modifiers){
    q.find(key, modifiers).handler.call({ quill: q }, { index: 0, length: 0 }, {});
  };

  return q;
}

test('every formatting shortcut is bound with the platform modifier key held', function(){
  var q = recordingQuill();

  assert.deepStrictEqual(
    q.bindings.map(function(b){ return b.key; }).sort(),
    ['0', '1', '2', '3', '4', 'E', 'J', 'L', 'R', 'T', 'b', 'k']
  );
  assert.ok(q.bindings.every(function(b){ return b.shortKey === true; }));
});

test('the title shortcut centres the line and makes it a level one heading', function(){
  var q = recordingQuill();

  q.fire('T');

  assert.deepStrictEqual(q.formatCalls, [
    ['align', 'center', 'user'],
    ['header', 1, 'user']
  ]);
});

test('each number key sets its own heading level, and zero clears it', function(){
  ['1', '2', '3', '4'].forEach(function(key){
    var q = recordingQuill();
    q.fire(key);
    assert.deepStrictEqual(q.formatCalls, [['header', parseInt(key), 'user']]);
  });

  var cleared = recordingQuill();
  cleared.fire('0');
  assert.deepStrictEqual(cleared.formatCalls, [['header', null, 'user']]);
});

test('the four alignment shortcuts each set their own alignment', function(){
  var expected = { L: null, E: 'center', R: 'right', J: 'justify' };

  Object.keys(expected).forEach(function(key){
    var q = recordingQuill();
    q.fire(key);
    assert.deepStrictEqual(q.formatCalls, [['align', expected[key], 'user']], key + ' should set align ' + expected[key]);
  });
});

test('the strikethrough shortcut toggles against the current format', function(){
  var off = recordingQuill({});
  off.fire('k');
  assert.deepStrictEqual(off.formatCalls, [['strike', true, 'user']]);

  var on = recordingQuill({ strike: true });
  on.fire('k');
  assert.deepStrictEqual(on.formatCalls, [['strike', false, 'user']]);
});

test('the list shortcut cycles bullet, then numbered, then off', function(){
  var none = recordingQuill({});
  none.fire('b', { shiftKey: true });
  assert.deepStrictEqual(none.formatCalls, [['list', 'bullet', 'user']]);

  var bullet = recordingQuill({ list: 'bullet' });
  bullet.fire('b', { shiftKey: true });
  assert.deepStrictEqual(bullet.formatCalls, [['list', 'ordered', 'user']]);

  var ordered = recordingQuill({ list: 'ordered' });
  ordered.fire('b', { shiftKey: true });
  assert.deepStrictEqual(ordered.formatCalls, [['list', null, 'user']]);
});

//---------------------------------------------------------------------------
// goPageDown
//---------------------------------------------------------------------------

//A fully synthetic stand-in for the pieces goPageDown actually touches, rather than a real Quill
//instance - real layout metrics (clientHeight, getBoundingClientRect) are always zero under jsdom
//since it has no layout engine, which would leave every geometric branch below untestable.
function stubQuill(opts){
  opts = opts || {};
  var selection = { index: opts.selectionIndex || 0, length: 0 };
  var boundsByIndex = opts.boundsByIndex || {};

  return {
    getSelection: function(){ return selection; },
    setSelection: function(index){ selection = { index: index, length: 0 }; },
    root: { scrollTop: opts.scrollTop || 0, clientHeight: opts.clientHeight || 100 },
    container: { getBoundingClientRect: function(){ return { top: opts.containerTop || 0 }; } },
    selection: {
      //Real Quill returns a viewport-relative DOMRect for a found position, or null once the
      //lookup runs past the end of the content - boundsByIndex models both with plain objects.
      getBounds: function(index){ return boundsByIndex[index] || null; }
    }
  };
}

test('goPageDown does nothing when there is no selection', function(){
  var q = stubQuill();
  q.getSelection = function(){ return null; };

  assert.doesNotThrow(function(){ goPageDown(q); });
});

test('goPageDown stops at the end of the content, landing one position before it', function(){
  //boundsByIndex has no entry for index 1, so the very first lookup already returns null.
  var q = stubQuill({ selectionIndex: 0 });

  goPageDown(q);

  assert.deepStrictEqual(q.getSelection(), { index: 0, length: 0 });
});

test('goPageDown converts viewport-relative bounds to container-relative before comparing against clientHeight', function(){
  //Editor sits 200px down the viewport; a candidate position at viewport y=250 is therefore only
  //50px into the editor's own content, not past a 100px-tall viewport as the raw viewport
  //coordinate would suggest.
  var q = stubQuill({
    selectionIndex: 0,
    containerTop: 200,
    clientHeight: 100,
    boundsByIndex: { 1: { top: 250, height: 20 } }
  });

  goPageDown(q);

  //Not yet past the bottom (container-relative top 50 < clientHeight 100), so the loop keeps
  //walking forward and (nothing at index 2) lands one short of it.
  assert.deepStrictEqual(q.getSelection(), { index: 1, length: 0 });
});

test('goPageDown selects the first position that reaches the bottom of the editor and scrolls by its container-relative offset', function(){
  var q = stubQuill({
    selectionIndex: 0,
    scrollTop: 0,
    containerTop: 200,
    clientHeight: 100,
    //Container-relative top: 320-200=120 >= 100, so this is the landing position.
    boundsByIndex: { 1: { top: 320, height: 20 } }
  });

  goPageDown(q);

  assert.deepStrictEqual(q.getSelection(), { index: 1, length: 0 });
  assert.strictEqual(q.root.scrollTop, 100, '0 (starting scrollTop) + 120 (container-relative top) - 20 (height)');
});
