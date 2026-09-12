const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const archiver = require('archiver');
const { JSDOM } = require('jsdom');

//epub-import.js and html-import.js both read `new DOMParser()` as a bare global. In the app this is
//supplied by Electron's renderer (window.DOMParser); tests supply the same API via jsdom, same as
//docx-import.test.js.
global.DOMParser = new JSDOM().window.DOMParser;

const errorLog = require('../src/components/controllers/error-log');
const { installBridge, uninstallBridge } = require('./fake-bridge');

test.before(function(){ installBridge(); });
test.after(uninstallBridge);

const epubImportPath = require.resolve('../src/components/controllers/epub-import');
const { parseEpub } = require(epubImportPath);

//epub-import.js destructures `logError` from error-log.js at require-time, so a test that mocks it
//must re-require the module for the fresh destructure to see it - same reasoning as
//docx-import.test.js and import.test.js.
function freshEpubImport(){
  delete require.cache[epubImportPath];
  return require(epubImportPath);
}

function textOf(delta){
  return delta.ops.map(function(op){
    return typeof op.insert === 'string' ? op.insert : '';
  }).join('');
}

function titles(book){
  return book.chapters.map(function(chapter){ return chapter.title; });
}

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------
//An epub is built here the way a real one is - container.xml pointing at an OPF in its own
//subdirectory, so every test exercises the relative-href resolution that is the most common epub
//reader bug rather than a flattened archive that would hide it.

function container(opfPath){
  return '<?xml version="1.0"?>'
    + '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
    + '<rootfiles><rootfile full-path="' + opfPath + '" media-type="application/oebps-package+xml"/>'
    + '</rootfiles></container>';
}

function opf(options){
  var opts = options || {};
  var items = (opts.manifest || []).map(function(item){
    return '<item id="' + item.id + '" href="' + item.href + '" media-type="'
      + (item.mediaType || 'application/xhtml+xml') + '"'
      + (item.properties ? ' properties="' + item.properties + '"' : '') + '/>';
  }).join('');

  var refs = (opts.spine || []).map(function(ref){
    return typeof ref === 'string'
      ? '<itemref idref="' + ref + '"/>'
      : '<itemref idref="' + ref.idref + '" linear="' + ref.linear + '"/>';
  }).join('');

  return '<?xml version="1.0"?>'
    + '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="db-id">'
    + '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
    + '<dc:title>' + (opts.title == null ? 'A Book' : opts.title) + '</dc:title>'
    + '<dc:creator>' + (opts.author == null ? 'An Author' : opts.author) + '</dc:creator>'
    + '</metadata>'
    + '<manifest>' + items + '</manifest>'
    + '<spine' + (opts.ncxId ? ' toc="' + opts.ncxId + '"' : '') + '>' + refs + '</spine>'
    + '</package>';
}

function ncx(navPoints){
  return '<?xml version="1.0"?>'
    + '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>'
    + navPoints.map(renderNavPoint).join('')
    + '</navMap></ncx>';
}

function renderNavPoint(point, i){
  return '<navPoint id="np-' + i + '" playOrder="' + (i + 1) + '">'
    + '<navLabel><text>' + point.label + '</text></navLabel>'
    + '<content src="' + point.src + '"/>'
    + (point.children || []).map(renderNavPoint).join('')
    + '</navPoint>';
}

function navDocument(links){
  return '<?xml version="1.0"?>'
    + '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>'
    + '<nav epub:type="landmarks"><ol><li><a href="chapter_1.xhtml">Start Reading</a></li></ol></nav>'
    + '<nav epub:type="toc"><ol>'
    + links.map(function(link){ return '<li><a href="' + link.href + '">' + link.label + '</a></li>'; }).join('')
    + '</ol></nav></body></html>';
}

function chapterXhtml(body, stylesheets){
  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>c</title>'
    + (stylesheets || []).map(function(href){
        return '<link href="' + href + '" rel="stylesheet" type="text/css"/>';
      }).join('')
    + '</head><body>' + body + '</body></html>';
}

//The ordinary book: one chapter per spine document, an ncx and a nav document that agree.
function simpleBook(overrides){
  var entries = {
    'META-INF/container.xml': container('OEBPS/content.opf'),
    'OEBPS/content.opf': opf({
      ncxId: 'ncx',
      manifest: [
        { id: 'ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml' },
        { id: 'nav', href: 'nav.xhtml', properties: 'nav' },
        { id: 'c1', href: 'text/chapter_1.xhtml' },
        { id: 'c2', href: 'text/chapter_2.xhtml' }
      ],
      spine: ['c1', 'c2']
    }),
    'OEBPS/toc.ncx': ncx([
      { label: 'The First', src: 'text/chapter_1.xhtml' },
      { label: 'The Second', src: 'text/chapter_2.xhtml' }
    ]),
    'OEBPS/nav.xhtml': navDocument([
      { href: 'text/chapter_1.xhtml', label: 'The First' },
      { href: 'text/chapter_2.xhtml', label: 'The Second' }
    ]),
    'OEBPS/text/chapter_1.xhtml': chapterXhtml('<h2>One</h2><p>First body.</p>'),
    'OEBPS/text/chapter_2.xhtml': chapterXhtml('<h2>Two</h2><p>Second body.</p>')
  };

  return Object.assign(entries, overrides || {});
}

// ---------------------------------------------------------------------------------------------
// The ordinary shape
// ---------------------------------------------------------------------------------------------

test('parseEpub reads the title and author out of the package metadata', function(){
  const book = parseEpub(simpleBook(), {});

  assert.deepStrictEqual(book.metadata, { title: 'A Book', author: 'An Author' });
});

test('parseEpub returns one chapter per document, titled from the table of contents', function(){
  const book = parseEpub(simpleBook(), {});

  assert.deepStrictEqual(titles(book), ['The First', 'The Second']);
  assert.strictEqual(textOf(book.chapters[0].delta), 'One\nFirst body.\n');
  assert.strictEqual(textOf(book.chapters[1].delta), 'Two\nSecond body.\n');
});

test('chapters come back in spine order, not in the order the archive lists them', function(){
  const entries = simpleBook();
  entries['OEBPS/content.opf'] = opf({
    ncxId: 'ncx',
    manifest: [
      { id: 'ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml' },
      { id: 'c1', href: 'text/chapter_1.xhtml' },
      { id: 'c2', href: 'text/chapter_2.xhtml' }
    ],
    spine: ['c2', 'c1']
  });

  assert.deepStrictEqual(titles(parseEpub(entries, {})), ['The Second', 'The First']);
});

//linear="no" marks something outside the reading order - a cover wrapper, a pop-up note.
test('a spine item marked linear="no" is not a chapter', function(){
  const entries = simpleBook();
  entries['OEBPS/content.opf'] = opf({
    ncxId: 'ncx',
    manifest: [
      { id: 'ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml' },
      { id: 'c1', href: 'text/chapter_1.xhtml' },
      { id: 'c2', href: 'text/chapter_2.xhtml' }
    ],
    spine: ['c1', { idref: 'c2', linear: 'no' }]
  });

  assert.deepStrictEqual(titles(parseEpub(entries, {})), ['The First']);
});

//A cover wrapper is one <img> and nothing else. It is in the spine of all three sample books and in
//the table of contents of none, and it converts to a chapter with no text in it.
test('a document that converts to no text at all is not a chapter', function(){
  const entries = simpleBook({
    'OEBPS/text/cover.xhtml': chapterXhtml('<div><img src="../cover.jpg" alt="Cover"/></div>')
  });
  entries['OEBPS/content.opf'] = opf({
    ncxId: 'ncx',
    manifest: [
      { id: 'ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml' },
      { id: 'cover', href: 'text/cover.xhtml' },
      { id: 'c1', href: 'text/chapter_1.xhtml' },
      { id: 'c2', href: 'text/chapter_2.xhtml' }
    ],
    spine: ['cover', 'c1', 'c2']
  });

  assert.deepStrictEqual(titles(parseEpub(entries, {})), ['The First', 'The Second']);
});

// ---------------------------------------------------------------------------------------------
// The spine is not a chapter list
// ---------------------------------------------------------------------------------------------
//The finding this whole importer is built around. Gutenberg's generator packs many chapters into one
//XHTML document - Moby-Dick's 141 chapters live in 11 documents, one holding 22 of them - so
//importing per spine item gives twelve 150KB chapters instead of a book. The table of contents holds
//the real boundaries as "doc.xhtml#anchor" fragments.

function packedBook(bodyHtml, navPoints){
  return {
    'META-INF/container.xml': container('OEBPS/content.opf'),
    'OEBPS/content.opf': opf({
      ncxId: 'ncx',
      manifest: [
        { id: 'ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml' },
        { id: 'packed', href: 'text/packed.xhtml' }
      ],
      spine: ['packed']
    }),
    'OEBPS/toc.ncx': ncx(navPoints),
    'OEBPS/text/packed.xhtml': chapterXhtml(bodyHtml)
  };
}

test('several table-of-contents entries in one document become several chapters', function(){
  const book = parseEpub(packedBook(
    '<div class="chapter" id="a"><h2>One</h2><p>first</p></div>'
      + '<div class="chapter" id="b"><h2>Two</h2><p>second</p></div>'
      + '<div class="chapter" id="c"><h2>Three</h2><p>third</p></div>',
    [
      { label: 'One', src: 'text/packed.xhtml#a' },
      { label: 'Two', src: 'text/packed.xhtml#b' },
      { label: 'Three', src: 'text/packed.xhtml#c' }
    ]), {});

  assert.deepStrictEqual(titles(book), ['One', 'Two', 'Three']);
  assert.deepStrictEqual(book.chapters.map(function(c){ return textOf(c.delta); }),
    ['One\nfirst\n', 'Two\nsecond\n', 'Three\nthird\n']);
});

//Frankenstein's title page is exactly this: two entries whose anchors sit inside a single <div>.
//Splitting by finding each anchor's top-level block would give them the same block and lose one.
test('entries whose anchors share one wrapper element still become separate chapters', function(){
  const book = parseEpub(packedBook(
    '<div><h1 id="t">Frankenstein;</h1><p>a novel</p>'
      + '<h3 id="s">or, the Modern Prometheus</h3><p>by Mary Shelley</p></div>',
    [
      { label: 'Frankenstein;', src: 'text/packed.xhtml#t' },
      { label: 'or, the Modern Prometheus', src: 'text/packed.xhtml#s' }
    ]), {});

  assert.deepStrictEqual(titles(book), ['Frankenstein;', 'or, the Modern Prometheus']);
  assert.deepStrictEqual(book.chapters.map(function(c){ return textOf(c.delta); }),
    ['Frankenstein;\na novel\n', 'or, the Modern Prometheus\nby Mary Shelley\n']);
});

//Content ahead of the first anchor is real content and becomes a chapter of its own, with no title
//because nothing named it. It also means the delta count no longer matches the entry count, which is
//why html-import.js reports which id each delta began at rather than this file counting.
test('content before the first anchor becomes an untitled leading chapter', function(){
  const book = parseEpub(packedBook(
    '<p>a note from the transcriber</p>'
      + '<div id="a"><h2>One</h2><p>first</p></div>'
      + '<div id="b"><h2>Two</h2><p>second</p></div>',
    [
      { label: 'One', src: 'text/packed.xhtml#a' },
      { label: 'Two', src: 'text/packed.xhtml#b' }
    ]), {});

  assert.deepStrictEqual(titles(book), ['', 'One', 'Two']);
  assert.strictEqual(textOf(book.chapters[0].delta), 'a note from the transcriber\n');
});

test('an anchor the document does not contain does not shift the titles of the ones that do', function(){
  const book = parseEpub(packedBook(
    '<div id="a"><h2>One</h2><p>first</p></div><div id="c"><h2>Three</h2><p>third</p></div>',
    [
      { label: 'One', src: 'text/packed.xhtml#a' },
      { label: 'Two', src: 'text/packed.xhtml#missing' },
      { label: 'Three', src: 'text/packed.xhtml#c' }
    ]), {});

  assert.deepStrictEqual(titles(book), ['One', 'Three']);
});

//navPoints nest, and a nested one is still a chapter - a writer can merge two chapters far more
//easily than find a boundary that was never made.
test('nested navPoints are flattened in document order', function(){
  const book = parseEpub(packedBook(
    '<div id="a"><h2>Part One</h2><p>x</p></div>'
      + '<div id="b"><h2>Chapter I</h2><p>y</p></div>'
      + '<div id="c"><h2>Chapter II</h2><p>z</p></div>',
    [
      { label: 'Part One', src: 'text/packed.xhtml#a', children: [
        { label: 'Chapter I', src: 'text/packed.xhtml#b' },
        { label: 'Chapter II', src: 'text/packed.xhtml#c' }
      ] }
    ]), {});

  assert.deepStrictEqual(titles(book), ['Part One', 'Chapter I', 'Chapter II']);
});

//A parent navPoint's own label and content come before its children in document order, so a
//descendant search happens to work - by accident of the element ordering. Direct children are read
//instead, and this is what says so.
test('a nested navPoint does not steal its parent label', function(){
  const book = parseEpub(packedBook(
    '<div id="a"><h2>Parent</h2><p>x</p></div><div id="b"><h2>Child</h2><p>y</p></div>',
    [
      { label: 'Parent', src: 'text/packed.xhtml#a', children: [
        { label: 'Child', src: 'text/packed.xhtml#b' }
      ] }
    ]), {});

  assert.strictEqual(book.chapters[0].title, 'Parent');
  assert.strictEqual(book.chapters[1].title, 'Child');
});

// ---------------------------------------------------------------------------------------------
// Hrefs, namespaces and stylesheets
// ---------------------------------------------------------------------------------------------

//Every href resolves against the file that named it, not the archive root: the OPF lives in OEBPS/
//so its hrefs need that prefix, and the ncx's hrefs resolve relative to the ncx. Getting this wrong
//is the most common epub reader bug and costs nothing to get right - which is why every fixture
//above puts the OPF in a subdirectory and the chapters in one below that.
test('hrefs resolve against the file that names them, through subdirectories and ".."', function(){
  const entries = {
    'META-INF/container.xml': container('OEBPS/package/content.opf'),
    'OEBPS/package/content.opf': opf({
      ncxId: 'ncx',
      manifest: [
        { id: 'ncx', href: '../nav/toc.ncx', mediaType: 'application/x-dtbncx+xml' },
        { id: 'c1', href: '../text/chapter_1.xhtml' }
      ],
      spine: ['c1']
    }),
    'OEBPS/nav/toc.ncx': ncx([{ label: 'Only', src: '../text/chapter_1.xhtml' }]),
    'OEBPS/text/chapter_1.xhtml': chapterXhtml('<p>body</p>')
  };

  assert.deepStrictEqual(titles(parseEpub(entries, {})), ['Only']);
});

test('a percent-escaped href resolves to the archive path it names', function(){
  const entries = {
    'META-INF/container.xml': container('OEBPS/content.opf'),
    'OEBPS/content.opf': opf({
      ncxId: 'ncx',
      manifest: [
        { id: 'ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml' },
        { id: 'c1', href: 'text/chapter%20one.xhtml' }
      ],
      spine: ['c1']
    }),
    'OEBPS/toc.ncx': ncx([{ label: 'Chapter One', src: 'text/chapter%20one.xhtml' }]),
    'OEBPS/text/chapter one.xhtml': chapterXhtml('<p>body</p>')
  };

  assert.deepStrictEqual(titles(parseEpub(entries, {})), ['Chapter One']);
});

//getElementsByTagName matches the *qualified* name in an XML document, so it finds <item> and misses
//<opf:item>. An epub may declare the OPF namespace with a prefix, without one, or not at all, and
//all three are the same book - so everything in the XML parts is found by local name.
test('a package document using namespace prefixes reads the same as one without', function(){
  const entries = {
    'META-INF/container.xml':
      '<?xml version="1.0"?>'
      + '<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">'
      + '<ocf:rootfiles><ocf:rootfile full-path="OEBPS/content.opf"/></ocf:rootfiles></ocf:container>',
    'OEBPS/content.opf':
      '<?xml version="1.0"?>'
      + '<opf:package xmlns:opf="http://www.idpf.org/2007/opf" version="3.0">'
      + '<opf:metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
      + '<dc:title>Prefixed</dc:title><dc:creator>Someone</dc:creator></opf:metadata>'
      + '<opf:manifest>'
      + '<opf:item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'
      + '<opf:item id="c1" href="chapter_1.xhtml" media-type="application/xhtml+xml"/>'
      + '</opf:manifest>'
      + '<opf:spine toc="ncx"><opf:itemref idref="c1"/></opf:spine></opf:package>',
    'OEBPS/toc.ncx': ncx([{ label: 'Only', src: 'chapter_1.xhtml' }]),
    'OEBPS/chapter_1.xhtml': chapterXhtml('<p>body</p>')
  };

  const book = parseEpub(entries, {});

  assert.deepStrictEqual(book.metadata, { title: 'Prefixed', author: 'Someone' });
  assert.deepStrictEqual(titles(book), ['Only']);
});

//The one finding from building the platform command that changed the converter. An epub chapter has
//no <style> block - it links its CSS - so without passing the linked sheets through, every
//class-driven italic in the book resolves to nothing.
test('a linked stylesheet is applied to the chapter that links it', function(){
  const entries = simpleBook({
    'OEBPS/styles/book.css': '.whisper { font-style: italic } .shout { font-weight: bold }',
    'OEBPS/text/chapter_1.xhtml': chapterXhtml(
      '<p><span class="whisper">quiet</span> and <span class="shout">loud</span></p>',
      ['../styles/book.css'])
  });

  assert.deepStrictEqual(parseEpub(entries, {}).chapters[0].delta.ops, [
    { insert: 'quiet', attributes: { italic: true } },
    { insert: ' and ' },
    { insert: 'loud', attributes: { bold: true } },
    { insert: '\n' }
  ]);
});

test('a chapter linking a stylesheet that is not in the archive still imports', function(){
  const entries = simpleBook({
    'OEBPS/text/chapter_1.xhtml': chapterXhtml('<p>body</p>', ['../styles/missing.css'])
  });

  assert.strictEqual(textOf(parseEpub(entries, {}).chapters[0].delta), 'body\n');
});

test('a non-stylesheet link is not read as CSS', function(){
  const entries = simpleBook({
    'OEBPS/cover.jpg': 'NOT CSS AT ALL',
    'OEBPS/text/chapter_1.xhtml':
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head>'
      + '<link href="../cover.jpg" rel="icon" type="image/x-cover"/>'
      + '</head><body><p>body</p></body></html>'
  });

  assert.strictEqual(textOf(parseEpub(entries, {}).chapters[0].delta), 'body\n');
});

// ---------------------------------------------------------------------------------------------
// Which table of contents
// ---------------------------------------------------------------------------------------------

//An EPUB 3 book carries a nav document, an EPUB 2 one carries toc.ncx, and a book built for both
//carries each. The nav document is preferred, which is the order the spec puts them in.
test('the nav document is preferred over the ncx when both are present', function(){
  const entries = simpleBook({
    'OEBPS/nav.xhtml': navDocument([
      { href: 'text/chapter_1.xhtml', label: 'From The Nav' },
      { href: 'text/chapter_2.xhtml', label: 'Also From The Nav' }
    ])
  });

  assert.deepStrictEqual(titles(parseEpub(entries, {})), ['From The Nav', 'Also From The Nav']);
});

test('the ncx is used when there is no nav document', function(){
  const entries = simpleBook();
  delete entries['OEBPS/nav.xhtml'];

  assert.deepStrictEqual(titles(parseEpub(entries, {})), ['The First', 'The Second']);
});

//A nav document also carries landmarks and a page list, which are not chapter lists.
test('only the toc nav is read, not the landmarks nav beside it', function(){
  const book = parseEpub(simpleBook(), {});

  assert.ok(titles(book).indexOf('Start Reading') < 0, 'a landmarks entry became a chapter');
  assert.strictEqual(book.chapters.length, 2);
});

//A nav document is often in the spine as well as the manifest - WareWoolf's own exporter puts its
//generated contents page there, and it is legal and common elsewhere. It is navigation by the
//manifest's own declaration, so importing a list of links to the other chapters would be noise.
test('the navigation document is not imported as a chapter, even when the spine lists it', function(){
  const entries = simpleBook();
  entries['OEBPS/content.opf'] = opf({
    ncxId: 'ncx',
    manifest: [
      { id: 'ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml' },
      { id: 'nav', href: 'nav.xhtml', properties: 'nav' },
      { id: 'c1', href: 'text/chapter_1.xhtml' },
      { id: 'c2', href: 'text/chapter_2.xhtml' }
    ],
    spine: ['nav', 'c1', 'c2']
  });

  assert.deepStrictEqual(titles(parseEpub(entries, {})), ['The First', 'The Second']);
});

//A contents page the writer put in the prose is a different thing from the one the manifest points
//at, and still imports - Project Gutenberg's books carry exactly such a page.
test('a contents page written into the prose is still a chapter', function(){
  const entries = simpleBook({
    'OEBPS/text/chapter_1.xhtml': chapterXhtml('<h2>CONTENTS</h2><ul><li>One</li><li>Two</li></ul>')
  });

  assert.deepStrictEqual(titles(parseEpub(entries, {})), ['The First', 'The Second']);
  assert.strictEqual(textOf(parseEpub(entries, {}).chapters[0].delta), 'CONTENTS\nOne\nTwo\n');
});

//Without a table of contents there is nothing to name the chapters, but the spine still says what
//the documents are and in what order - one chapter each, untitled, is strictly better than nothing.
test('a book with no table of contents falls back to one chapter per spine document', function(){
  const entries = simpleBook();
  delete entries['OEBPS/nav.xhtml'];
  delete entries['OEBPS/toc.ncx'];

  const book = parseEpub(entries, {});

  assert.deepStrictEqual(titles(book), ['', '']);
  assert.strictEqual(textOf(book.chapters[0].delta), 'One\nFirst body.\n');
});

//A table of contents naming a document the spine leaves out is still the best available answer for
//a book whose spine is incomplete - it is followed, after everything the spine does list.
test('a document named only by the table of contents is still imported', function(){
  const entries = simpleBook({
    'OEBPS/text/extra.xhtml': chapterXhtml('<h2>Extra</h2><p>orphan</p>')
  });
  entries['OEBPS/toc.ncx'] = ncx([
    { label: 'The First', src: 'text/chapter_1.xhtml' },
    { label: 'The Second', src: 'text/chapter_2.xhtml' },
    { label: 'The Extra', src: 'text/extra.xhtml' }
  ]);
  delete entries['OEBPS/nav.xhtml'];

  assert.deepStrictEqual(titles(parseEpub(entries, {})), ['The First', 'The Second', 'The Extra']);
});

// ---------------------------------------------------------------------------------------------
// Options and failure
// ---------------------------------------------------------------------------------------------

//An epub keeps its Gutenberg licence header and footer in documents of their own, which the table of
//contents does not name - so with the option on they trim to nothing and drop out as textless.
test('boilerplate stripping removes the licence documents entirely', function(){
  const entries = simpleBook({
    'OEBPS/text/front.xhtml': chapterXhtml(
      '<p>licence blurb</p><p>*** START OF THE PROJECT GUTENBERG EBOOK A BOOK ***</p>')
  });
  entries['OEBPS/content.opf'] = opf({
    ncxId: 'ncx',
    manifest: [
      { id: 'ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml' },
      { id: 'front', href: 'text/front.xhtml' },
      { id: 'c1', href: 'text/chapter_1.xhtml' },
      { id: 'c2', href: 'text/chapter_2.xhtml' }
    ],
    spine: ['front', 'c1', 'c2']
  });
  delete entries['OEBPS/nav.xhtml'];

  assert.strictEqual(parseEpub(entries, {}).chapters.length, 3);
  assert.deepStrictEqual(titles(parseEpub(entries, { stripBoilerplate: true })),
    ['The First', 'The Second']);
});

test('parseEpub tolerates being called with no options at all', function(){
  assert.deepStrictEqual(titles(parseEpub(simpleBook())), ['The First', 'The Second']);
});

test('an archive with no container.xml comes back as an empty book, logged', function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  const { parseEpub: fresh } = freshEpubImport();

  const book = fresh({ 'notes.txt': 'not a book' }, {});

  assert.deepStrictEqual(book, { metadata: { title: '', author: '' }, chapters: [] });
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

test('a malformed package document comes back as an empty book, logged', function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  const { parseEpub: fresh } = freshEpubImport();

  const book = fresh({
    'META-INF/container.xml': container('OEBPS/content.opf'),
    'OEBPS/content.opf': '<package><manifest></package>'
  }, {});

  assert.deepStrictEqual(book.chapters, []);
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

test('a container naming a package document that is not in the archive is an empty book', function(t){
  t.mock.method(errorLog, 'logError', function(){});
  const { parseEpub: fresh } = freshEpubImport();

  assert.deepStrictEqual(fresh({ 'META-INF/container.xml': container('OEBPS/gone.opf') }, {}).chapters, []);
});

test('a table of contents entry pointing at a document that is not there is skipped', function(){
  const entries = simpleBook();
  entries['OEBPS/toc.ncx'] = ncx([
    { label: 'The First', src: 'text/chapter_1.xhtml' },
    { label: 'Missing', src: 'text/gone.xhtml' },
    { label: 'The Second', src: 'text/chapter_2.xhtml' }
  ]);
  delete entries['OEBPS/nav.xhtml'];

  assert.deepStrictEqual(titles(parseEpub(entries, {})), ['The First', 'The Second']);
});

test('parseEpub returns an empty book rather than throwing for no entries at all', function(t){
  t.mock.method(errorLog, 'logError', function(){});
  const { parseEpub: fresh } = freshEpubImport();

  assert.deepStrictEqual(fresh(null, {}), { metadata: { title: '', author: '' }, chapters: [] });
  assert.deepStrictEqual(fresh({}, {}).chapters, []);
});

// ---------------------------------------------------------------------------------------------
// Round trip against WareWoolf's own exporter
// ---------------------------------------------------------------------------------------------
//epub.js builds a book out of mdfc-to-html.js's output, so an epub WareWoolf exported should import
//back with its formatting intact. That makes this a regression test on both halves at once - the
//exporter and the importer have to keep agreeing about the same file format, and neither one's tests
//would notice the two drifting apart on their own.

const { assembleEpubEntries } = require('../src/components/controllers/epub');
const { convertMdfcToHtml } = require('../src/components/controllers/mdfc-to-html');
const { convertDeltaToMDF } = require('../src/components/controllers/markdownFic');

//assembleEpubEntries hands back the same { name, content } pairs it would zip, so the round trip
//needs no archive at all - the entries map is exactly what importEpub would have returned.
function exportedEntries(title, author, chapters){
  const htmlChapters = chapters.map(function(chapter){
    return { title: chapter.title, html: convertMdfcToHtml(convertDeltaToMDF(chapter.delta)) };
  });

  const entries = {};
  assembleEpubEntries(title, author, htmlChapters, false).forEach(function(entry){
    entries[entry.name] = entry.content;
  });

  return entries;
}

test('an epub WareWoolf exported imports back with its chapters and formatting intact', function(){
  const chapters = [
    { title: 'One', delta: { ops: [
      { insert: 'One' }, { insert: '\n', attributes: { header: 1 } },
      { insert: 'Plain, ' },
      { insert: 'italic', attributes: { italic: true } },
      { insert: ', ' },
      { insert: 'bold', attributes: { bold: true } },
      { insert: '.' }, { insert: '\n' }
    ] } },
    { title: 'Two', delta: { ops: [
      { insert: 'Two' }, { insert: '\n', attributes: { header: 1 } },
      { insert: 'Centred.' }, { insert: '\n', attributes: { align: 'center' } },
      { insert: 'Quoted.' }, { insert: '\n', attributes: { blockquote: true } }
    ] } }
  ];

  const book = parseEpub(exportedEntries('My Novel', 'Me', chapters), {});
  //The exporter puts its generated contents page in the spine as well as the manifest. It is
  //navigation by the manifest's own declaration, so it is not imported as a chapter - which is what
  //makes this list the manuscript's chapters and nothing else.
  const imported = book.chapters;

  assert.deepStrictEqual(book.metadata, { title: 'My Novel', author: 'Me' });
  assert.deepStrictEqual(imported.map(function(c){ return c.title; }), ['One', 'Two']);

  assert.deepStrictEqual(imported[0].delta.ops, [
    { insert: 'One' }, { insert: '\n', attributes: { header: 1 } },
    { insert: 'Plain, ' },
    { insert: 'italic', attributes: { italic: true } },
    { insert: ', ' },
    { insert: 'bold', attributes: { bold: true } },
    { insert: '.' }, { insert: '\n' }
  ]);

  assert.deepStrictEqual(imported[1].delta.ops, [
    { insert: 'Two' }, { insert: '\n', attributes: { header: 1 } },
    { insert: 'Centred.' }, { insert: '\n', attributes: { align: 'center' } },
    { insert: 'Quoted.' }, { insert: '\n', attributes: { blockquote: true } }
  ]);
});

test('a round-tripped chapter keeps its lists and their nesting', function(){
  const chapters = [{ title: 'List', delta: { ops: [
    { insert: 'one' }, { insert: '\n', attributes: { list: 'bullet' } },
    { insert: 'two' }, { insert: '\n', attributes: { list: 'bullet', indent: 1 } },
    { insert: 'three' }, { insert: '\n', attributes: { list: 'ordered' } }
  ] } }];

  const book = parseEpub(exportedEntries('L', 'A', chapters), {});

  assert.deepStrictEqual(book.chapters.length, 1);
  assert.deepStrictEqual(book.chapters[0].delta.ops, [
    { insert: 'one' }, { insert: '\n', attributes: { list: 'bullet' } },
    { insert: 'two' }, { insert: '\n', attributes: { list: 'bullet', indent: 1 } },
    { insert: 'three' }, { insert: '\n', attributes: { list: 'ordered' } }
  ]);
});

// ---------------------------------------------------------------------------------------------
// Through the platform command
// ---------------------------------------------------------------------------------------------
//The module holds its own createPlatform(createIpcBacking()) instance and reaches the machine
//through window.warewoolf, exactly as it does in the app - so these build a real .epub on disk and
//read it back across a real structured-clone boundary.

function buildEpubFile(destPath, entries){
  return new Promise(function(resolve, reject){
    const output = fs.createWriteStream(destPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', function(){ resolve(destPath); });
    archive.on('error', reject);

    archive.pipe(output);
    archive.append('application/epub+zip', { name: 'mimetype' });
    Object.keys(entries).forEach(function(name){
      archive.append(entries[name], { name: name });
    });
    archive.finalize();
  });
}

function tempDir(){
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-epub-import-'));
}

test('importEpub reads an epub off disk and hands back its chapters', async function(){
  const { importEpub } = freshEpubImport();
  const file = path.join(tempDir(), 'book.epub').replaceAll('\\', '/');
  await buildEpubFile(file, simpleBook());

  const book = await new Promise(function(resolve){
    importEpub(file, {}, resolve);
  });

  assert.deepStrictEqual(book.metadata, { title: 'A Book', author: 'An Author' });
  assert.deepStrictEqual(titles(book), ['The First', 'The Second']);
  assert.strictEqual(textOf(book.chapters[0].delta), 'One\nFirst body.\n');
});

//Same policy every other importer applies: a read failure is logged and reported as nothing imported
//rather than thrown, so the rest of a multi-file import keeps going.
test('importEpub logs and reports an empty book for a file that is not there', { timeout: 5000 }, async function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  const { importEpub } = freshEpubImport();
  const missing = path.join(tempDir(), 'nope.epub').replaceAll('\\', '/');

  const book = await new Promise(function(resolve){
    importEpub(missing, {}, resolve);
  });

  assert.deepStrictEqual(book, { metadata: { title: '', author: '' }, chapters: [] });
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});
