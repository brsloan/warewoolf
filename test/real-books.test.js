const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JSDOM } = require('jsdom');

//html-import.js and epub-import.js read `new DOMParser()` as a bare global. In the app this is
//supplied by Electron's renderer (window.DOMParser); tests supply the same API via jsdom.
global.DOMParser = new JSDOM().window.DOMParser;

const errorLog = require('../src/components/controllers/error-log');
const { convertHtmlToDelta } = require('../src/components/controllers/html-import');
const { parseEpub } = require('../src/components/controllers/epub-import');
const { createPlatform } = require('../src/components/controllers/platform');
const { createNodeBacking } = require('../src/components/controllers/platform-node');

//Three Project Gutenberg titles, each in both formats the importer reads. See
//fixtures/books/README.md for why they are worth their size and why they live under test/.
//
//Every other test file here builds its own small fixture inline, which is the right way to pin one
//behaviour at a time. These are the opposite and the complement: whole real books, asserted on as
//wholes. Most of what went wrong while the two importers were being written was found this way -
//a stylesheet rule nobody would think to write into a fixture, a table of contents that disagrees
//with the spine - and a synthetic fixture only ever contains what its author thought to put in it.
const BOOKS = path.join(__dirname, 'fixtures', 'books');

function bookPath(name){
  return path.join(BOOKS, name).replaceAll('\\', '/');
}

test.before(function(){
  errorLog.setPlatform(createPlatform(createNodeBacking({
    paths: { userData: fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-real-books-')) }
  })));
});

const platform = createPlatform(createNodeBacking({ paths: { userData: os.tmpdir() } }));

//Each book is converted once and shared. Moby-Dick alone is 1.4MB of HTML and 145 chapters of
//EPUB; converting it per assertion would put seconds on the suite for no extra coverage.
const converted = {};

function fromHtml(name){
  var key = name + '.html';
  if(!converted[key]){
    converted[key] = convertHtmlToDelta(fs.readFileSync(bookPath(name + '.html'), 'utf8'), {
      splitChapters: { headingLevel: 2 },
      stripBoilerplate: true
    });
  }
  return converted[key];
}

async function fromEpub(name){
  var key = name + '.epub';
  if(!converted[key]){
    const result = await platform.importEpub({ path: bookPath(name + '.epub') });
    converted[key] = { entries: result.entries, book: parseEpub(result.entries, { stripBoilerplate: true }) };
  }
  return converted[key];
}

function countAttribute(deltas, attribute){
  var found = 0;

  deltas.forEach(function(delta){
    (delta.ops || delta.delta.ops).forEach(function(op){
      if(op.attributes && op.attributes[attribute])
        found++;
    });
  });

  return found;
}

function textOf(delta){
  return (delta.ops || delta.delta.ops).map(function(op){
    return typeof op.insert === 'string' ? op.insert : '';
  }).join('');
}

// ---------------------------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------------------------

//Exact counts rather than "more than zero". The fixtures are committed and frozen, so these can be
//exact - and an importer that quietly starts producing 138 chapters where it produced 140 is
//exactly the kind of regression a range would let through.
const HTML_EXPECTED = {
  'Frankenstein': { chapters: 31, headings: 32, italics: 42 },
  'Moby-Dick': { chapters: 140, headings: 148, italics: 392 },
  'WutheringHeights': { chapters: 36, headings: 36, italics: 297 }
};

Object.keys(HTML_EXPECTED).forEach(function(name){
  const expected = HTML_EXPECTED[name];

  test(name + ' (HTML) splits into its chapters and keeps its emphasis', function(){
    const deltas = fromHtml(name);

    assert.strictEqual(deltas.length, expected.chapters, 'chapter count');
    assert.strictEqual(countAttribute(deltas, 'header'), expected.headings, 'headings');
    assert.strictEqual(countAttribute(deltas, 'italic'), expected.italics, 'italic runs');
  });

  test(name + ' (HTML) comes in with no boilerplate and no stray whitespace', function(){
    const deltas = fromHtml(name);
    const whole = deltas.map(textOf).join('');

    assert.ok(!/START OF THE PROJECT GUTENBERG/i.test(whole), 'the licence header survived');
    assert.ok(!/END OF THE PROJECT GUTENBERG/i.test(whole), 'the licence footer survived');

    //Gutenberg writes its prose one wrapped source line per line inside a <p> that opens and closes
    //on lines of its own, so missing HTML's block-edge whitespace rule puts a stray space on both
    //ends of every paragraph in the book.
    //
    //The plain space only, never String.trim(): that also strips U+00A0, and a non-breaking space is
    //content the transcriber typed rather than layout whitespace. Frankenstein's poems are indented
    //with four of them, and they are supposed to survive.
    //
    //Preformatted text is the other legitimate exception - Moby-Dick quotes verse inside <pre>,
    //where the indentation is the point. So rather than exempting whole books, every line that did
    //keep its edge whitespace has to be traceable to a <pre> block in the source.
    const source = fs.readFileSync(bookPath(name + '.html'), 'utf8');
    //Tags stripped, because a preformatted line can carry inline markup of its own -
    //"—<i>The Fairie Queen</i>." reaches the delta as "—The Fairie Queen." and has to be
    //recognisable as the same line.
    const preformatted = (source.match(/<pre[\s\S]*?<\/pre>/gi) || [])
      .join('\n')
      .replace(/<[^>]*>/g, '');

    const unexplained = whole.split('\n').filter(function(line){
      return /^ | $/.test(line) && preformatted.indexOf(line.replace(/^ +| +$/g, '')) < 0;
    });

    assert.deepStrictEqual(unexplained.slice(0, 3), [],
      'lines that kept edge whitespace without coming from a <pre>');
  });
});

//Gutenberg's stylesheet opens with `body { text-align: justify }` and carries
//`a { text-decoration: underline }`. Read literally, the first puts an alignment attribute on all
//766 paragraphs of Frankenstein and the second underlines every link in every book - and both were
//doing exactly that until the importer learned to read the document's own baseline.
test('a document-wide alignment or link underline does not become a per-paragraph attribute', function(){
  const frankenstein = fromHtml('Frankenstein');

  assert.strictEqual(countAttribute(frankenstein, 'underline'), 0, 'link underlines leaked in');
  assert.ok(countAttribute(frankenstein, 'align') < 100,
    'the body alignment is being written onto every paragraph');
});

//Every attribute the importer emits has to be one the editor is configured to hold - see the
//`formats` list in render.js. An attribute outside it is silently dropped by Quill on load, so the
//writer loses formatting the importer thought it had preserved, with nothing to say so.
const SUPPORTED_FORMATS = {
  bold: true, italic: true, strike: true, underline: true, blockquote: true,
  header: true, align: true, list: true, indent: true,
  footnote: true, footnoteBody: true, footnoteBodyCont: true
};

test('no import invents an attribute the editor is not configured to hold', function(){
  const seen = {};

  Object.keys(HTML_EXPECTED).forEach(function(name){
    fromHtml(name).forEach(function(delta){
      delta.ops.forEach(function(op){
        if(op.attributes)
          Object.keys(op.attributes).forEach(function(key){ seen[key] = true; });
      });
    });
  });

  const unsupported = Object.keys(seen).filter(function(key){ return !SUPPORTED_FORMATS[key]; });
  assert.deepStrictEqual(unsupported, [], 'attributes the editor would drop on load');
});

// ---------------------------------------------------------------------------------------------
// EPUB
// ---------------------------------------------------------------------------------------------

const EPUB_EXPECTED = {
  'Frankenstein': {
    chapters: 31, italics: 42,
    title: 'Frankenstein; or, the modern prometheus', author: 'Mary Wollstonecraft Shelley',
    first: 'Frankenstein;', last: 'Chapter 24'
  },
  'Moby-Dick': {
    chapters: 145, italics: 392,
    title: 'Moby Dick; Or, The Whale', author: 'Herman Melville',
    first: 'MOBY-DICK; or, THE WHALE.', last: '“AND I ONLY AM ESCAPED ALONE TO TELL THEE” Job.'
  },
  'WutheringHeights': {
    chapters: 35, italics: 297,
    title: 'Wuthering Heights', author: 'Emily Brontë',
    first: 'Wuthering Heights', last: 'CHAPTER XXXIV'
  }
};

Object.keys(EPUB_EXPECTED).forEach(function(name){
  const expected = EPUB_EXPECTED[name];

  test(name + ' (EPUB) imports its chapters, titled by the book itself', async function(){
    const { book } = await fromEpub(name);

    assert.strictEqual(book.chapters.length, expected.chapters, 'chapter count');
    assert.strictEqual(countAttribute(book.chapters, 'italic'), expected.italics, 'italic runs');
    assert.deepStrictEqual(book.metadata, { title: expected.title, author: expected.author });
    assert.strictEqual(book.chapters[0].title, expected.first);
    assert.strictEqual(book.chapters[book.chapters.length - 1].title, expected.last);

    //Every chapter named. An untitled one means a table-of-contents entry was not paired with the
    //delta it produced, which is the failure mode the splitId reporting exists to prevent.
    const untitled = book.chapters.filter(function(chapter){ return !chapter.title; });
    assert.strictEqual(untitled.length, 0, 'chapters the table of contents did not name');
  });
});

//The finding the whole EPUB importer is built around, on the book that shows it: importing per
//spine item would give twelve 150KB chapters instead of a novel.
test('Moby-Dick proves the spine is not a chapter list', async function(){
  const { entries, book } = await fromEpub('Moby-Dick');

  const documents = Object.keys(entries).filter(function(name){ return name.endsWith('.xhtml'); });
  assert.ok(documents.length < 20, 'expected the chapters to be packed into few documents');
  assert.ok(book.chapters.length > 100,
    'the table of contents, not the spine, has to be what decides the chapters');
});

//The enforcement point for "images are stripped": a cover jpeg is skipped before its bytes are ever
//read. And its opposite - stylesheets must come through, because an epub links its CSS rather than
//inlining it, so dropping them would resolve every class-driven italic in the book to nothing.
test('an epub hands over its stylesheets and none of its binary parts', async function(){
  for(const name of Object.keys(EPUB_EXPECTED)){
    const { entries } = await fromEpub(name);
    const names = Object.keys(entries);

    const binary = names.filter(function(entry){
      return /\.(?:jpg|jpeg|png|gif|svg|otf|ttf|woff2?|mp3|mp4)$/i.test(entry);
    });

    assert.deepStrictEqual(binary, [], name + ' returned binary entries');
    assert.ok(names.some(function(entry){ return entry.endsWith('.css'); }),
      name + ' returned no stylesheets');
  }
});

// ---------------------------------------------------------------------------------------------
// The two importers against each other
// ---------------------------------------------------------------------------------------------

//The assertion these fixtures exist for, and the one no hand-written fixture can make. The HTML and
//the EPUB edition of a book are the same text reached by completely different routes - one reads a
//single document with an inline <style> block, the other reads a zip of XHTML with linked
//stylesheets and a table of contents - so the emphasis in them has to come out the same. It was
//this comparison that showed the epub path was losing every class-driven italic before
//`extraCss` existed, because the counts did not line up.
test('the HTML and EPUB editions of a book yield the same emphasis', async function(){
  for(const name of Object.keys(EPUB_EXPECTED)){
    const { book } = await fromEpub(name);

    assert.strictEqual(
      countAttribute(book.chapters, 'italic'),
      countAttribute(fromHtml(name), 'italic'),
      name + ': the two importers disagree about how much of it is italic');
  }
});
