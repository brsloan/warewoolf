const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const docx = require('docx');
const unzipper = require('unzipper');

const errorLog = require('../src/components/controllers/error-log');
const deltaToDocxPath = require.resolve('../src/components/controllers/delta-to-docx');
const { convertDeltaToDocx } = require(deltaToDocxPath);

const project = { title: 'Test', author: 'Author', chapters: [], reference: [] };

//saveDocx/packageDocxBase64 destructure `logError` from error-log.js at require-time, so a test that
//mocks errorLog.logError must re-require this module afterward for the fresh destructure to see it -
//same reasoning as battery-monitor.test.js.
function freshDeltaToDocx(){
  delete require.cache[deltaToDocxPath];
  return require(deltaToDocxPath);
}

function extractText(xml){
  return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join('');
}

//Word decides where a numbered list restarts from the numbering instance each paragraph points at,
//which surfaces in the .docx as a w:numId. The instance ids themselves are allocated by the docx
//library and are not stable between documents, so what these tests assert is the shape: which items
//share an instance with which, and that every instance a paragraph points at actually exists.
async function getNumberingPattern(delta){
  const doc = convertDeltaToDocx(delta, {}, project, null);
  const buffer = await docx.Packer.toBuffer(doc);
  const dir = await unzipper.Open.buffer(buffer);

  const documentXml = (await dir.files.find(f => f.path === 'word/document.xml').buffer()).toString();
  const numberingXml = (await dir.files.find(f => f.path === 'word/numbering.xml').buffer()).toString();

  const referenced = [...documentXml.matchAll(/<w:numId w:val="(\d+)"/g)].map(m => m[1]);
  const declared = [...numberingXml.matchAll(/<w:num w:numId="(\d+)"/g)].map(m => m[1]);

  //Relabel the ids in order of first appearance so two documents that group their items the same
  //way compare equal regardless of which numbers the library handed out.
  const labels = new Map();
  const pattern = referenced.map(function(id){
    if(!labels.has(id))
      labels.set(id, labels.size);
    return labels.get(id);
  });

  return { pattern: pattern, dangling: referenced.filter(id => !declared.includes(id)) };
}

const twoLists = { ops: [
  {insert: 'a'},   {insert: '\n', attributes: {list: 'ordered'}},
  {insert: 'b'},   {insert: '\n', attributes: {list: 'ordered'}},
  {insert: 'gap'}, {insert: '\n'},
  {insert: 'c'},   {insert: '\n', attributes: {list: 'ordered'}},
  {insert: 'd'},   {insert: '\n', attributes: {list: 'ordered'}}
]};

//Regression: only the first item of a new list was given an instance, so the items after it fell
//back on the default instance, which is the previous list's sequence. Here that showed up as
//[0, 0, 1, 0] rather than two lists of two.
test('every item of a numbered list shares one numbering instance', async function(){
  const result = await getNumberingPattern(twoLists);
  assert.deepStrictEqual(result.pattern, [0, 0, 1, 1]);
  assert.deepStrictEqual(result.dangling, [], 'document references a numbering instance that was never declared');
});

//Regression: the instance counter was module level and never reset, so a document's numbering
//depended on how many documents had been exported before it in the same session.
test('numbering does not depend on how many documents were converted before', async function(){
  //Each pass is checked against the shape it should have rather than only against the other passes.
  //The old module level counter settled into the same wrong shape on every export after the first,
  //so passes that merely agreed with one another would have looked fine.
  for(const pass of [1, 2, 3]){
    const result = await getNumberingPattern(twoLists);
    assert.deepStrictEqual(result.pattern, [0, 0, 1, 1], 'wrong grouping on pass ' + pass);
    assert.deepStrictEqual(result.dangling, [], 'dangling numbering instance on pass ' + pass);
  }
});

test('an indented item stays in the list it is nested inside', async function(){
  const result = await getNumberingPattern({ ops: [
    {insert: 'alpha'}, {insert: '\n', attributes: {list: 'ordered'}},
    {insert: 'sub'},   {insert: '\n', attributes: {list: 'ordered', indent: 1}},
    {insert: 'beta'},  {insert: '\n', attributes: {list: 'ordered'}}
  ]});

  assert.deepStrictEqual(result.pattern, [0, 0, 0]);
});

test('a bullet list between two numbered lists separates them', async function(){
  const result = await getNumberingPattern({ ops: [
    {insert: 'a'},      {insert: '\n', attributes: {list: 'ordered'}},
    {insert: 'bullet'}, {insert: '\n', attributes: {list: 'bullet'}},
    {insert: 'b'},      {insert: '\n', attributes: {list: 'ordered'}}
  ]});

  //The bullet carries a w:numId too (docx's own bullet numbering), so it shows up as the middle
  //entry. What matters is that the two numbered items land either side of it in instances of their
  //own, which is what makes the second list restart at one.
  assert.deepStrictEqual(result.pattern, [0, 1, 2]);
});

//Regression: footnotes are packaged as a separate part (word/footnotes.xml), and docx only resolves
//a numbered list's "{reference-instance}" numbering placeholder into a real numId for the parts it
//runs its numbering-replacer pass over - the main document, styles, headers and footers. Footnotes
//aren't among them, so a numbered list inside one used to keep the raw placeholder as its literal
//numId, producing an invalid .docx. List numbers inside footnotes are rendered as plain text instead.
test('a numbered list inside a footnote renders as plain-text numbers instead of an unresolved numId', async function(){
  const delta = { ops: [
    {insert: 'main text'}, {insert: '[^1]'}, {insert: '\n'},
    {insert: '[^1]: item one'}, {insert: '\n', attributes: {list: 'ordered'}},
    {insert: '[^1]: item two'}, {insert: '\n', attributes: {list: 'ordered'}}
  ]};

  const doc = convertDeltaToDocx(delta, {}, project, null);
  const buffer = await docx.Packer.toBuffer(doc);
  const dir = await unzipper.Open.buffer(buffer);
  const footnotesXml = (await dir.files.find(f => f.path === 'word/footnotes.xml').buffer()).toString();

  assert.ok(!/w:numId w:val="\{/.test(footnotesXml),
    'footnote paragraph kept an unresolved numbering placeholder as its numId: ' + footnotesXml);

  const text = extractText(footnotesXml);
  assert.match(text, /1\.\s*item one/, 'expected the first footnote list item numbered 1, got: ' + text);
  assert.match(text, /2\.\s*item two/, 'expected the second footnote list item numbered 2, got: ' + text);
});

//Regression: a [^N] marker with no matching "[^N]:" footnote body (deleted body paragraph, typo'd
//number) resolved footnoteBodies.findIndex to -1, so fnoteBodyNum became 0 and the export emitted a
//FootnoteReferenceRun pointing at footnote id 0, which does not exist in the document (footnote ids
//start at 1). The marker is kept as plain text instead when no footnote body matches it.
test('a footnote marker with no matching footnote body is kept as text instead of referencing a missing footnote', async function(){
  const delta = { ops: [ {insert: 'see note'}, {insert: '[^1]'}, {insert: '\n'} ] };

  const doc = convertDeltaToDocx(delta, {}, project, null);
  const buffer = await docx.Packer.toBuffer(doc);
  const dir = await unzipper.Open.buffer(buffer);
  const documentXml = (await dir.files.find(f => f.path === 'word/document.xml').buffer()).toString();

  assert.ok(!documentXml.includes('<w:footnoteReference'),
    'should not reference a footnote when no footnote body matches the marker');
  assert.match(extractText(documentXml), /\[\^1\]/, 'expected the unmatched marker to survive as plain text');
});

//Regression: convertParaAttributes mapped attr.indent straight to a numbering level with no ceiling,
//but the numbering config below only declares levels 0-2. A fourth-level (indent 3) ordered list item
//referenced an unconfigured level, which docx silently fills in with a default decimal style instead
//of erroring - so the item loses its intended letter/roman formatting without any visible failure.
test('an ordered list nested past the third level still uses a configured numbering level', async function(){
  const delta = { ops: [
    {insert: 'l0'}, {insert: '\n', attributes: {list: 'ordered'}},
    {insert: 'l1'}, {insert: '\n', attributes: {list: 'ordered', indent: 1}},
    {insert: 'l2'}, {insert: '\n', attributes: {list: 'ordered', indent: 2}},
    {insert: 'l3'}, {insert: '\n', attributes: {list: 'ordered', indent: 3}}
  ]};

  const doc = convertDeltaToDocx(delta, {}, project, null);
  const buffer = await docx.Packer.toBuffer(doc);
  const dir = await unzipper.Open.buffer(buffer);
  const documentXml = (await dir.files.find(f => f.path === 'word/document.xml').buffer()).toString();

  const levels = [...documentXml.matchAll(/<w:ilvl w:val="(\d+)"/g)].map(m => Number(m[1]));
  assert.deepStrictEqual(levels, [0, 1, 2, 2],
    'a fourth-level item should fold into the deepest configured level (2) instead of an unconfigured one');
});

//Regression: the loop building the footnotes object assigned its counter with a bare `i = 0`, leaking
//it as an implicit global - the same bug class already fixed (and regression-tested) in compile.js.
test('convertDeltaToDocx does not leak an implicit global "i"', function(){
  delete global.i;

  convertDeltaToDocx({ ops: [
    {insert: 'main text'}, {insert: '[^1]'}, {insert: '\n'},
    {insert: '[^1]: a footnote'}, {insert: '\n'}
  ]}, {}, project, null);

  assert.strictEqual(typeof global.i, 'undefined', 'convertDeltaToDocx leaked "i" as an implicit global');
});

//Regression: saveDocx/packageDocxBase64 chained .then() off docx.Packer's promise with no .catch(),
//unlike every other exporter in this codebase (which wraps its work in try/catch + logError). A
//rejection there was an unhandled promise rejection that was never logged, and in packageDocxBase64's
//case the callback simply never fired, so the email feature would silently hang forever.
test('saveDocx logs a packing failure instead of leaving it an unhandled rejection', async function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  const packError = new Error('packing failed');
  t.mock.method(docx.Packer, 'toBuffer', function(){ return Promise.reject(packError); });

  const { saveDocx } = freshDeltaToDocx();
  const doc = convertDeltaToDocx({ ops: [{insert: 'x'}, {insert: '\n'}] }, {}, project, null);

  saveDocx('unused-path.docx', doc);
  await new Promise(function(r){ setTimeout(r, 20); });

  assert.strictEqual(logErrorMock.mock.calls.length, 1);
  assert.strictEqual(logErrorMock.mock.calls[0].arguments[0], packError);
});

test('packageDocxBase64 logs a packing failure instead of leaving it an unhandled rejection', async function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  const packError = new Error('packing failed');
  t.mock.method(docx.Packer, 'toBase64String', function(){ return Promise.reject(packError); });

  const { packageDocxBase64 } = freshDeltaToDocx();
  const doc = convertDeltaToDocx({ ops: [{insert: 'x'}, {insert: '\n'}] }, {}, project, null);

  let callbackCalled = false;
  packageDocxBase64(doc, function(){ callbackCalled = true; });
  await new Promise(function(r){ setTimeout(r, 20); });

  assert.strictEqual(logErrorMock.mock.calls.length, 1);
  assert.strictEqual(logErrorMock.mock.calls[0].arguments[0], packError);
  assert.strictEqual(callbackCalled, false, 'callback should not fire when packing failed');
});

//Regression: saveDocx had no way to signal completion at all, so callers (export.js) that write
//one .docx per chapter could not tell when the write had actually finished and had to treat the
//call as fire-and-forget - the doc could still be mid-write when the caller reported the export
//as done. saveDocx now takes an optional completion callback.
test('saveDocx calls its completion callback with the filepath once the file has actually been written', async function(t){
  const filepath = path.join(os.tmpdir(), 'delta-to-docx-test-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.docx');
  t.after(function(){
    if(fs.existsSync(filepath))
      fs.unlinkSync(filepath);
  });

  const { saveDocx } = freshDeltaToDocx();
  const doc = convertDeltaToDocx({ ops: [{insert: 'x'}, {insert: '\n'}] }, {}, project, null);

  const result = await new Promise(function(resolve){
    saveDocx(filepath, doc, resolve);
  });

  assert.strictEqual(result, filepath);
  assert.ok(fs.existsSync(filepath), 'expected the .docx file to exist once the callback fired');
});

test('saveDocx calls its completion callback with \'error\' instead of throwing when packing fails', async function(t){
  t.mock.method(errorLog, 'logError', function(){});
  const packError = new Error('packing failed');
  t.mock.method(docx.Packer, 'toBuffer', function(){ return Promise.reject(packError); });

  const { saveDocx } = freshDeltaToDocx();
  const doc = convertDeltaToDocx({ ops: [{insert: 'x'}, {insert: '\n'}] }, {}, project, null);

  const result = await new Promise(function(resolve){
    saveDocx('unused-path.docx', doc, resolve);
  });

  assert.strictEqual(result, 'error');
});
