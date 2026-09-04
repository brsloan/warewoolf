const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const archiver = require('archiver');
const { JSDOM } = require('jsdom');

//docx-import.js reads `new DOMParser()` as a bare global. In the app this is supplied by Electron's
//renderer (window.DOMParser); tests supply the same API via jsdom.
global.DOMParser = new JSDOM().window.DOMParser;

const errorLog = require('../src/components/controllers/error-log');
const docxImportPath = require.resolve('../src/components/controllers/docx-import');

//importDocx destructures `logError` from error-log.js at require-time, so any test that mocks
//errorLog.logError must re-require this module afterward for the fresh destructure to see it -
//same reasoning as battery-monitor.test.js.
function freshDocxImport(){
  delete require.cache[docxImportPath];
  return require(docxImportPath);
}

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function documentXml(bodyXml){
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document ' + W_NS + '><w:body>' + bodyXml + '</w:body></w:document>';
}

//Builds a minimal .docx - a zip with word/document.xml and, if given, word/footnotes.xml - on disk.
//importDocx only ever reads those two parts, so the fixture doesn't need every part a real docx has.
async function buildDocxFixture(t, bodyXml, footnotesXml){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-import-test-'));
  t.after(function(){
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const filepath = path.join(dir, 'test.docx');
  const output = fs.createWriteStream(filepath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  const written = new Promise(function(resolve, reject){
    output.on('close', resolve);
    archive.on('error', reject);
  });

  archive.pipe(output);
  archive.append(documentXml(bodyXml), { name: 'word/document.xml' });
  if(footnotesXml)
    archive.append(footnotesXml, { name: 'word/footnotes.xml' });
  archive.finalize();
  await written;

  //A fresh temp dir per fixture (rather than a shared one) also stands in for the real
  //sysDirectories.temp, so a passing test demonstrates that value is actually being used.
  return { filepath: filepath, sysDirectories: { temp: dir } };
}

function runImport(importDocx, filepath, sysDirectories, split){
  return new Promise(function(resolve){
    importDocx(filepath, sysDirectories, split || false, resolve);
  });
}

function flatten(deltas){
  return deltas.map(function(d){ return d.ops.map(function(o){ return o.insert; }).join(''); }).join('|SPLIT|');
}

test('imports a simple paragraph with run formatting into a single delta', async function(t){
  const { importDocx } = freshDocxImport();
  const { filepath, sysDirectories } = await buildDocxFixture(t,
    '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Hello</w:t></w:r></w:p>'
  );

  const deltas = await runImport(importDocx, filepath, sysDirectories);

  assert.strictEqual(deltas.length, 1);
  assert.deepStrictEqual(deltas[0].ops, [
    { insert: 'Hello', attributes: { bold: true } },
    { insert: '\n', attributes: {} }
  ]);
});

//Regression: sysDirectories used to be an unreferenced bare identifier in this file rather than a
//parameter, so it only worked by accident of Electron's non-isolated renderer sharing a global
//script scope with require()'d modules - a plain Node process (like this test) has no such thing,
//so this test can only pass at all because sysDirectories is now threaded through as an argument.
test('uses the sysDirectories passed in as an argument to unzip the file', async function(t){
  const { importDocx } = freshDocxImport();
  const { filepath, sysDirectories } = await buildDocxFixture(t,
    '<w:p><w:r><w:t>Hi</w:t></w:r></w:p>'
  );

  await runImport(importDocx, filepath, sysDirectories);

  assert.ok(
    fs.existsSync(path.join(sysDirectories.temp, 'docxguts', 'word', 'document.xml')),
    'expected the docx to be unzipped under the given sysDirectories.temp'
  );
});

//Regression: getElementsByTagName('w:p') recursed into the whole document, including paragraphs
//nested inside tables, duplicating/misordering content relative to the visible layout.
test('paragraphs nested inside a table are excluded', async function(t){
  const { importDocx } = freshDocxImport();
  const bodyXml =
    '<w:p><w:r><w:t>Body</w:t></w:r></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    '<w:p><w:r><w:t>After</w:t></w:r></w:p>';
  const { filepath, sysDirectories } = await buildDocxFixture(t, bodyXml);

  const deltas = await runImport(importDocx, filepath, sysDirectories);

  assert.strictEqual(flatten(deltas), 'Body\nAfter\n');
});

//Regression: a missing footnotes.xml with a footnote reference still present in the body used to
//crash with fnDom.getElementsByTagName on null.
test('a footnote reference with no footnotes.xml part logs an error instead of crashing', async function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  const { importDocx } = freshDocxImport();
  const { filepath, sysDirectories } = await buildDocxFixture(t,
    '<w:p><w:r><w:t>See note</w:t><w:footnoteReference w:id="1"/></w:r></w:p>'
  );

  const deltas = await runImport(importDocx, filepath, sysDirectories);

  assert.strictEqual(flatten(deltas), 'See note[^1]\n');
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

//Regression: a footnote reference whose id has no matching <w:footnote> (edited/corrupted docx)
//used to crash inside getFootnoteOps on a null fnoteBod.
test('a footnote reference with no matching footnote body logs an error instead of crashing', async function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  const { importDocx } = freshDocxImport();
  const footnotesXml = '<?xml version="1.0"?><w:footnotes ' + W_NS + '>' +
    '<w:footnote w:id="-1" w:type="separator"/>' +
    '</w:footnotes>';
  const { filepath, sysDirectories } = await buildDocxFixture(t,
    '<w:p><w:r><w:t>See note</w:t><w:footnoteReference w:id="1"/></w:r></w:p>',
    footnotesXml
  );

  const deltas = await runImport(importDocx, filepath, sysDirectories);

  assert.strictEqual(flatten(deltas), 'See note[^1]\n');
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

//Regression: an empty <w:t/> (Word's own way of writing a zero-length run) crashed on
//childNodes[0].nodeValue inside getFootnoteOps, which - unlike the main paragraph loop - had no
//length guard.
test('an empty w:t inside a footnote body does not crash the import', async function(t){
  const { importDocx } = freshDocxImport();
  const footnotesXml = '<?xml version="1.0"?><w:footnotes ' + W_NS + '>' +
    '<w:footnote w:id="1"><w:p><w:r><w:t/><w:t>Real text</w:t></w:r></w:p></w:footnote>' +
    '</w:footnotes>';
  const { filepath, sysDirectories } = await buildDocxFixture(t,
    '<w:p><w:r><w:t>See note</w:t><w:footnoteReference w:id="1"/></w:r></w:p>',
    footnotesXml
  );

  const deltas = await runImport(importDocx, filepath, sysDirectories);

  assert.strictEqual(flatten(deltas), 'See note[^1]\n[^1]: Real text\n');
});

//Regression: a manual line break (w:br) splitting one run into multiple w:t siblings was detected
//by text-node index parity (z % 2) rather than the actual w:br, so three or more breaks in one run
//silently dropped a line - two of the four segments ran together with no marker between them.
test('a manual line break inside a footnote paragraph starts a new marker line', async function(t){
  const { importDocx } = freshDocxImport();
  const footnotesXml = '<?xml version="1.0"?><w:footnotes ' + W_NS + '>' +
    '<w:footnote w:id="1"><w:p><w:r>' +
    '<w:t>seg0</w:t><w:br/><w:t>seg1</w:t><w:br/><w:t>seg2</w:t><w:br/><w:t>seg3</w:t>' +
    '</w:r></w:p></w:footnote>' +
    '</w:footnotes>';
  const { filepath, sysDirectories } = await buildDocxFixture(t,
    '<w:p><w:r><w:t>See note</w:t><w:footnoteReference w:id="1"/></w:r></w:p>',
    footnotesXml
  );

  const deltas = await runImport(importDocx, filepath, sysDirectories);

  assert.strictEqual(
    flatten(deltas),
    'See note[^1]\n[^1]: seg0\n[^1]: seg1\n[^1]: seg2\n[^1]: seg3\n'
  );
});

//Regression: tempUnzipDocx had no 'error' listener on either stream, so a missing/corrupt file
//threw an unhandled stream error and crashed the whole app instead of failing this one import.
test('a missing/unreadable file logs an error instead of crashing', async function(t){
  let capturedError;
  const errorLogged = new Promise(function(resolve){
    t.mock.method(errorLog, 'logError', function(err){
      capturedError = err;
      resolve();
    });
  });
  const { importDocx } = freshDocxImport();

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-import-test-'));
  t.after(function(){ fs.rmSync(tempDir, { recursive: true, force: true }); });
  const missingPath = path.join(tempDir, 'does-not-exist.docx');

  let cbackCalled = false;
  importDocx(missingPath, { temp: tempDir }, false, function(){ cbackCalled = true; });

  await errorLogged;

  assert.ok(capturedError instanceof Error);
  assert.strictEqual(cbackCalled, false);
});
