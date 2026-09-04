const test = require('node:test');
const assert = require('node:assert');

const { convertMdfcToMd } = require('../src/components/controllers/mdfc-to-md');

test('alignment markers are dropped, since markdown has no alignment', function(){
  assert.strictEqual(convertMdfcToMd('[>c] # Title\n[>c] The End\n'), '# Title\nThe End\n');
  assert.strictEqual(convertMdfcToMd('[>r] Right\n'), 'Right\n');
  assert.strictEqual(convertMdfcToMd('[>j] Just\n'), 'Just\n');
});

test('tab indented paragraphs become blank line separated ones', function(){
  assert.strictEqual(
    convertMdfcToMd('First para.\n\tSecond para.\n\tThird para.\n'),
    'First para.\n\nSecond para.\n\nThird para.\n'
  );
});

//Regression: the indent stripping keyed off the newline in front of a paragraph, so the first
//paragraph of a chapter had nothing to match against and kept its literal tab in the markdown.
test('an indented first paragraph loses its tab like every other paragraph', function(){
  assert.strictEqual(
    convertMdfcToMd('\tFirst para.\n\tSecond para.\n\tThird para.\n'),
    'First para.\n\nSecond para.\n\nThird para.\n'
  );
  assert.strictEqual(convertMdfcToMd('\tOnly para.\n'), 'Only para.\n');
});

test('a list item on the first line keeps its nesting tab', function(){
  assert.strictEqual(convertMdfcToMd('\t* sub\n* top\n'), '\t* sub\n* top\n');
  assert.strictEqual(convertMdfcToMd('\t1. sub\n1. top\n'), '\t1. sub\n1. top\n');
});

test('a tab inside a line is not treated as an indent', function(){
  assert.strictEqual(convertMdfcToMd('A line\twith a tab.\n'), 'A line\twith a tab.\n');
});

test('paragraphs already separated by a blank line are left at one blank line', function(){
  assert.strictEqual(
    convertMdfcToMd('First para.\n\n\tSecond para.\n'),
    'First para.\n\nSecond para.\n'
  );
});

//The indent stripping has to leave list items alone: their leading tab is nesting, not a paragraph
//indent, and markdown needs it to render the nesting.
test('indented list items keep their leading tabs', function(){
  assert.strictEqual(
    convertMdfcToMd('Intro.\n\t1. a\n\t2. b\n'),
    'Intro.\n\t1. a\n\t2. b\n'
  );
  assert.strictEqual(
    convertMdfcToMd('Intro.\n\t* a\n\t\t* b\n'),
    'Intro.\n\t* a\n\t\t* b\n'
  );
});

test('headings and inline formatting pass through unchanged', function(){
  assert.strictEqual(
    convertMdfcToMd('# Title\nSome **bold** and *italic* text.\n'),
    '# Title\nSome **bold** and *italic* text.\n'
  );
});

test('footnotes are renumbered into markdown reference form', function(){
  var md = convertMdfcToMd('Body.[^1]\n[^1]: The note.\n');
  assert.ok(md.includes('[^1]'), 'footnote reference missing from markdown output');
  assert.ok(md.includes('The note.'), 'footnote text missing from markdown output');
});

//Regression: MDFC's own convention writes multi-paragraph footnote continuations with a tab
//already after the marker ("[^1]: \tSecond para."). consolidateMultiParaFootnotes was blindly
//prepending its own tab on top of that, producing a double tab instead of one.
test('a multi-paragraph footnote is consolidated with a single tab, even when the source already indents the continuation', function(){
  assert.strictEqual(
    convertMdfcToMd('Body.[^1]\n[^1]: First para.\n[^1]: \tSecond para.\n'),
    'Body.[^1]\n[^1]: First para.\n\tSecond para.\n'
  );
});

test('a multi-paragraph footnote is consolidated correctly when the source has no extra indent', function(){
  assert.strictEqual(
    convertMdfcToMd('Body.[^1]\n[^1]: First para.\n[^1]: Second para.\n[^1]: Third para.\n'),
    'Body.[^1]\n[^1]: First para.\n\tSecond para.\n\tThird para.\n'
  );
});

//Regression: the paragraph-indent and footnote-consolidation regexes assumed bare \n line
//endings. With \r\n input (as produced by Windows editors, and as shipped in the example .mdfc
//file), the footnote continuation was glued onto the same line as the first paragraph instead
//of becoming its own indented paragraph.
test('CRLF line endings do not break footnote consolidation', function(){
  assert.strictEqual(
    convertMdfcToMd('Body.[^1]\r\n[^1]: First para.\r\n[^1]: \tSecond para.\r\n'),
    'Body.[^1]\n[^1]: First para.\n\tSecond para.\n'
  );
});

test('CRLF line endings do not break indented-paragraph conversion', function(){
  assert.strictEqual(
    convertMdfcToMd('First para.\r\n\tSecond para.\r\n\tThird para.\r\n'),
    'First para.\n\nSecond para.\n\nThird para.\n'
  );
});
