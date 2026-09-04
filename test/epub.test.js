const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const unzipper = require('unzipper');

const { htmlChaptersToEpub } = require('../src/components/controllers/epub');

//htmlChaptersToEpub writes to disk and reports completion through a callback, so tests need to
//drive it as a promise. unzipper reads entry contents lazily on demand, so the file has to stay
//on disk for as long as the test still calls readEntry() - clean it up via t.after() instead of
//deleting it before the test is done with it.
async function buildEpub(t, title, author, htmlChapters, insertTitlePage){
  const filepath = path.join(os.tmpdir(), 'epub-test-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.epub');
  t.after(function(){
    fs.unlinkSync(filepath);
  });

  const result = await new Promise(function(resolve){
    htmlChaptersToEpub(title, author, htmlChapters, filepath, insertTitlePage, resolve);
  });

  assert.notStrictEqual(result, 'error', 'epub generation reported an error');

  const dir = await unzipper.Open.file(filepath);
  const readEntry = async function(entryPath){
    const entry = dir.files.find(f => f.path === entryPath);
    assert.ok(entry, 'missing zip entry: ' + entryPath);
    return (await entry.buffer()).toString('utf8');
  };

  return { dir, readEntry };
}

//No entity beyond the five built-in XML ones (&amp; &lt; &gt; &quot; &apos;) is legal in XML, so a
//bare "&" is the most common way author-supplied text breaks EPUB well-formedness. This is a cheap
//proxy for "well-formed enough" without pulling in a full XML parser as a test dependency.
function assertNoBareAmpersands(xml, label){
  const bareAmpersand = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;
  assert.ok(!bareAmpersand.test(xml), label + ' contains an unescaped "&"');
}

test('title, author and chapter titles are escaped in content.opf, toc.ncx and toc.xhtml', async function(t){
  const { readEntry } = await buildEpub(
    t,
    'My "Title" & Book',
    'Author & Co',
    [{ title: 'Marks & Spencer <Ch. 1>', html: '<p>Body</p>' }],
    false
  );

  const opf = await readEntry('OEBPS/content.opf');
  assert.match(opf, /<dc:title id="t1">My &quot;Title&quot; &amp; Book<\/dc:title>/);
  assert.match(opf, /<dc:creator id="creator">Author &amp; Co<\/dc:creator>/);

  const ncx = await readEntry('OEBPS/toc.ncx');
  assert.match(ncx, /<text>Marks &amp; Spencer &lt;Ch\. 1&gt;<\/text>/);

  const toc = await readEntry('OEBPS/toc.xhtml');
  assert.match(toc, /<a href="chapter_1\.xhtml">Marks &amp; Spencer &lt;Ch\. 1&gt;<\/a>/);

  assertNoBareAmpersands(opf, 'content.opf');
  assertNoBareAmpersands(ncx, 'toc.ncx');
  assertNoBareAmpersands(toc, 'toc.xhtml');
});

test('a bare ampersand in chapter prose is escaped without mangling generated markup or double-escaping existing entities', async function(t){
  const { readEntry } = await buildEpub(
    t,
    'Title',
    'Author',
    [{ title: 'One', html: '<p>Tom &amp; Jerry went to Marks & Spencer &copy; today.</p>' }],
    false
  );

  const chapter = await readEntry('OEBPS/chapter_1.xhtml');
  assert.match(chapter, /<p>Tom &amp; Jerry went to Marks &amp; Spencer &amp;copy; today\.<\/p>/);
  assert.match(chapter, /<p>[\s\S]*<\/p>/, 'chapter markup survived');
  assertNoBareAmpersands(chapter, 'chapter_1.xhtml');
});

test('title page generated from title/author is also escaped', async function(t){
  const { readEntry } = await buildEpub(
    t,
    'A & B',
    'C & D',
    [{ title: 'One', html: '<p>Body</p>' }],
    true
  );

  //insertTitlePage unshifts a synthetic chapter, so the title page ends up as chapter_1
  const titlePage = await readEntry('OEBPS/chapter_1.xhtml');
  assert.match(titlePage, /<h1 class="center title">A &amp; B<\/h1>/);
  assert.match(titlePage, /<h2 class="center">by C &amp; D<\/h2>/);
});

test('mimetype is the first zip entry and is stored uncompressed', async function(t){
  const { dir } = await buildEpub(t, 'Title', 'Author', [{ title: 'One', html: '<p>Body</p>' }], false);

  assert.strictEqual(dir.files[0].path, 'mimetype');
  assert.strictEqual(dir.files[0].compressionMethod, 0, 'mimetype must be STORED, not deflated');
});

test('toc.ncx head declares totalPageCount and maxPageNumber alongside uid and depth', async function(t){
  const { readEntry } = await buildEpub(t, 'Title', 'Author', [{ title: 'One', html: '<p>Body</p>' }], false);

  const ncx = await readEntry('OEBPS/toc.ncx');
  assert.match(ncx, /<meta name="dtb:uid" content="[^"]+"\/>/);
  assert.match(ncx, /<meta name="dtb:depth" content="1"\/>/);
  assert.match(ncx, /<meta name="dtb:totalPageCount" content="0"\/>/);
  assert.match(ncx, /<meta name="dtb:maxPageNumber" content="0"\/>/);
});

test('callback fires only once the epub file is fully readable on disk', async function(t){
  //Regression: the completion callback used to fire on archiver's 'finish' event, which only means
  //archiver pushed its last bytes into the pipe, not that fs flushed them to disk. If the callback
  //fires early, the file this test unzips would be truncated and unzipper would throw.
  const { dir } = await buildEpub(t, 'Title', 'Author', [{ title: 'One', html: '<p>Body</p>' }], false);
  assert.ok(dir.files.length > 0);
});

test('stray "<" and ">" typed as prose are escaped without mangling generated markup', async function(t){
  //Regression: only bare "&" was escaped in chapter prose. A literal "<"/">" typed by the author
  //(a comparison, an emoticon, a name in angle brackets) broke XHTML well-formedness the same way,
  //but silently - the generated markup itself uses "<"/">" legitimately, so it can't be escaped
  //wholesale.
  const chapterHtml =
    '<h1 class="center">Chapter 1</h1>' +
    '<p>5 < 3 is false, and 3 > 5 is also false.</p>' +
    '<p><b>Bold</b>, <i>italic</i>, <u>underline</u> and <del>strike</del> survive.</p>' +
    '<ul><li class="ul">First</li><li class="ul">Second</li></ul>' +
    '<blockquote>A quote with a stray < in it.</blockquote>' +
    '<p>See<sup><a href="#fnote_1" id="fnoteRef_1">1</a></sup> the note.</p>' +
    '<div class="footnote" id="fnote_1"></div>' +
    '<p><sup><a href="#fnoteRef_1">1</a></sup> The note text with <3 in it.</p>';

  const { readEntry } = await buildEpub(t, 'Title', 'Author', [{ title: 'One', html: chapterHtml }], false);
  const chapter = await readEntry('OEBPS/chapter_1.xhtml');

  //stray angle brackets in prose are escaped
  assert.match(chapter, /5 &lt; 3 is false, and 3 &gt; 5 is also false\./);
  assert.match(chapter, /A quote with a stray &lt; in it\./);
  assert.match(chapter, /The note text with &lt;3 in it\./);

  //generated markup survives untouched
  assert.match(chapter, /<h1 class="center">Chapter 1<\/h1>/);
  assert.match(chapter, /<b>Bold<\/b>, <i>italic<\/i>, <u>underline<\/u> and <del>strike<\/del> survive\./);
  assert.match(chapter, /<ul><li class="ul">First<\/li><li class="ul">Second<\/li><\/ul>/);
  assert.match(chapter, /<blockquote>A quote/);
  assert.match(chapter, /<sup><a href="#fnote_1" id="fnoteRef_1">1<\/a><\/sup>/);
  assert.match(chapter, /<div class="footnote" id="fnote_1"><\/div>/);
  assert.match(chapter, /<sup><a href="#fnoteRef_1">1<\/a><\/sup>/);
});

test('insertTitlePage does not mutate the caller\'s htmlChapters array', async function(t){
  //Regression: insertTitlePage used to Array.prototype.unshift() the title page directly onto the
  //caller's array. Every current caller happens to build a fresh array right before calling, but a
  //caller that reused or retained the array would see it grow a title page on every call.
  const original = [{ title: 'One', html: '<p>Body</p>' }];

  await buildEpub(t, 'Title', 'Author', original, true);

  assert.strictEqual(original.length, 1, 'caller\'s array must not be mutated');
  assert.strictEqual(original[0].title, 'One');
});

test('a write-stream failure reports the error via callback instead of crashing the process', async function(t){
  //Regression: the write stream had no 'error' listener, so a disk-level failure (here, a parent
  //directory that doesn't exist) surfaced as an unhandled 'error' event - which Node turns into an
  //uncaught exception - instead of reaching the callback. Capture uncaughtException here rather
  //than letting it propagate, since an uncaught exception would otherwise abort the whole test run.
  const filepath = path.join(os.tmpdir(), 'epub-test-missing-dir-' + Date.now() + '-' + Math.random().toString(36).slice(2), 'out.epub');

  let uncaught = null;
  function onUncaught(err){ uncaught = err; }
  process.on('uncaughtException', onUncaught);
  t.after(function(){ process.removeListener('uncaughtException', onUncaught); });

  const result = await new Promise(function(resolve){
    htmlChaptersToEpub('Title', 'Author', [{ title: 'One', html: '<p>Body</p>' }], filepath, false, resolve);
  });

  assert.strictEqual(result, 'error', 'callback should report the failure');
  assert.strictEqual(uncaught, null, 'a write-stream error must not crash the process');
});
