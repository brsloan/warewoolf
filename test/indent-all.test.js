require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');

const { makeChapter, makeProject } = require('./helpers');
const { indentAllParas, indentAllParasInAllChaps } = require('../src/components/controllers/indent-all');

function bodyDelta(text){
  return { ops: [ { insert: 'Header' }, { insert: '\n', attributes: { header: 1 } }, { insert: text }, { insert: '\n' } ] };
}

test('indentAllParas tabs an un-indented paragraph', function(){
  var result = indentAllParas(bodyDelta('Plain paragraph.'));
  assert.strictEqual(result.changed, 1);
  assert.ok(result.delta.ops.some(op => op.insert.startsWith('\tPlain paragraph.')));
});

test('indentAllParas is a no-op on a paragraph that already starts with a tab', function(){
  var result = indentAllParas(bodyDelta('\tAlready tabbed.'));
  assert.strictEqual(result.changed, 0);
});

test('indentAllParas does not indent a header line', function(){
  var delt = { ops: [ { insert: 'A Header' }, { insert: '\n', attributes: { header: 1 } } ] };
  var result = indentAllParas(delt);
  assert.strictEqual(result.changed, 0);
});

test('indentAllParas does not indent a list item', function(){
  var delt = { ops: [ { insert: 'Item' }, { insert: '\n', attributes: { list: 'bullet' } } ] };
  var result = indentAllParas(delt);
  assert.strictEqual(result.changed, 0);
});

test('indentAllParas leaves a blank line alone', function(){
  var delt = { ops: [ { insert: 'Para one.' }, { insert: '\n' }, { insert: '\n' } ] };
  var result = indentAllParas(delt);
  //Only "Para one." needs indenting; the blank line in between does not.
  assert.strictEqual(result.changed, 1);
});

test('indentAllParasInAllChaps only marks chapters that actually changed', function(){
  var needsIndent = makeChapter(bodyDelta('Plain paragraph.'));
  var alreadyIndented = makeChapter(bodyDelta('\tAlready tabbed.'));

  var project = makeProject([needsIndent, alreadyIndented]);

  indentAllParasInAllChaps(project);

  assert.strictEqual(needsIndent.hasUnsavedChanges, true);
  assert.notStrictEqual(alreadyIndented.hasUnsavedChanges, true);
});

//Regression: same missing project-level flag as centerAllHeadingsInAllChaps.
test('indentAllParasInAllChaps sets project.hasUnsavedChanges when a chapter changes', function(){
  var project = makeProject([makeChapter(bodyDelta('Plain paragraph.'))]);

  indentAllParasInAllChaps(project);

  assert.strictEqual(project.hasUnsavedChanges, true);
});

test('indentAllParasInAllChaps leaves project.hasUnsavedChanges alone when nothing changes', function(){
  var project = makeProject([makeChapter(bodyDelta('\tAlready tabbed.'))]);

  indentAllParasInAllChaps(project);

  assert.notStrictEqual(project.hasUnsavedChanges, true);
});
