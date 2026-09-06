require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');

const { makeChapter, makeUnloadableChapter, makeProject } = require('./helpers');
const { convertFirstLineToTitle, convertFirstLinesToTitles } = require('../src/components/controllers/convert-first-lines');

function plainFirstLine(){
  return { ops: [ { insert: 'Chapter One' }, { insert: '\n' }, { insert: 'body text' }, { insert: '\n' } ] };
}

function titledFirstLine(){
  return { ops: [ { insert: 'Chapter One' }, { insert: '\n', attributes: { header: 1, align: 'center' } }, { insert: 'body text' }, { insert: '\n' } ] };
}

function emptyFirstLine(){
  return { ops: [ { insert: '\n' }, { insert: 'Chapter One' }, { insert: '\n' }, { insert: 'body text' }, { insert: '\n' } ] };
}

test('convertFirstLineToTitle headers and centers a plain first line', function(){
  var result = convertFirstLineToTitle(plainFirstLine());
  assert.strictEqual(result.changed, 2);

  var titleOp = result.delta.ops.find(op => op.attributes && op.attributes.header);
  assert.strictEqual(titleOp.attributes.header, 1);
  assert.strictEqual(titleOp.attributes.align, 'center');
});

test('convertFirstLineToTitle is a no-op when the first line is already a centered header', function(){
  var result = convertFirstLineToTitle(titledFirstLine());
  assert.strictEqual(result.changed, 0);
});

test('convertFirstLineToTitle only centers when the header is already present', function(){
  var delt = { ops: [ { insert: 'Chapter One' }, { insert: '\n', attributes: { header: 1 } }, { insert: 'body' }, { insert: '\n' } ] };
  var result = convertFirstLineToTitle(delt);
  assert.strictEqual(result.changed, 1);
});

//Regression: getFormat/formatLine were called at index 1 instead of 0, so a blank first line
//caused the *second* paragraph to be headered/centered instead of the actual first line.
test('convertFirstLineToTitle formats the first line, not the second, when the first line is blank', function(){
  var result = convertFirstLineToTitle(emptyFirstLine());
  assert.strictEqual(result.changed, 2);

  var firstOp = result.delta.ops[0];
  assert.strictEqual(firstOp.insert, '\n');
  assert.strictEqual(firstOp.attributes.header, 1);
  assert.strictEqual(firstOp.attributes.align, 'center');

  var secondLineOp = result.delta.ops.find(op => op.insert && op.insert.indexOf('Chapter One') > -1);
  assert.strictEqual(secondLineOp.attributes, undefined);
});

test('convertFirstLinesToTitles only marks chapters that actually changed', async function(){
  var plain = makeChapter(plainFirstLine());
  var alreadyTitled = makeChapter(titledFirstLine());

  var project = makeProject([plain, alreadyTitled]);

  await convertFirstLinesToTitles(project);

  assert.strictEqual(plain.hasUnsavedChanges, true);
  assert.notStrictEqual(alreadyTitled.hasUnsavedChanges, true);
});

//Regression: same missing project-level flag as the other "for all chapters" converters.
test('convertFirstLinesToTitles sets project.hasUnsavedChanges when a chapter changes', async function(){
  var project = makeProject([makeChapter(plainFirstLine())]);

  await convertFirstLinesToTitles(project);

  assert.strictEqual(project.hasUnsavedChanges, true);
});

test('convertFirstLinesToTitles leaves project.hasUnsavedChanges alone when nothing changes', async function(){
  var project = makeProject([makeChapter(titledFirstLine())]);

  await convertFirstLinesToTitles(project);

  assert.notStrictEqual(project.hasUnsavedChanges, true);
});

//Regression: a chapter whose file failed to load has null contents, which getContentsOrFile()
//passed straight through. Quill reads that as an empty document, which has no header/align at
//index 0, so convertFirstLineToTitle reported it as "changed" and the chapter's real content
//(still intact on disk) was overwritten with a lone blank titled line.
test('convertFirstLinesToTitles leaves an unloadable chapter untouched', async function(){
  var unloadable = makeUnloadableChapter();
  var project = makeProject([unloadable]);

  await convertFirstLinesToTitles(project);

  assert.strictEqual(unloadable.contents, null);
  assert.notStrictEqual(unloadable.hasUnsavedChanges, true);
  assert.notStrictEqual(project.hasUnsavedChanges, true);
});

test('convertFirstLinesToTitles still converts other chapters when one chapter is unloadable', async function(){
  var unloadable = makeUnloadableChapter();
  var plain = makeChapter(plainFirstLine());
  var project = makeProject([unloadable, plain]);

  await convertFirstLinesToTitles(project);

  assert.strictEqual(unloadable.contents, null);
  assert.strictEqual(plain.hasUnsavedChanges, true);
  assert.strictEqual(project.hasUnsavedChanges, true);
});
