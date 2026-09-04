require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');

const { makeChapter, makeProject } = require('./helpers');
const { convertFirstLineToTitle, convertFirstLinesToTitles } = require('../src/components/controllers/convert-first-lines');

function plainFirstLine(){
  return { ops: [ { insert: 'Chapter One' }, { insert: '\n' }, { insert: 'body text' }, { insert: '\n' } ] };
}

function titledFirstLine(){
  return { ops: [ { insert: 'Chapter One' }, { insert: '\n', attributes: { header: 1, align: 'center' } }, { insert: 'body text' }, { insert: '\n' } ] };
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

test('convertFirstLinesToTitles only marks chapters that actually changed', function(){
  var plain = makeChapter(plainFirstLine());
  var alreadyTitled = makeChapter(titledFirstLine());

  var project = makeProject([plain, alreadyTitled]);

  convertFirstLinesToTitles(project);

  assert.strictEqual(plain.hasUnsavedChanges, true);
  assert.notStrictEqual(alreadyTitled.hasUnsavedChanges, true);
});

//Regression: same missing project-level flag as the other "for all chapters" converters.
test('convertFirstLinesToTitles sets project.hasUnsavedChanges when a chapter changes', function(){
  var project = makeProject([makeChapter(plainFirstLine())]);

  convertFirstLinesToTitles(project);

  assert.strictEqual(project.hasUnsavedChanges, true);
});

test('convertFirstLinesToTitles leaves project.hasUnsavedChanges alone when nothing changes', function(){
  var project = makeProject([makeChapter(titledFirstLine())]);

  convertFirstLinesToTitles(project);

  assert.notStrictEqual(project.hasUnsavedChanges, true);
});
