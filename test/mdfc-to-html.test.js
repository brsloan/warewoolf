const test = require('node:test');
const assert = require('node:assert');

const { convertMdfcToHtml } = require('../src/components/controllers/mdfc-to-html');

test('headings convert at every level', function(){
  assert.strictEqual(
    convertMdfcToHtml('# H1\n## H2\n### H3\n#### H4\n'),
    '<h1>H1</h1>\n<h2>H2</h2>\n<h3>H3</h3>\n<h4>H4</h4>\n'
  );
});

test('alignment markers become classes and never reach the output as text', function(){
  assert.strictEqual(convertMdfcToHtml('[>c] Middle\n'), '<p class="center">Middle</p>\n');
  assert.strictEqual(convertMdfcToHtml('[>r] Right\n'), '<p class="right">Right</p>\n');
  assert.strictEqual(convertMdfcToHtml('[>l] Left\n'), '<p class="left">Left</p>\n');
  assert.strictEqual(convertMdfcToHtml('[>j] Just\n'), '<p class="justified">Just</p>\n');
  assert.strictEqual(convertMdfcToHtml('[>c] # Centered\n'), '<h1 class="center">Centered</h1>\n');
});

//Regression: markdownFic.js writes a bare marker for a blank line that carries an alignment or
//heading attribute. This converter still required text after the marker, so the marker itself was
//emitted as body text in exported HTML and EPUB.
test('a marker on an otherwise empty line produces an empty element, not literal text', function(){
  assert.strictEqual(convertMdfcToHtml('[>c] \n'), '<p class="center"></p>\n');
  assert.strictEqual(convertMdfcToHtml('[>r] \n'), '<p class="right"></p>\n');

  var chapter = convertMdfcToHtml('[>c] # Title\n[>c] \n[>c] The End\n');
  assert.strictEqual(
    chapter,
    '<h1 class="center">Title</h1>\n<p class="center"></p>\n<p class="center">The End</p>\n'
  );
  assert.ok(!chapter.includes('[>c]'), 'alignment marker leaked into the HTML');
});

test('bullet and numbered lists are wrapped in the matching list element', function(){
  assert.strictEqual(convertMdfcToHtml('* one\n* two\n'), '<ul><li>one</li>\n<li>two</li>\n</ul>\n');
  assert.strictEqual(convertMdfcToHtml('- one\n- two\n'), '<ul><li>one</li>\n<li>two</li>\n</ul>\n');
  assert.strictEqual(convertMdfcToHtml('1. a\n2. b\n'), '<ol><li>a</li>\n<li>b</li>\n</ol>\n');
});

test('an indented list item is nested inside its own list element', function(){
  assert.strictEqual(
    convertMdfcToHtml('* one\n\t* sub\n* two\n'),
    '<ul><li>one</li>\n<ul><li>sub</li>\n</ul>\n<li>two</li>\n</ul>\n'
  );
});

//Regression: the class attribute used to group list items was stripped with a greedy .*, which ran
//on to the last quote on the line and swallowed the item's text whenever it contained dialogue.
test('list item text survives double quotes', function(){
  assert.strictEqual(
    convertMdfcToHtml('- She said "no" loudly\n- second\n'),
    '<ul><li>She said "no" loudly</li>\n<li>second</li>\n</ul>\n'
  );
  assert.strictEqual(
    convertMdfcToHtml('1. "Go," he said, "now."\n'),
    '<ol><li>"Go," he said, "now."</li>\n</ol>\n'
  );
});

test('no temporary grouping class is left behind on list items', function(){
  var html = convertMdfcToHtml('* one\n\t* sub\n1. a\n');
  assert.ok(!html.includes('class="ul'), 'temporary ul grouping class left in output');
  assert.ok(!html.includes('class="ol'), 'temporary ol grouping class left in output');
});

test('inline formatting is applied inside list items', function(){
  assert.strictEqual(
    convertMdfcToHtml('* a **bold** item\n'),
    '<ul><li>a <b>bold</b> item</li>\n</ul>\n'
  );
});

test('inline formatting converts to the expected tags', function(){
  assert.strictEqual(convertMdfcToHtml('**b**\n'), '<p><b>b</b></p>\n');
  assert.strictEqual(convertMdfcToHtml('*i*\n'), '<p><i>i</i></p>\n');
  assert.strictEqual(convertMdfcToHtml('__u__\n'), '<p><u>u</u></p>\n');
  assert.strictEqual(convertMdfcToHtml('~~s~~\n'), '<p><del>s</del></p>\n');
});

//Regression: markdownFic.js escapes prose that opens with a list marker, but this converter did not
//know about the list markers, so the backslash survived into the exported HTML.
test('escaped markers lose their backslash and stay out of their markup', function(){
  assert.strictEqual(convertMdfcToHtml('\\- not a list\n'), '<p>- not a list</p>\n');
  assert.strictEqual(convertMdfcToHtml('\\+ not a list\n'), '<p>+ not a list</p>\n');
  assert.strictEqual(convertMdfcToHtml('\\1984. A year\n'), '<p>1984. A year</p>\n');
  assert.strictEqual(convertMdfcToHtml('\\# not a heading\n'), '<p># not a heading</p>\n');
});

test('windows line endings produce the same output as unix ones', function(){
  assert.strictEqual(
    convertMdfcToHtml('* one\r\n* two\r\n'),
    convertMdfcToHtml('* one\n* two\n')
  );
  assert.strictEqual(
    convertMdfcToHtml('# Title\r\nBody.\r\n'),
    convertMdfcToHtml('# Title\nBody.\n')
  );
});

test('a blank line between paragraphs becomes a break', function(){
  assert.strictEqual(
    convertMdfcToHtml('Para one.\n\nPara two.\n'),
    '<p>Para one.</p>\n<br/>\n<p>Para two.</p>\n'
  );
});

test('a footnote marker in the body becomes a linked reference', function(){
  var html = convertMdfcToHtml('Body text.[^1]\n[^1]: The note.\n');
  assert.ok(html.includes('<sup><a href="#fnote_1" id="fnoteRef_1">1</a></sup></p>'),
    'footnote reference anchor missing from the body text');
});

//Regression: the wrapping div was only built when a footnote spanned several paragraphs, so an
//ordinary one paragraph footnote had no #fnote_N for the body reference to land on, and its
//definition line fell through to the reference conversion and came back carrying a second copy of
//the fnoteRef_N id.
test('a single paragraph footnote is wrapped in a div carrying the anchor', function(){
  assert.strictEqual(
    convertMdfcToHtml('Body text.[^1]\n[^1]: The note.\n'),
    '<p>Body text.<sup><a href="#fnote_1" id="fnoteRef_1">1</a></sup></p>\n' +
    '<div class="footnote" id="fnote_1"><p><sup><a href="#fnoteRef_1">1</a></sup>The note.\n</p></div>\n'
  );
});

test('the body reference and its definition anchor point at each other', function(){
  var html = convertMdfcToHtml('Body text.[^1]\n[^1]: The note.\n');
  assert.ok(html.includes('href="#fnote_1"'), 'body reference does not link to the definition');
  assert.ok(html.includes('id="fnote_1"'), 'definition anchor missing');
  assert.ok(html.includes('href="#fnoteRef_1"'), 'definition does not link back to the body');
  assert.strictEqual(html.match(/id="fnoteRef_1"/g).length, 1, 'fnoteRef_1 id is duplicated');
});

test('a multi paragraph footnote collects its paragraphs into one div', function(){
  assert.strictEqual(
    convertMdfcToHtml('Body text.[^1]\n[^1]: Para one.\n[^1]: Para two.\n'),
    '<p>Body text.<sup><a href="#fnote_1" id="fnoteRef_1">1</a></sup></p>\n' +
    '<div class="footnote" id="fnote_1"><p><sup><a href="#fnoteRef_1">1</a></sup>Para one.\n</p>' +
    '<p>Para two.\n</p></div>\n'
  );
});

test('several footnotes each get their own div and anchor', function(){
  var html = convertMdfcToHtml('A[^1] B[^2]\n[^1]: First.\n[^2]: Second.\n');
  assert.ok(html.includes('<div class="footnote" id="fnote_1">'), 'first footnote div missing');
  assert.ok(html.includes('<div class="footnote" id="fnote_2">'), 'second footnote div missing');
  assert.ok(html.includes('First.') && html.includes('Second.'), 'footnote text missing');
});

test('text with no footnotes is left alone', function(){
  assert.strictEqual(convertMdfcToHtml('Just prose.\n'), '<p>Just prose.</p>\n');
});

//Regression: bold and italic both use "*", so a naive regex for bold ("**...**") can't span an
//italic marker nested inside it - the exclusion class blocks on any asterisk, the outer match fails
//entirely, and its asterisks leak into the output as literal text instead of a <b> tag.
test('italic nested inside bold produces properly nested tags', function(){
  assert.strictEqual(
    convertMdfcToHtml('**bold *italic inside* more bold**\n'),
    '<p><b>bold <i>italic inside</i> more bold</b></p>\n'
  );
});

test('an escaped asterisk inside a bold span does not break the span', function(){
  assert.strictEqual(
    convertMdfcToHtml('**bold with a literal \\* char**\n'),
    '<p><b>bold with a literal * char</b></p>\n'
  );
});

//Regression: when an outer style (bold) closes while an inner style opened after it (italic) stays
//active, the tags must be closed and reopened at the divergence point or they cross into invalid
//HTML (e.g. "<b>...<i>...</b>...</i>").
test('a style that outlives an outer style it was nested in stays validly nested', function(){
  assert.strictEqual(
    convertMdfcToHtml('***AAA**BBB*\n'),
    '<p><b><i>AAA</i></b><i>BBB</i></p>\n'
  );
});

//Regression: blockquote required at least one character of text ((.+)), unlike the header/alignment
//markers, which use (.*) so a bare marker on an otherwise empty line still produces an element
//instead of leaking the marker itself into the output.
test('a bare blockquote marker produces an empty element, not literal text', function(){
  assert.strictEqual(convertMdfcToHtml('>\n'), '<blockquote></blockquote>\n');
  assert.strictEqual(convertMdfcToHtml('> \n'), '<blockquote></blockquote>\n');
});
