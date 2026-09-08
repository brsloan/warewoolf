require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const archiver = require('archiver');

const errorLog = require('../src/components/controllers/error-log');
const { createPlatform } = require('../src/components/controllers/platform');
const { createNodeBacking } = require('../src/components/controllers/platform-node');
const importCtrlPath = require.resolve('../src/components/controllers/import');
const importCtrl = require(importCtrlPath);

//import.js destructures `logError` from error-log.js at require-time, so a test that mocks
//errorLog.logError must re-require this module afterward for the fresh destructure to see it -
//same reasoning as docx-import.test.js and file-manager.test.js.
function freshImportCtrl(){
  delete require.cache[importCtrlPath];
  return require(importCtrlPath);
}

function tempDir(){
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-import-'));
}

//Keep any incidental real logError call out of the repo's cwd instead of the default bare
//"error_log.txt".
test.before(function(){
  errorLog.setPlatform(createPlatform(createNodeBacking({ paths: { userData: tempDir() } })));
});

//The module under test holds its own createPlatform(createIpcBacking()) instance and reaches the
//machine through window.warewoolf, exactly as it does in the app. A real node backing sits behind
//the bridge, so these tests still assert against real files in real temp directories - across a
//real structured-clone boundary now.
const { installBridge, uninstallBridge } = require('./fake-bridge');

test.before(function(){ installBridge(); });
test.after(uninstallBridge);

function plainTextOptions(overrides){
  return Object.assign({
    chapLabels: 'firstLine',
    convertFirstLines: false,
    convertItalics: { convert: false },
    convertTabs: { convert: false },
    splitChapters: { split: false }
  }, overrides);
}

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function documentXml(bodyXml){
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document ' + W_NS + '><w:body>' + bodyXml + '</w:body></w:document>';
}

//Builds a minimal .docx (a zip containing only word/document.xml) on disk - same approach as
//docx-import.test.js, since importDocx only ever reads that one part for these fixtures.
async function buildDocxFixture(t, filename, bodyXml){
  const dir = tempDir();
  t.after(function(){
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const filepath = path.join(dir, filename);
  const output = fs.createWriteStream(filepath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  const written = new Promise(function(resolve, reject){
    output.on('close', resolve);
    archive.on('error', reject);
  });

  archive.pipe(output);
  archive.append(documentXml(bodyXml), { name: 'word/document.xml' });
  archive.finalize();
  await written;

  return { filepath: filepath, sysDirectories: { temp: dir } };
}

//---------------------------------------------------------------------------
// getFilenameFromFilepath
//---------------------------------------------------------------------------

test('getFilenameFromFilepath returns the bare filename without its extension', function(){
  assert.strictEqual(importCtrl.getFilenameFromFilepath('/home/user/docs/chapter.txt'), 'chapter');
});

//Regression: split('.')[0] kept only the text before the FIRST dot, losing everything after it
//for a multi-dot filename.
test('getFilenameFromFilepath regression: a multi-dot filename keeps everything but the final extension', function(){
  assert.strictEqual(importCtrl.getFilenameFromFilepath('/docs/my.novel.draft.txt'), 'my.novel.draft');
  assert.strictEqual(importCtrl.getFilenameFromFilepath('/docs/chapter 1.5.txt'), 'chapter 1.5');
});

test('getFilenameFromFilepath regression: works with Windows-style backslash paths', function(){
  assert.strictEqual(importCtrl.getFilenameFromFilepath('C:\\Users\\author\\chapter 1.5.txt'), 'chapter 1.5');
});

//---------------------------------------------------------------------------
// importPlainText
//---------------------------------------------------------------------------

test('importPlainText reads a file and packages it as a single chapter delta titled from its first line', async function(){
  const dir = tempDir();
  const file = path.join(dir, 'story.txt');
  fs.writeFileSync(file, 'Chapter One\r\nOnce upon a time.');

  const packagedDeltas = await new Promise(function(resolve){
    importCtrl.importPlainText(file, plainTextOptions(), resolve);
  });

  assert.strictEqual(packagedDeltas.length, 1);
  assert.strictEqual(packagedDeltas[0].title, 'Chapter One');
  assert.strictEqual(packagedDeltas[0].delta.ops[0].insert, 'Chapter One\r\nOnce upon a time.');
});

test('importPlainText labels a chapter from the filename (fixed, multi-dot-safe) when requested', async function(){
  const dir = tempDir();
  const file = path.join(dir, 'my.novel.draft.txt');
  fs.writeFileSync(file, 'Some body text.');

  const packagedDeltas = await new Promise(function(resolve){
    importCtrl.importPlainText(file, plainTextOptions({ chapLabels: 'filename' }), resolve);
  });

  assert.strictEqual(packagedDeltas[0].title, 'my.novel.draft');
});

//Regression: fs.readFile's callback runs on its own tick, outside importPlainText's try/catch, so
//an unchecked read error left `inText` undefined and threw uncaught the moment it was used -
//hanging the whole import (hideWorking/cback never ran) with nothing logged.
test('importPlainText regression: a missing file logs an error and calls back with no chapters instead of throwing', { timeout: 5000 }, async function(){
  const logErrorMock = test.mock.method(errorLog, 'logError', function(){});
  const ctrl = freshImportCtrl();

  const dir = tempDir();
  const missingFile = path.join(dir, 'does-not-exist.txt');

  const packagedDeltas = await new Promise(function(resolve){
    ctrl.importPlainText(missingFile, plainTextOptions(), resolve);
  });

  assert.deepStrictEqual(packagedDeltas, []);
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

//Regression: the user-supplied split marker went straight into `new RegExp(...)` unescaped, unlike
//convert-italics.js's marker handling. A marker containing regex metacharacters like parentheses
//was interpreted as regex syntax instead of literal text, so the split silently failed to find its
//own marker in the text (worse cases, e.g. an unbalanced bracket, throw a SyntaxError uncaught -
//see the previous test for why that's fatal to the whole import).
test('importPlainText regression: a split marker containing regex metacharacters is matched literally', async function(){
  const dir = tempDir();
  const file = path.join(dir, 'story.txt');
  fs.writeFileSync(file, 'Part one\n(scene break)\nPart two');

  const packagedDeltas = await new Promise(function(resolve){
    importCtrl.importPlainText(file, plainTextOptions({
      splitChapters: { split: true, marker: '(scene break)' }
    }), resolve);
  });

  assert.strictEqual(packagedDeltas.length, 2);
  assert.strictEqual(packagedDeltas[0].delta.ops[0].insert, 'Part one\n');
  assert.strictEqual(packagedDeltas[1].delta.ops[0].insert, 'Part two');
});

//---------------------------------------------------------------------------
// importMDF
//---------------------------------------------------------------------------

test('importMDF reads a .mdfc file and packages it as a chapter delta', async function(){
  const dir = tempDir();
  const file = path.join(dir, 'story.mdfc');
  fs.writeFileSync(file, 'Hello world\r\n');

  const packagedDeltas = await new Promise(function(resolve){
    importCtrl.importMDF(file, { chapLabels: 'firstLine' }, function(delts){ resolve(delts); });
  });

  assert.strictEqual(packagedDeltas.length, 1);
  assert.strictEqual(packagedDeltas[0].title, 'Hello world');
});

test('importMDF labels a chapter from the filename (fixed, multi-dot-safe) when requested', async function(){
  const dir = tempDir();
  const file = path.join(dir, 'my.novel.draft.mdfc');
  fs.writeFileSync(file, 'Hello world\r\n');

  const packagedDeltas = await new Promise(function(resolve){
    importCtrl.importMDF(file, { chapLabels: 'filename' }, function(delts){ resolve(delts); });
  });

  assert.strictEqual(packagedDeltas[0].title, 'my.novel.draft');
});

//Regression: same unchecked fs.readFile error as importPlainText.
test('importMDF regression: a missing file logs an error and calls back with no chapters instead of throwing', { timeout: 5000 }, async function(){
  const logErrorMock = test.mock.method(errorLog, 'logError', function(){});
  const ctrl = freshImportCtrl();

  const dir = tempDir();
  const missingFile = path.join(dir, 'does-not-exist.mdfc');

  const packagedDeltas = await new Promise(function(resolve){
    ctrl.importMDF(missingFile, { chapLabels: 'firstLine' }, function(delts){ resolve(delts); });
  });

  assert.deepStrictEqual(packagedDeltas, []);
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

//---------------------------------------------------------------------------
// importHtml
//---------------------------------------------------------------------------
//The conversion itself is html-import.js's job and is covered exhaustively in
//test/html-import.test.js. What is asserted here is the wiring: that the file is read, that the
//options this controller is handed reach the converter, and that the resulting chapters are titled
//the same way every other importer titles them.

function runImportHtml(ctrl, filepath, options){
  return new Promise(function(resolve){
    ctrl.importHtml(filepath, options, function(delts){ resolve(delts); });
  });
}

function htmlOptions(overrides){
  return Object.assign({
    splitChapters: { headingLevel: null, atRules: false },
    stripBoilerplate: false,
    chapLabels: 'firstLine'
  }, overrides);
}

function writeHtml(name, html){
  const dir = tempDir();
  const file = path.join(dir, name);
  fs.writeFileSync(file, html);
  return file;
}

test('importHtml reads an html file and packages it as a chapter delta titled from its first line', async function(){
  const file = writeHtml('story.html', '<h2>Chapter One</h2><p>Body <i>text</i>.</p>');

  const packagedDeltas = await runImportHtml(importCtrl, file, htmlOptions());

  assert.strictEqual(packagedDeltas.length, 1);
  assert.strictEqual(packagedDeltas[0].title, 'Chapter One');
  assert.deepStrictEqual(packagedDeltas[0].delta.ops, [
    { insert: 'Chapter One' }, { insert: '\n', attributes: { header: 2 } },
    { insert: 'Body ' },
    { insert: 'text', attributes: { italic: true } },
    { insert: '.' },
    { insert: '\n' }
  ]);
});

test('importHtml splits at the requested heading level and titles each chapter from its heading', async function(){
  const file = writeHtml('book.html',
    '<h1>Book</h1><p>front</p><h2>One</h2><p>a</p><h2>Two</h2><p>b</p>');

  const packagedDeltas = await runImportHtml(importCtrl, file,
    htmlOptions({ splitChapters: { headingLevel: 2, atRules: false } }));

  assert.deepStrictEqual(packagedDeltas.map(function(p){ return p.title; }), ['Book', 'One', 'Two']);
});

//The same numbering the docx importer needed, reached through the helper both now share - an HTML
//book split at its headings is the case that makes it matter most, since one file routinely becomes
//thirty-odd chapters.
test('importHtml numbers filename-based titles when one file becomes several chapters', async function(){
  const file = writeHtml('my.novel.draft.html', '<h2>One</h2><p>a</p><h2>Two</h2><p>b</p>');

  const packagedDeltas = await runImportHtml(importCtrl, file,
    htmlOptions({ chapLabels: 'filename', splitChapters: { headingLevel: 2, atRules: false } }));

  assert.deepStrictEqual(packagedDeltas.map(function(p){ return p.title; }),
    ['my.novel.draft 1', 'my.novel.draft 2']);
});

test('importHtml does not number a filename-based title when the file becomes one chapter', async function(){
  const file = writeHtml('novel.html', '<h2>One</h2><p>a</p>');

  const packagedDeltas = await runImportHtml(importCtrl, file,
    htmlOptions({ chapLabels: 'filename', splitChapters: { headingLevel: 2, atRules: false } }));

  assert.strictEqual(packagedDeltas.length, 1);
  assert.strictEqual(packagedDeltas[0].title, 'novel');
});

test('importHtml passes the boilerplate option through to the converter', async function(){
  const html = '<header id="pg-header"><p>licence</p></header><h2>One</h2><p>a</p>';

  const kept = await runImportHtml(importCtrl, writeHtml('pg.html', html), htmlOptions());
  assert.match(textOfDelta(kept[0].delta), /^licence/);

  const stripped = await runImportHtml(importCtrl, writeHtml('pg.html', html),
    htmlOptions({ stripBoilerplate: true }));
  assert.strictEqual(textOfDelta(stripped[0].delta), 'One\na\n');
});

//Regression: same unchecked read error as importPlainText and importMDF.
test('importHtml regression: a missing file logs an error and calls back with no chapters instead of throwing', { timeout: 5000 }, async function(){
  const logErrorMock = test.mock.method(errorLog, 'logError', function(){});
  const ctrl = freshImportCtrl();

  const missingFile = path.join(tempDir(), 'does-not-exist.html');
  const packagedDeltas = await runImportHtml(ctrl, missingFile, htmlOptions());

  assert.deepStrictEqual(packagedDeltas, []);
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

function textOfDelta(delta){
  return delta.ops.map(function(op){
    return typeof op.insert === 'string' ? op.insert : '';
  }).join('');
}

//---------------------------------------------------------------------------
// importEpubFile
//---------------------------------------------------------------------------
//The reading of the archive is epub-import.js's job and is covered in test/epub-import.test.js.
//What is asserted here is the wiring: how a chapter gets its title, and how the book's own title and
//author reach the caller.

function buildEpubFixture(name, entries){
  return new Promise(function(resolve, reject){
    const dir = tempDir();
    const filepath = path.join(dir, name).replaceAll('\\', '/');
    const output = fs.createWriteStream(filepath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', function(){ resolve(filepath); });
    archive.on('error', reject);

    archive.pipe(output);
    archive.append('application/epub+zip', { name: 'mimetype' });
    Object.keys(entries).forEach(function(entryName){
      archive.append(entries[entryName], { name: entryName });
    });
    archive.finalize();
  });
}

//A two-chapter book with a table of contents that names both, and a third chapter the contents does
//not name - so the fallback to the first line has something to fall back on.
function epubFixtureEntries(title, author){
  return {
    'META-INF/container.xml':
      '<?xml version="1.0"?><container version="1.0" '
      + 'xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>'
      + '<rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
    'OEBPS/content.opf':
      '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">'
      + '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
      + '<dc:title>' + title + '</dc:title><dc:creator>' + author + '</dc:creator></metadata>'
      + '<manifest>'
      + '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'
      + '<item id="c1" href="chapter_1.xhtml" media-type="application/xhtml+xml"/>'
      + '<item id="c2" href="chapter_2.xhtml" media-type="application/xhtml+xml"/>'
      + '<item id="c3" href="chapter_3.xhtml" media-type="application/xhtml+xml"/>'
      + '</manifest>'
      + '<spine toc="ncx"><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine>'
      + '</package>',
    'OEBPS/toc.ncx':
      '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>'
      + '<navPoint id="n1" playOrder="1"><navLabel><text>Named By The Book</text></navLabel>'
      + '<content src="chapter_1.xhtml"/></navPoint>'
      + '<navPoint id="n2" playOrder="2"><navLabel><text>Also Named</text></navLabel>'
      + '<content src="chapter_2.xhtml"/></navPoint>'
      + '</navMap></ncx>',
    'OEBPS/chapter_1.xhtml': epubChapter('<h2>A Different Heading</h2><p>first</p>'),
    'OEBPS/chapter_2.xhtml': epubChapter('<h2>Another Heading</h2><p>second</p>'),
    'OEBPS/chapter_3.xhtml': epubChapter('<h2>Unlisted Chapter</h2><p>third</p>')
  };
}

function epubChapter(body){
  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>c</title></head>'
    + '<body>' + body + '</body></html>';
}

function runImportEpubFile(ctrl, filepath, options){
  return new Promise(function(resolve){
    ctrl.importEpubFile(filepath, options, function(delts, metadata){
      resolve({ delts: delts, metadata: metadata });
    });
  });
}

//An epub already knows what each of its chapters is called, and that is a better name than the first
//line in every case where the two differ - so here "first line" means "the book's own name for it",
//falling back to the first line only where the contents named nothing.
test('importEpubFile titles chapters from the table of contents, falling back to the first line', async function(){
  const filepath = await buildEpubFixture('book.epub', epubFixtureEntries('A Title', 'An Author'));

  const result = await runImportEpubFile(importCtrl, filepath, { chapLabels: 'firstLine' });

  assert.deepStrictEqual(result.delts.map(function(d){ return d.title; }),
    ['Named By The Book', 'Also Named', 'Unlisted Chapter']);
});

test('importEpubFile numbers filename-based titles like every other multi-chapter importer', async function(){
  const filepath = await buildEpubFixture('my.book.epub', epubFixtureEntries('A Title', 'An Author'));

  const result = await runImportEpubFile(importCtrl, filepath, { chapLabels: 'filename' });

  assert.deepStrictEqual(result.delts.map(function(d){ return d.title; }),
    ['my.book 1', 'my.book 2', 'my.book 3']);
});

test('importEpubFile reports the book title and author alongside the chapters', async function(){
  const filepath = await buildEpubFixture('book.epub', epubFixtureEntries('Moby Dick', 'Herman Melville'));

  const result = await runImportEpubFile(importCtrl, filepath, { chapLabels: 'firstLine' });

  assert.deepStrictEqual(result.metadata, { title: 'Moby Dick', author: 'Herman Melville' });
});

test('importEpubFile withholds the metadata when the writer asked it not to be used', async function(){
  const filepath = await buildEpubFixture('book.epub', epubFixtureEntries('Moby Dick', 'Herman Melville'));

  const result = await runImportEpubFile(importCtrl, filepath,
    { chapLabels: 'firstLine', useMetadata: false });

  assert.strictEqual(result.metadata, null);
  assert.strictEqual(result.delts.length, 3, 'the chapters should still import');
});

test('importEpubFile passes the boilerplate option through', async function(){
  const entries = epubFixtureEntries('A Title', 'An Author');
  entries['OEBPS/chapter_3.xhtml'] = epubChapter(
    '<p>*** END OF THE PROJECT GUTENBERG EBOOK A TITLE ***</p><p>licence</p>');
  const filepath = await buildEpubFixture('pg.epub', entries);

  const kept = await runImportEpubFile(importCtrl, filepath, { chapLabels: 'firstLine' });
  assert.strictEqual(kept.delts.length, 3);

  const stripped = await runImportEpubFile(importCtrl, filepath,
    { chapLabels: 'firstLine', stripBoilerplate: true });
  assert.strictEqual(stripped.delts.length, 2);
});

//---------------------------------------------------------------------------
// importFilesAsync
//---------------------------------------------------------------------------

function runImportFilesAsync(ctrl, filepaths, options, sysDirectories){
  const added = [];
  return new Promise(function(resolve){
    ctrl.importFilesAsync(filepaths, options, function(delta, title){
      added.push({ delta: delta, title: title });
    }, function(){
      resolve(added);
    }, sysDirectories);
  });
}

//The same, but keeping what the finish callback was handed - the imported book's own title and
//author, which is how a project takes its defaults from an epub.
function runImportFilesAsyncWithMetadata(ctrl, filepaths, options, sysDirectories){
  const added = [];
  return new Promise(function(resolve){
    ctrl.importFilesAsync(filepaths, options, function(delta, title){
      added.push({ delta: delta, title: title });
    }, function(bookMetadata){
      resolve({ added: added, metadata: bookMetadata });
    }, sysDirectories);
  });
}

test('importFilesAsync imports a single plain text file end-to-end', async function(){
  const dir = tempDir();
  const file = path.join(dir, 'story.txt');
  fs.writeFileSync(file, 'Chapter One\r\nBody.');

  const options = { fileType: { id: 'txtSelect' }, txtOptions: plainTextOptions() };
  const added = await runImportFilesAsync(importCtrl, [file], options, { temp: dir });

  assert.strictEqual(added.length, 1);
  assert.strictEqual(added[0].title, 'Chapter One');
});

//Regression: splitting one docx into multiple chapters while labeling by filename gave every
//chapter the exact same title, making them indistinguishable in the chapter list.
test('importFilesAsync regression: splitting a docx into multiple chapters numbers filename-based titles instead of duplicating them', async function(t){
  const bodyXml =
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Heading One</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Body one</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Heading Two</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Body two</w:t></w:r></w:p>';
  const { filepath, sysDirectories } = await buildDocxFixture(t, 'novel.docx', bodyXml);

  const options = {
    fileType: { id: 'docxSelect' },
    docxOptions: { splitChapters: true, chapLabels: 'filename' }
  };
  const added = await runImportFilesAsync(importCtrl, [filepath], options, sysDirectories);

  assert.strictEqual(added.length, 2);
  const titles = added.map(function(a){ return a.title; });
  assert.deepStrictEqual(titles, ['novel 1', 'novel 2']);
});

test('importFilesAsync does not number a filename-based title when a docx produces only one chapter', async function(t){
  const bodyXml = '<w:p><w:r><w:t>Just one paragraph</w:t></w:r></w:p>';
  const { filepath, sysDirectories } = await buildDocxFixture(t, 'novel.docx', bodyXml);

  const options = {
    fileType: { id: 'docxSelect' },
    docxOptions: { splitChapters: true, chapLabels: 'filename' }
  };
  const added = await runImportFilesAsync(importCtrl, [filepath], options, sysDirectories);

  assert.strictEqual(added.length, 1);
  assert.strictEqual(added[0].title, 'novel');
});

test('importFilesAsync imports an html file end-to-end, split into chapters', async function(){
  const dir = tempDir();
  const file = path.join(dir, 'book.html');
  fs.writeFileSync(file, '<h2>One</h2><p>a</p><h2>Two</h2><p>b</p>');

  const options = {
    fileType: { id: 'htmlSelect' },
    htmlOptions: {
      splitChapters: { headingLevel: 2, atRules: false },
      stripBoilerplate: false,
      chapLabels: 'firstLine'
    }
  };
  const added = await runImportFilesAsync(importCtrl, [file], options, { temp: dir });

  assert.strictEqual(added.length, 2);
  assert.deepStrictEqual(added.map(function(a){ return a.title; }), ['One', 'Two']);
});

test('importFilesAsync imports an epub end-to-end, one chapter per contents entry', async function(){
  const filepath = await buildEpubFixture('novel.epub', epubFixtureEntries('A Title', 'An Author'));

  const options = {
    fileType: { id: 'epubSelect' },
    epubOptions: { stripBoilerplate: false, useMetadata: true, chapLabels: 'firstLine' }
  };
  const result = await runImportFilesAsyncWithMetadata(importCtrl, [filepath], options,
    { temp: tempDir() });

  assert.deepStrictEqual(result.added.map(function(a){ return a.title; }),
    ['Named By The Book', 'Also Named', 'Unlisted Chapter']);
  assert.deepStrictEqual(result.metadata, { title: 'A Title', author: 'An Author' });
});

//The finish callback has never taken an argument, and every caller before this ignores it - which is
//why the metadata travels that way rather than through a parameter of its own.
test('importFilesAsync reports no metadata for a format that carries none', async function(){
  const dir = tempDir();
  const file = path.join(dir, 'story.txt');
  fs.writeFileSync(file, 'Chapter One\r\nBody.');

  const options = { fileType: { id: 'txtSelect' }, txtOptions: plainTextOptions() };
  const result = await runImportFilesAsyncWithMetadata(importCtrl, [file], options, { temp: dir });

  assert.strictEqual(result.metadata, null);
  assert.strictEqual(result.added.length, 1);
});

//Importing several books at once must not let the last one's title quietly replace the first one's.
test('importFilesAsync keeps the first book metadata when several epubs are imported together', async function(){
  const first = await buildEpubFixture('first.epub', epubFixtureEntries('The First Book', 'First Author'));
  const second = await buildEpubFixture('second.epub', epubFixtureEntries('The Second Book', 'Second Author'));

  const options = {
    fileType: { id: 'epubSelect' },
    epubOptions: { stripBoilerplate: false, useMetadata: true, chapLabels: 'firstLine' }
  };
  const result = await runImportFilesAsyncWithMetadata(importCtrl, [first, second], options,
    { temp: tempDir() });

  assert.deepStrictEqual(result.metadata, { title: 'The First Book', author: 'First Author' });
  assert.strictEqual(result.added.length, 6, 'both books should have imported');
});

//Regression: an unrecognized fileType.id fell through all the importer branches with no `else`,
//so `recurse` (and therefore hideWorking/cback) never ran and the working overlay hung forever
//with nothing logged.
test('importFilesAsync regression: an unrecognized fileType.id logs an error and finishes instead of hanging', { timeout: 5000 }, async function(){
  const logErrorMock = test.mock.method(errorLog, 'logError', function(){});
  const ctrl = freshImportCtrl();

  const options = { fileType: { id: 'bogusSelect' } };
  const added = await runImportFilesAsync(ctrl, ['whatever.xyz'], options, { temp: tempDir() });

  assert.strictEqual(added.length, 0);
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

//---------------------------------------------------------------------------
// applyBookMetadata
//---------------------------------------------------------------------------
//An epub knows its own title and author. Filling a blank project field from it is the helpful part;
//overwriting one the writer has already set is not, and a project field has no undo.

function bareProject(overrides){
  return Object.assign({ title: '', author: '', hasUnsavedChanges: false }, overrides || {});
}

test('applyBookMetadata fills a blank title and author from the book', function(){
  const project = bareProject();

  const changed = importCtrl.applyBookMetadata(project, { title: 'Moby Dick', author: 'Herman Melville' });

  assert.strictEqual(changed, true);
  assert.strictEqual(project.title, 'Moby Dick');
  assert.strictEqual(project.author, 'Herman Melville');
  assert.strictEqual(project.hasUnsavedChanges, true);
});

test('applyBookMetadata never overwrites a title or author the writer already set', function(){
  const project = bareProject({ title: 'My Own Novel', author: 'Me' });

  const changed = importCtrl.applyBookMetadata(project, { title: 'Moby Dick', author: 'Herman Melville' });

  assert.strictEqual(changed, false);
  assert.strictEqual(project.title, 'My Own Novel');
  assert.strictEqual(project.author, 'Me');
  assert.strictEqual(project.hasUnsavedChanges, false);
});

test('applyBookMetadata fills only the field that is blank', function(){
  const project = bareProject({ author: 'Me' });

  importCtrl.applyBookMetadata(project, { title: 'Moby Dick', author: 'Herman Melville' });

  assert.strictEqual(project.title, 'Moby Dick');
  assert.strictEqual(project.author, 'Me');
});

//Marking the project dirty for a no-op would have the writer prompted to save a file nothing
//changed in.
test('applyBookMetadata leaves the project clean when there is nothing to fill', function(){
  const project = bareProject({ title: 'Mine', author: 'Me' });
  importCtrl.applyBookMetadata(project, { title: 'Other', author: 'Someone' });
  assert.strictEqual(project.hasUnsavedChanges, false);

  const blank = bareProject();
  importCtrl.applyBookMetadata(blank, { title: '', author: '' });
  assert.strictEqual(blank.hasUnsavedChanges, false);
});

test('applyBookMetadata does nothing at all for a format that reported no metadata', function(){
  const project = bareProject();

  assert.strictEqual(importCtrl.applyBookMetadata(project, null), false);
  assert.strictEqual(importCtrl.applyBookMetadata(project, undefined), false);
  assert.strictEqual(project.hasUnsavedChanges, false);
});
