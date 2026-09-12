require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');

const { parseDelta } = require('../src/components/controllers/quill-utils');
const { registerFootnoteBlots } = require('../src/components/blots/footnotes');
const { markSceneBreaks } = require('../src/components/controllers/mark-scene-breaks');

//markSceneBreaks reads the chapter back through a temp Quill, so the app's own blots have to be
//registered for a footnote marker to survive that round trip - render.js does this at startup, well
//before any compile or export can run.
registerFootnoteBlots();

//One argument per line, the same shape tab-indent-paragraphs.test.js uses. A bare string is an
//ordinary paragraph and '' is a blank line; head/item/quote/note wrap a line in the attributes that
//make it a heading, a list item, a block quotation or a footnote body.
function delta(){
  var ops = [];

  Array.prototype.forEach.call(arguments, function(line){
    var spec = typeof line == 'string' ? { text: line } : line;

    if(spec.text !== '')
      ops.push({ insert: spec.text });

    ops.push(spec.attributes ? { insert: '\n', attributes: spec.attributes } : { insert: '\n' });
  });

  return { ops: ops };
}

function head(text){ return { text: text, attributes: { header: 1 } }; }
function item(text){ return { text: text, attributes: { list: 'bullet' } }; }
function quote(text){ return { text: text, attributes: { blockquote: true } }; }
function note(n, text){ return { text: text, attributes: { footnoteBody: String(n) } }; }

//The result as one { text, align } per line, which is the whole of what these tests are about.
function lines(delt){
  return parseDelta(delt).paragraphs.map(function(para){
    return {
      text: para.textRuns.map(function(run){ return typeof run.text == 'string' ? run.text : ''; }).join(''),
      align: para.attributes && para.attributes.align ? para.attributes.align : null
    };
  });
}

function plain(text){ return { text: text, align: null }; }
const MARK = { text: '#', align: 'center' };

//---- what gets marked ----

test('markSceneBreaks writes a centered # on a blank line between two paragraphs', function(){
  var result = markSceneBreaks(delta('one', '', 'two'));
  assert.deepStrictEqual(lines(result), [ plain('one'), MARK, plain('two') ]);
});

test('markSceneBreaks marks every blank line of a longer gap', function(){
  var result = markSceneBreaks(delta('one', '', '', 'two'));
  assert.deepStrictEqual(lines(result), [ plain('one'), MARK, MARK, plain('two') ]);
});

test('markSceneBreaks marks every gap in a chapter, not just the first', function(){
  var result = markSceneBreaks(delta('one', '', 'two', '', 'three'));
  assert.deepStrictEqual(lines(result), [ plain('one'), MARK, plain('two'), MARK, plain('three') ]);
});

test('markSceneBreaks leaves a chapter with no blank lines exactly as it was', function(){
  var result = markSceneBreaks(delta('one', 'two'));
  assert.deepStrictEqual(lines(result), [ plain('one'), plain('two') ]);
});

test('markSceneBreaks centers the mark without centering the paragraphs around it', function(){
  var result = lines(markSceneBreaks(delta('one', '', 'two')));
  assert.strictEqual(result[0].align, null);
  assert.strictEqual(result[2].align, null);
});

//---- what does not ----

test('markSceneBreaks does not mark the blank line under a heading', function(){
  var result = markSceneBreaks(delta(head('Chapter One'), '', 'one'));
  assert.deepStrictEqual(lines(result), [ plain('Chapter One'), plain(''), plain('one') ]);
});

test('markSceneBreaks does not mark the blank line above a heading', function(){
  var result = markSceneBreaks(delta('one', '', head('Chapter Two')));
  assert.deepStrictEqual(lines(result), [ plain('one'), plain(''), plain('Chapter Two') ]);
});

test('markSceneBreaks does not mark the stray blank lines at the end of a chapter', function(){
  var result = markSceneBreaks(delta('one', '', 'two', '', ''));
  assert.deepStrictEqual(lines(result), [ plain('one'), MARK, plain('two'), plain(''), plain('') ]);
});

test('markSceneBreaks does not mark a blank line at the very start of a chapter', function(){
  var result = markSceneBreaks(delta('', 'one'));
  assert.deepStrictEqual(lines(result), [ plain(''), plain('one') ]);
});

test('markSceneBreaks does not mark the blank lines around a block quotation', function(){
  var result = markSceneBreaks(delta('one', '', quote('quoted'), '', 'two'));
  assert.deepStrictEqual(lines(result), [ plain('one'), plain(''), plain('quoted'), plain(''), plain('two') ]);
});

test('markSceneBreaks does not mark the blank lines around a list', function(){
  var result = markSceneBreaks(delta('one', '', item('an item'), '', 'two'));
  assert.deepStrictEqual(lines(result), [ plain('one'), plain(''), plain('an item'), plain(''), plain('two') ]);
});

test('markSceneBreaks does not mark the gap between two footnote bodies', function(){
  var result = markSceneBreaks(delta('one', '', note(1, 'first note'), '', note(2, 'second note')));
  assert.deepStrictEqual(lines(result), [ plain('one'), plain(''), plain('first note'), plain(''), plain('second note') ]);
});

//---- the chapter it is handed ----

test('markSceneBreaks leaves the delta it was given untouched', function(){
  var original = delta('one', '', 'two');
  var before = JSON.stringify(original);
  markSceneBreaks(original);
  assert.strictEqual(JSON.stringify(original), before);
});

test('markSceneBreaks keeps a footnote marker rather than dropping it on the way through', function(){
  var original = { ops: [
    { insert: 'one' },
    { insert: { footnote: { n: '1' } } },
    { insert: '\n\n' },
    { insert: 'two\n' }
  ] };

  var result = markSceneBreaks(original);
  var markers = (result.ops || []).filter(function(op){
    return op.insert && typeof op.insert === 'object' && op.insert.footnote;
  });

  assert.strictEqual(markers.length, 1, 'the footnote marker should survive the round trip through Quill');
  assert.deepStrictEqual(lines(result), [ plain('one'), MARK, plain('two') ]);
});

test('markSceneBreaks keeps the inline formatting of the paragraphs around the mark', function(){
  var original = { ops: [
    { insert: 'one' },
    { insert: 'italic', attributes: { italic: true } },
    { insert: '\n\n' },
    { insert: 'two\n' }
  ] };

  var italics = (markSceneBreaks(original).ops || []).filter(function(op){
    return op.attributes && op.attributes.italic;
  });

  assert.strictEqual(italics.length, 1);
  assert.strictEqual(italics[0].insert, 'italic');
});

test('the mark itself carries none of the styling of the paragraph above it', function(){
  var original = { ops: [
    { insert: 'one', attributes: { italic: true } },
    { insert: '\n\n' },
    { insert: 'two\n' }
  ] };

  var markParagraph = parseDelta(markSceneBreaks(original)).paragraphs[1];

  assert.deepStrictEqual(markParagraph.textRuns, [ { text: '#' } ], 'the mark should be written as plain text, italicized by nothing above it');
});
