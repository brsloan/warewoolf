const test = require('node:test');
const assert = require('node:assert');

const { getOrderedListNumbers, getListMarker, parseDelta, generateChapTitleFromFirstLine } = require('../src/components/controllers/quill-utils');

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
