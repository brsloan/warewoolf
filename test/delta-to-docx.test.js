const test = require('node:test');
const assert = require('node:assert');
const docx = require('docx');
const unzipper = require('unzipper');

const { convertDeltaToDocx } = require('../src/components/controllers/delta-to-docx');

const project = { title: 'Test', author: 'Author', chapters: [], reference: [] };

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
