const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

//html-import.js reads `new DOMParser()` as a bare global. In the app this is supplied by Electron's
//renderer (window.DOMParser); tests supply the same API via jsdom, same as docx-import.test.js.
global.DOMParser = new JSDOM().window.DOMParser;

const { convertHtmlToDelta } = require('../src/components/controllers/html-import');

//Every assertion below is about one document's worth of conversion, so the common case is "one
//delta out". Anything testing the chapter split asks for the array instead.
function convertOne(html, options){
  var deltas = convertHtmlToDelta(html, options);
  assert.strictEqual(deltas.length, 1, 'expected a single delta, got ' + deltas.length);
  return deltas[0].ops;
}

function textOf(delta){
  return (delta.ops || delta).map(function(op){
    return typeof op.insert === 'string' ? op.insert : '';
  }).join('');
}

// --- inline formatting --------------------------------------------------------------------------

test('italics and bold are read from tags', function(){
  assert.deepStrictEqual(convertOne('<p>a <i>b</i> <em>c</em> <b>d</b> <strong>e</strong></p>'), [
    { insert: 'a ' },
    { insert: 'b', attributes: { italic: true } },
    { insert: ' ' },
    { insert: 'c', attributes: { italic: true } },
    { insert: ' ' },
    { insert: 'd', attributes: { bold: true } },
    { insert: ' ' },
    { insert: 'e', attributes: { bold: true } },
    { insert: '\n' }
  ]);
});

//The case the whole style resolver exists for, and the one Quill's own clipboard loses: matchStyles
//guards on the inline `style` *attribute* before consulting the computed style, so a run styled by
//class never reaches its italic check. This is how Google Docs writes every run of an HTML export.
test('italics and bold are read from a class rule in the document stylesheet', function(){
  assert.deepStrictEqual(
    convertOne('<style>.c3{font-style:italic}.c7{font-weight:700}</style>'
      + '<p><span class="c3">whispered</span> and <span class="c7">shouted</span></p>'),
    [
      { insert: 'whispered', attributes: { italic: true } },
      { insert: ' and ' },
      { insert: 'shouted', attributes: { bold: true } },
      { insert: '\n' }
    ]
  );
});

test('italics are read from an inline style attribute', function(){
  assert.deepStrictEqual(convertOne('<p><span style="font-style: italic">x</span></p>'), [
    { insert: 'x', attributes: { italic: true } },
    { insert: '\n' }
  ]);
});

test('nested styles combine rather than replacing each other', function(){
  assert.deepStrictEqual(convertOne('<p><i>b <b>c</b></i></p>'), [
    { insert: 'b ', attributes: { italic: true } },
    { insert: 'c', attributes: { italic: true, bold: true } },
    { insert: '\n' }
  ]);
});

test('font-style normal inside an italic run turns the italic back off', function(){
  assert.deepStrictEqual(convertOne('<p><i>a<span style="font-style:normal">b</span></i></p>'), [
    { insert: 'a', attributes: { italic: true } },
    { insert: 'b' },
    { insert: '\n' }
  ]);
});

test('underline and strike come from tags and from text-decoration', function(){
  assert.deepStrictEqual(
    convertOne('<p><u>a</u>-<span style="text-decoration:underline">b</span>'
      + '-<del>c</del>-<span style="text-decoration:line-through">d</span></p>'),
    [
      { insert: 'a', attributes: { underline: true } },
      { insert: '-' },
      { insert: 'b', attributes: { underline: true } },
      { insert: '-' },
      { insert: 'c', attributes: { strike: true } },
      { insert: '-' },
      { insert: 'd', attributes: { strike: true } },
      { insert: '\n' }
    ]
  );
});

//Regression: Gutenberg's stylesheet carries `a { text-decoration: underline }`, so honouring it
//underlines every link in the book - the underline count came out exactly equal to the link count
//across all three sample books. An anchor's own decoration is browser chrome, not the writer's
//emphasis; a <u> nested inside one is still the writer's.
test('an anchor never contributes underline, but a <u> inside one does', function(){
  assert.deepStrictEqual(
    convertOne('<style>a{text-decoration:underline}</style>'
      + '<p><a href="#x">link</a> and <a href="#y"><u>real</u></a></p>'),
    [
      { insert: 'link and ' },
      { insert: 'real', attributes: { underline: true } },
      { insert: '\n' }
    ]
  );
});

test('a link keeps its text and loses its href', function(){
  var ops = convertOne('<p>see <a href="https://example.com/x">the page</a></p>');
  assert.strictEqual(textOf(ops), 'see the page\n');
  ops.forEach(function(op){
    assert.ok(!op.attributes || !op.attributes.link, 'a link attribute survived the import');
  });
});

// --- block formatting ---------------------------------------------------------------------------

test('headings map to levels one to four and clamp above that', function(){
  assert.deepStrictEqual(convertOne('<h1>a</h1><h4>b</h4><h5>c</h5><h6>d</h6>'), [
    { insert: 'a' }, { insert: '\n', attributes: { header: 1 } },
    { insert: 'b' }, { insert: '\n', attributes: { header: 4 } },
    { insert: 'c' }, { insert: '\n', attributes: { header: 4 } },
    { insert: 'd' }, { insert: '\n', attributes: { header: 4 } }
  ]);
});

test('blockquotes and lists carry their block attributes', function(){
  assert.deepStrictEqual(
    convertOne('<blockquote>q</blockquote><ul><li>one</li></ul><ol><li>two</li></ol>'),
    [
      { insert: 'q' }, { insert: '\n', attributes: { blockquote: true } },
      { insert: 'one' }, { insert: '\n', attributes: { list: 'bullet' } },
      { insert: 'two' }, { insert: '\n', attributes: { list: 'ordered' } }
    ]
  );
});

test('a nested list item is indented by its nesting depth', function(){
  assert.deepStrictEqual(
    convertOne('<ul><li>one<ul><li>two<ul><li>three</li></ul></li></ul></li></ul>'),
    [
      { insert: 'one' }, { insert: '\n', attributes: { list: 'bullet' } },
      { insert: 'two' }, { insert: '\n', attributes: { list: 'bullet', indent: 1 } },
      { insert: 'three' }, { insert: '\n', attributes: { list: 'bullet', indent: 2 } }
    ]
  );
});

test('alignment is read from a class, an inline style and an ancestor alike', function(){
  assert.deepStrictEqual(
    convertOne('<style>.r{text-align:right}</style>'
      + '<p class="r">a</p><p style="text-align:center">b</p><div style="text-align:center"><p>c</p></div>'),
    [
      { insert: 'a' }, { insert: '\n', attributes: { align: 'right' } },
      { insert: 'b' }, { insert: '\n', attributes: { align: 'center' } },
      { insert: 'c' }, { insert: '\n', attributes: { align: 'center' } }
    ]
  );
});

//Regression: Gutenberg's stylesheet opens with `body { text-align: justify }`. Taken literally that
//lands an align attribute on all 766 paragraphs of Frankenstein, a book where nothing was
//deliberately aligned - measured on Wuthering Heights it was 2039 attributes where 54 were real.
//The document's own baseline is read first and only blocks that differ from it are marked.
test('the body alignment is a baseline and never becomes an attribute of its own', function(){
  assert.deepStrictEqual(
    convertOne('<style>body{text-align:justify}.right{text-align:right}</style>'
      + '<p>ordinary</p><p class="right">aligned</p>'),
    [
      { insert: 'ordinary' }, { insert: '\n' },
      { insert: 'aligned' }, { insert: '\n', attributes: { align: 'right' } }
    ]
  );
});

test('a block that differs from a centered body is marked, including back to left', function(){
  assert.deepStrictEqual(
    convertOne('<style>body{text-align:center}.l{text-align:left}</style>'
      + '<p>centered</p><p class="l">left</p>'),
    [
      { insert: 'centered' }, { insert: '\n' },
      { insert: 'left' }, { insert: '\n', attributes: { align: 'left' } }
    ]
  );
});

//Regression: a block element closes the line already in progress, and that line belongs to whatever
//encloses it. Using the *entering* element's attributes gave "loose" the paragraph's formatting.
test('loose text before a nested block keeps the enclosing block attributes', function(){
  assert.deepStrictEqual(
    convertOne('<blockquote>loose<h2>heading</h2></blockquote>'),
    [
      { insert: 'loose' }, { insert: '\n', attributes: { blockquote: true } },
      { insert: 'heading' }, { insert: '\n', attributes: { header: 2 } }
    ]
  );
});

test('display block promotes an inline element to its own line', function(){
  assert.deepStrictEqual(
    convertOne('<style>.blk{display:block;text-align:center}</style>'
      + '<span class="blk">own line</span><span>inline</span>'),
    [
      { insert: 'own line' }, { insert: '\n', attributes: { align: 'center' } },
      { insert: 'inline' }, { insert: '\n' }
    ]
  );
});

// --- whitespace ---------------------------------------------------------------------------------

//Regression: Gutenberg writes its prose one wrapped source line per line, inside a <p> that opens
//and closes on lines of its own. Newlines inside a paragraph are formatting and collapse to spaces;
//the whitespace at either edge of a block is dropped. Missing the second rule puts a stray space on
//both ends of every paragraph in the book.
test('newlines inside a paragraph collapse and the block edges are trimmed', function(){
  assert.deepStrictEqual(
    convertOne('<p>\n  So strange an accident\n  has happened\n</p>'),
    [{ insert: 'So strange an accident has happened' }, { insert: '\n' }]
  );
});

//Regression: the whitespace at a block's edge is not always the same op as the text it sits
//against. `<p>\n  <a> Text </a>\n</p>` puts the closing newline in a text node of its own, so
//trimming only the last op trimmed *that* one to nothing and left the real last op's trailing space
//behind. Every entry of Moby-Dick's contents page came in as "ETYMOLOGY. " because of it - found by
//running the importer over the real book, which is what test/fixtures/books is for.
test('block edges are trimmed even when the whitespace is an op of its own', function(){
  assert.deepStrictEqual(
    convertOne('<p>\n  <a href="#x"> ETYMOLOGY. </a>\n</p>'),
    [{ insert: 'ETYMOLOGY.' }, { insert: '\n' }]
  );

  //Both edges, and through more than one layer of it.
  assert.deepStrictEqual(
    convertOne('<p>\n  <span> </span> <i>Hello</i> <span> </span>\n</p>'),
    [{ insert: 'Hello', attributes: { italic: true } }, { insert: '\n' }]
  );
});

test('whitespace between two blocks is layout and never becomes a word gap', function(){
  assert.deepStrictEqual(
    convertOne('<p>one</p>\n\n   <p>two</p>'),
    [{ insert: 'one' }, { insert: '\n' }, { insert: 'two' }, { insert: '\n' }]
  );
});

test('a non-breaking space is content and survives the collapse', function(){
  assert.strictEqual(convertOne('<p>a  b</p>')[0].insert, 'a  b');
});

test('a br ends the line and two in a row leave a blank one', function(){
  assert.deepStrictEqual(convertOne('<p>one<br/>two<br/><br/>four</p>'), [
    { insert: 'one' }, { insert: '\n' },
    { insert: 'two' }, { insert: '\n' },
    { insert: '\n' },
    { insert: 'four' }, { insert: '\n' }
  ]);
});

test('a br inside an aligned block keeps that block alignment on every line', function(){
  assert.deepStrictEqual(convertOne('<p style="text-align:center">one<br/>two</p>'), [
    { insert: 'one' }, { insert: '\n', attributes: { align: 'center' } },
    { insert: 'two' }, { insert: '\n', attributes: { align: 'center' } }
  ]);
});

//Every newline is a block boundary in this format - there is no soft break - so a <pre> becomes one
//paragraph per line, with its runs of spaces intact and the newline HTML drops after the open tag
//dropped here too.
test('pre keeps its line breaks and its runs of spaces', function(){
  assert.deepStrictEqual(convertOne('<pre>\n  line one\n\n  line   three\n</pre>'), [
    { insert: '  line one' }, { insert: '\n' },
    { insert: '\n' },
    { insert: '  line   three' }, { insert: '\n' }
  ]);
});

test('white-space pre from the stylesheet behaves the same as a pre element', function(){
  assert.deepStrictEqual(
    convertOne('<style>.verse{white-space:pre-wrap}</style><div class="verse">a  b\nc</div>'),
    [{ insert: 'a  b' }, { insert: '\n' }, { insert: 'c' }, { insert: '\n' }]
  );
});

// --- what gets stripped -------------------------------------------------------------------------

test('images, media and scripts are dropped whole', function(){
  assert.deepStrictEqual(
    convertOne('<p>keep<img src="x.jpg" alt="gone"/><svg><text>no</text></svg></p>'
      + '<script>var leaked = 1;</script><figure><img src="y.png"/></figure>'),
    [{ insert: 'keep' }, { insert: '\n' }]
  );
});

test('a display none subtree never reaches the delta', function(){
  assert.deepStrictEqual(
    convertOne('<style>.hidden{display:none}</style><p>seen</p><p class="hidden">unseen</p>'),
    [{ insert: 'seen' }, { insert: '\n' }]
  );
});

test('an hr becomes a centered scene break', function(){
  assert.deepStrictEqual(convertOne('<p>before</p><hr/><p>after</p>'), [
    { insert: 'before' }, { insert: '\n' },
    { insert: '* * *' }, { insert: '\n', attributes: { align: 'center' } },
    { insert: 'after' }, { insert: '\n' }
  ]);
});

// --- stylesheet handling ------------------------------------------------------------------------

test('rules inside a screen media query apply and a print-only query is ignored', function(){
  assert.deepStrictEqual(
    convertOne('<style>@media print{.p{font-style:italic}}@media screen{.s{font-style:italic}}</style>'
      + '<p><span class="p">plain</span><span class="s">italic</span></p>'),
    [
      { insert: 'plain' },
      { insert: 'italic', attributes: { italic: true } },
      { insert: '\n' }
    ]
  );
});

test('an at-rule with no ordinary rules inside it cannot leak declarations', function(){
  assert.deepStrictEqual(
    convertOne('<style>@font-face{font-style:italic;src:url(x.woff)}</style><p>plain</p>'),
    [{ insert: 'plain' }, { insert: '\n' }]
  );
});

test('a comment and a malformed selector do not stop the rules around them', function(){
  assert.deepStrictEqual(
    convertOne('<style>/* .a{font-style:italic} */ ){font-weight:bold} .b{font-style:italic}</style>'
      + '<p><span class="a">a</span><span class="b">b</span></p>'),
    [
      { insert: 'a' },
      { insert: 'b', attributes: { italic: true } },
      { insert: '\n' }
    ]
  );
});

test('a selector list applies to every selector in it', function(){
  assert.deepStrictEqual(
    convertOne('<style>h1, h2, .x{text-align:center}</style><h2>a</h2>'),
    [{ insert: 'a' }, { insert: '\n', attributes: { header: 2, align: 'center' } }]
  );
});

//Rules are filed by whatever their rightmost compound requires, so an element only tests the few
//that could match it - a 300-rule, 24,000-element document is 8x faster that way. The bucketing must
//not change any answer, so what follows pins the cases where it could: source order across different
//buckets, selectors with no key at all, and selectors whose rightmost part is not the whole thing.
test('source order still decides when the winning rules sit in different buckets', function(){
  assert.deepStrictEqual(
    convertOne('<style>.c{font-style:italic} span{font-style:normal}</style>'
      + '<p><span class="c">plain</span></p>'),
    [{ insert: 'plain' }, { insert: '\n' }]
  );

  assert.deepStrictEqual(
    convertOne('<style>span{font-style:normal} .c{font-style:italic}</style>'
      + '<p><span class="c">italic</span></p>'),
    [{ insert: 'italic', attributes: { italic: true } }, { insert: '\n' }]
  );
});

test('a keyless selector is tested against every element', function(){
  assert.deepStrictEqual(
    convertOne('<style>*{font-style:italic}</style><p>a</p>'),
    [{ insert: 'a', attributes: { italic: true } }, { insert: '\n' }]
  );

  assert.deepStrictEqual(
    convertOne('<style>[lang]{font-style:italic}</style><p><span lang="fr">a</span></p>'),
    [{ insert: 'a', attributes: { italic: true } }, { insert: '\n' }]
  );
});

test('a descendant selector is filed under the element it selects, not the one it starts with', function(){
  assert.deepStrictEqual(
    convertOne('<style>div.chapter > p.first{font-style:italic}</style>'
      + '<div class="chapter"><p class="first">a</p><p>b</p></div>'),
    [
      { insert: 'a', attributes: { italic: true } }, { insert: '\n' },
      { insert: 'b' }, { insert: '\n' }
    ]
  );
});

test('a comma inside a functional selector does not split it into two', function(){
  assert.deepStrictEqual(
    convertOne('<style>p:not(.a, .b){font-style:italic}</style>'
      + '<p class="a">plain</p><p class="c">italic</p>'),
    [
      { insert: 'plain' }, { insert: '\n' },
      { insert: 'italic', attributes: { italic: true } }, { insert: '\n' }
    ]
  );
});

test('a dot inside an attribute value is not mistaken for a class', function(){
  assert.deepStrictEqual(
    convertOne('<style>p a[href=".x"]{font-style:italic}</style>'
      + '<p><a href=".x">a</a><a href="y">b</a></p>'),
    [
      { insert: 'a', attributes: { italic: true } },
      { insert: 'b' },
      { insert: '\n' }
    ]
  );
});

test('an id selector is matched', function(){
  assert.deepStrictEqual(
    convertOne('<style>#note{font-style:italic}</style><p id="note">a</p><p>b</p>'),
    [
      { insert: 'a', attributes: { italic: true } }, { insert: '\n' },
      { insert: 'b' }, { insert: '\n' }
    ]
  );
});

// --- tables -------------------------------------------------------------------------------------

//There is no table format and inventing one is not the job, but flattening a table loses which words
//shared a row. Tables in fiction are almost always layout tables (of the three sample books, one's
//is a contents list and the other's the Etymology columns), so each row becomes a line of markdown
//pipe syntax the writer can reformat. No header separator row: guessing which row of a layout table
//is a heading is wrong more often than not.
test('a multi-column table becomes one markdown pipe row per tr', function(){
  assert.deepStrictEqual(
    convertOne('<table><tr><td>a</td><td><i>b</i></td></tr><tr><td>c</td><td>d</td></tr></table>'),
    [
      { insert: '| a | ' },
      { insert: 'b', attributes: { italic: true } },
      { insert: ' |' },
      { insert: '\n' },
      { insert: '| c | d |' },
      { insert: '\n' }
    ]
  );
});

test('a ragged row is padded to the table width', function(){
  assert.strictEqual(
    textOf(convertOne('<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td></tr></table>')),
    '| a | b | c |\n| d |  |  |\n'
  );
});

test('a pipe inside a cell is escaped so it cannot read as a cell boundary', function(){
  assert.strictEqual(
    textOf(convertOne('<table><tr><td>a|b</td><td>c</td></tr></table>')),
    '| a\\|b | c |\n'
  );
});

//Gutenberg's contents list is exactly this shape, and "| Letter 1 |" is pure noise.
test('a single-column table becomes plain paragraphs with no pipes', function(){
  assert.deepStrictEqual(
    convertOne('<table><tr><td>Letter 1</td></tr><tr><td>Letter 2</td></tr></table>'),
    [{ insert: 'Letter 1' }, { insert: '\n' }, { insert: 'Letter 2' }, { insert: '\n' }]
  );
});

test('block content inside a cell collapses to one row rather than breaking it', function(){
  assert.strictEqual(
    textOf(convertOne('<table><tr><td><p>one</p><p>two</p></td><td>three</td></tr></table>')),
    '| one two | three |\n'
  );
});

// --- chapter splitting --------------------------------------------------------------------------

test('nothing is split unless the caller asks', function(){
  var deltas = convertHtmlToDelta('<h2>One</h2><p>a</p><h2>Two</h2><p>b</p>');
  assert.strictEqual(deltas.length, 1);
});

//Level two rather than docx's level one, because HTML books put the book title in <h1> and the
//chapter titles in <h2> - all three sample books do. Defaulting to 1 would give a single chapter.
test('splitting at a heading level starts each chapter with its heading', function(){
  var deltas = convertHtmlToDelta('<h1>Book</h1><p>front</p><h2>One</h2><p>a</p><h2>Two</h2><p>b</p>',
    { splitChapters: { headingLevel: 2 } });

  assert.strictEqual(deltas.length, 3);
  assert.strictEqual(textOf(deltas[0]), 'Book\nfront\n');
  assert.strictEqual(textOf(deltas[1]), 'One\na\n');
  assert.strictEqual(textOf(deltas[2]), 'Two\nb\n');
});

test('the heading level is honoured, so a deeper heading does not split', function(){
  var deltas = convertHtmlToDelta('<h1>One</h1><p>a</p><h2>sub</h2><p>b</p><h1>Two</h1><p>c</p>',
    { splitChapters: { headingLevel: 1 } });

  assert.strictEqual(deltas.length, 2);
  assert.strictEqual(textOf(deltas[0]), 'One\na\nsub\nb\n');
  assert.strictEqual(textOf(deltas[1]), 'Two\nc\n');
});

test('a document opening on a heading does not produce an empty first chapter', function(){
  var deltas = convertHtmlToDelta('<h2>One</h2><p>a</p><h2>Two</h2><p>b</p>',
    { splitChapters: { headingLevel: 2 } });

  assert.strictEqual(deltas.length, 2);
  assert.strictEqual(textOf(deltas[0]), 'One\na\n');
});

//The rule has become the chapter boundary at this point, so emitting the scene break as well would
//open every chapter after the first with a stray marker.
test('splitting at rules consumes the rule instead of writing a scene break', function(){
  var deltas = convertHtmlToDelta('<p>a</p><hr/><p>b</p><hr/><p>c</p>',
    { splitChapters: { atRules: true } });

  assert.strictEqual(deltas.length, 3);
  assert.deepStrictEqual(deltas.map(textOf), ['a\n', 'b\n', 'c\n']);
});

//The two ways of splitting are independent. A single `split` flag gating both was the obvious shape
//and the wrong one: it makes "split at horizontal rules" silently do nothing whenever no heading
//level happens to be asked for, which is exactly what the import dialog lets a writer choose.
test('splitting at rules needs no heading level, and the two combine when both are asked for', function(){
  assert.deepStrictEqual(
    convertHtmlToDelta('<h2>One</h2><p>a</p><hr/><p>b</p>', { splitChapters: { atRules: true } })
      .map(textOf),
    ['One\na\n', 'b\n']
  );

  assert.deepStrictEqual(
    convertHtmlToDelta('<h2>One</h2><p>a</p><hr/><p>b</p><h2>Two</h2><p>c</p>',
      { splitChapters: { headingLevel: 2, atRules: true } }).map(textOf),
    ['One\na\n', 'b\n', 'Two\nc\n']
  );

  //Neither asked for: the rule stays a scene break and nothing splits.
  assert.deepStrictEqual(
    convertHtmlToDelta('<h2>One</h2><p>a</p><hr/><p>b</p>').map(textOf),
    ['One\na\n* * *\nb\n']
  );
});

// --- linked stylesheets and id-anchored splitting -----------------------------------------------

//An epub chapter has no <style> block at all - it links its CSS - so without this an epub resolves
//no class-driven styling whatsoever, which is the failure the resolver exists to prevent arriving
//through the back door. epub-import.js reads the linked sheets out of the archive and passes them.
test('extraCss rules apply exactly as a style block in the document would', function(){
  assert.deepStrictEqual(
    convertOne('<p><span class="c3">whispered</span></p>', { extraCss: ['.c3{font-style:italic}'] }),
    [{ insert: 'whispered', attributes: { italic: true } }, { insert: '\n' }]
  );
});

test('a document style block wins over a linked sheet, as source order says it should', function(){
  assert.deepStrictEqual(
    convertOne('<style>.c{font-style:normal}</style><p><span class="c">plain</span></p>',
      { extraCss: ['.c{font-style:italic}'] }),
    [{ insert: 'plain' }, { insert: '\n' }]
  );
});

test('extraCss takes several sheets and applies them in order', function(){
  assert.deepStrictEqual(
    convertOne('<p><span class="a">x</span></p>',
      { extraCss: ['.a{font-style:italic}', '.a{font-style:normal;font-weight:bold}'] }),
    [{ insert: 'x', attributes: { bold: true } }, { insert: '\n' }]
  );
});

//The anchor is sometimes the chapter's own top-level block (Moby-Dick's packed files) and sometimes
//a heading inside a wrapper holding several chapters at once (Frankenstein's title page has two
//entries inside one <div>). Splitting positionally, against the output rather than the tree, is the
//same rule in both cases - carving up the DOM is not.
test('splitting at ids cuts in front of the element carrying each one', function(){
  var deltas = convertHtmlToDelta(
    '<div class="chapter" id="c1"><h2>One</h2><p>a</p></div>'
      + '<div class="chapter" id="c2"><h2>Two</h2><p>b</p></div>',
    { splitChapters: { atIds: ['c1', 'c2'] } });

  assert.deepStrictEqual(deltas.map(textOf), ['One\na\n', 'Two\nb\n']);
  assert.deepStrictEqual(deltas.map(function(d){ return d.splitId; }), ['c1', 'c2']);
});

test('splitting at ids works when the anchors share one wrapper element', function(){
  var deltas = convertHtmlToDelta(
    '<div><h1 id="t">Title</h1><p>by someone</p><h3 id="n">A Note</h3><p>text</p></div>',
    { splitChapters: { atIds: ['t', 'n'] } });

  assert.deepStrictEqual(deltas.map(textOf), ['Title\nby someone\n', 'A Note\ntext\n']);
  assert.deepStrictEqual(deltas.map(function(d){ return d.splitId; }), ['t', 'n']);
});

test('an anchor on an inline element inside a heading still splits before the heading', function(){
  var deltas = convertHtmlToDelta(
    '<h2><a id="one"></a>One</h2><p>a</p><h2><a id="two"></a>Two</h2><p>b</p>',
    { splitChapters: { atIds: ['one', 'two'] } });

  assert.deepStrictEqual(deltas.map(textOf), ['One\na\n', 'Two\nb\n']);
});

//Content ahead of the first anchor is a real chapter of its own - front matter - and comes back
//without a splitId. That is exactly why the id is reported rather than the caller counting deltas.
test('content before the first anchor comes back as an unnamed leading delta', function(){
  var deltas = convertHtmlToDelta('<p>front matter</p><h2 id="one">One</h2><p>a</p>',
    { splitChapters: { atIds: ['one'] } });

  assert.strictEqual(deltas.length, 2);
  assert.strictEqual(deltas[0].splitId, undefined);
  assert.strictEqual(textOf(deltas[0]), 'front matter\n');
  assert.strictEqual(deltas[1].splitId, 'one');
});

test('an id that is not in the document simply does not split', function(){
  var deltas = convertHtmlToDelta('<h2 id="one">One</h2><p>a</p>',
    { splitChapters: { atIds: ['one', 'nowhere'] } });

  assert.strictEqual(deltas.length, 1);
  assert.strictEqual(deltas[0].splitId, 'one');
});

//A heading split and an id split landing on the same boundary is one boundary, not two, and the id
//is the more informative of the two - dropping it would lose the pairing with the TOC entry.
test('an id and a heading split at the same place stay one boundary, keeping the id', function(){
  var deltas = convertHtmlToDelta('<h2 id="one">One</h2><p>a</p><h2 id="two">Two</h2><p>b</p>',
    { splitChapters: { headingLevel: 2, atIds: ['one', 'two'] } });

  assert.deepStrictEqual(deltas.map(textOf), ['One\na\n', 'Two\nb\n']);
  assert.deepStrictEqual(deltas.map(function(d){ return d.splitId; }), ['one', 'two']);
});

test('splitId is absent entirely when no ids were asked for', function(){
  var deltas = convertHtmlToDelta('<h2>One</h2><p>a</p><h2>Two</h2><p>b</p>',
    { splitChapters: { headingLevel: 2 } });

  deltas.forEach(function(delta){
    assert.deepStrictEqual(Object.keys(delta), ['ops']);
  });
});

// --- Project Gutenberg boilerplate --------------------------------------------------------------

test('the boilerplate elements are removed only when asked for', function(){
  var html = '<header id="pg-header"><p>licence</p></header><p>the book</p>'
    + '<footer id="pg-footer"><p>terms</p></footer>';

  assert.strictEqual(textOf(convertHtmlToDelta(html)[0]), 'licence\nthe book\nterms\n');
  assert.strictEqual(textOf(convertHtmlToDelta(html, { stripBoilerplate: true })[0]), 'the book\n');
});

//For files old enough to predate the #pg-header/#pg-footer elements the boundary is only in the text.
test('the start and end markers trim the front and back of an older file', function(){
  var deltas = convertHtmlToDelta(
    '<p>licence blurb</p><p>*** START OF THE PROJECT GUTENBERG EBOOK FOO ***</p>'
      + '<p>the book</p><p>*** END OF THE PROJECT GUTENBERG EBOOK FOO ***</p><p>footer</p>',
    { stripBoilerplate: true });

  assert.strictEqual(textOf(deltas[0]), 'the book\n');
});

test('boilerplate stripping still splits into the right chapters', function(){
  var deltas = convertHtmlToDelta(
    '<header id="pg-header"><p>licence</p></header>'
      + '<h2>One</h2><p>a</p><h2>Two</h2><p>b</p>'
      + '<footer id="pg-footer"><p>terms</p></footer>',
    { stripBoilerplate: true, splitChapters: { headingLevel: 2 } });

  assert.strictEqual(deltas.length, 2);
  assert.deepStrictEqual(deltas.map(textOf), ['One\na\n', 'Two\nb\n']);
});

// --- shape of the result ------------------------------------------------------------------------

test('a delta always comes back, even for an empty or unparseable document', function(){
  assert.deepStrictEqual(convertHtmlToDelta(''), [{ ops: [] }]);
  assert.deepStrictEqual(convertHtmlToDelta(null), [{ ops: [] }]);
  assert.deepStrictEqual(convertHtmlToDelta(undefined), [{ ops: [] }]);
});

//The delta is built with every newline as an op of its own, because that is what lets the
//boilerplate trim and the chapter split cut at a line boundary. That is an implementation detail and
//must not reach the editor as a table row made of a dozen one-character ops.
test('runs sharing the same attributes are merged, and never across a newline', function(){
  var ops = convertOne('<p>a<span>b</span><span>c</span></p><p>d</p>');

  assert.deepStrictEqual(ops, [
    { insert: 'abc' }, { insert: '\n' },
    { insert: 'd' }, { insert: '\n' }
  ]);
});

test('a document body with no text at all yields no stray ops', function(){
  assert.deepStrictEqual(convertOne('<div>   \n  </div><img src="x.png"/>'), []);
});

//An epub chapter is XHTML, parsed by the same entry point - self-closing tags and a namespace
//declaration must not change the result.
test('xhtml parses the same as html', function(){
  assert.deepStrictEqual(
    convertOne('<html xmlns="http://www.w3.org/1999/xhtml"><body>'
      + '<h2>Letter 4</h2><p><i>To Mrs. Saville, England.</i></p><br /></body></html>'),
    [
      { insert: 'Letter 4' }, { insert: '\n', attributes: { header: 2 } },
      { insert: 'To Mrs. Saville, England.', attributes: { italic: true } }, { insert: '\n' },
      { insert: '\n' }
    ]
  );
});
