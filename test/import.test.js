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

//Regression: an unrecognized fileType.id fell through all three importer branches with no `else`,
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
