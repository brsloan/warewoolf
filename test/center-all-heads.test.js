require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');

const { makeChapter, makeProject } = require('./helpers');
const { centerHeads, centerAllHeadingsInAllChaps } = require('../src/components/controllers/center-all-heads');

function headingDelta(text, opts){
  opts = opts || {};
  var headerAttrs = Object.assign({header: 1}, opts.centered ? {align: 'center'} : {});
  return { ops: [
    { insert: text },
    { insert: '\n', attributes: headerAttrs },
    { insert: 'Body text.' },
    { insert: '\n' }
  ]};
}

test('centerHeads centers an off-center header and reports it changed', function(){
  var result = centerHeads(headingDelta('Chapter One'));
  assert.strictEqual(result.changed, 1);

  var headerOp = result.delta.ops.find(op => op.attributes && op.attributes.header);
  assert.strictEqual(headerOp.attributes.align, 'center');
});

test('centerHeads leaves body text alone', function(){
  var result = centerHeads(headingDelta('Chapter One'));
  var bodyOp = result.delta.ops.find(op => op.insert.includes('Body text'));
  assert.strictEqual(bodyOp.attributes, undefined);
});

test('centerHeads is a no-op on an already-centered header', function(){
  var result = centerHeads(headingDelta('Chapter One', { centered: true }));
  assert.strictEqual(result.changed, 0);
});

test('centerHeads ignores non-header lines entirely', function(){
  var delt = { ops: [ { insert: 'Just a paragraph, not a heading.' }, { insert: '\n' } ] };
  var result = centerHeads(delt);
  assert.strictEqual(result.changed, 0);
  assert.strictEqual(result.delta.ops[0].attributes, undefined);
});

test('centerHeads counts every off-center header in a multi-header document', function(){
  var delt = { ops: [
    { insert: 'One' }, { insert: '\n', attributes: { header: 1 } },
    { insert: 'Two' }, { insert: '\n', attributes: { header: 1, align: 'center' } },
    { insert: 'Three' }, { insert: '\n', attributes: { header: 2 } }
  ]};
  var result = centerHeads(delt);
  assert.strictEqual(result.changed, 2);
});

test('centerAllHeadingsInAllChaps only marks chapters that actually changed', async function(){
  var needsCentering = makeChapter(headingDelta('Chapter One'));
  var alreadyCentered = makeChapter(headingDelta('Chapter Two', { centered: true }));
  var noHeaders = makeChapter({ ops: [{ insert: 'Just prose.\n' }] });

  var project = makeProject([needsCentering, alreadyCentered, noHeaders]);

  await centerAllHeadingsInAllChaps(project);

  assert.strictEqual(needsCentering.hasUnsavedChanges, true);
  assert.notStrictEqual(alreadyCentered.hasUnsavedChanges, true);
  assert.notStrictEqual(noHeaders.hasUnsavedChanges, true);
});

//Regression: centerAllHeadingsInAllChaps used to mark chapters dirty without ever telling the
//project itself it had unsaved changes, so the exit/open-project confirmation never fired.
test('centerAllHeadingsInAllChaps sets project.hasUnsavedChanges when a chapter changes', async function(){
  var project = makeProject([makeChapter(headingDelta('Chapter One'))]);

  await centerAllHeadingsInAllChaps(project);

  assert.strictEqual(project.hasUnsavedChanges, true);
});

test('centerAllHeadingsInAllChaps leaves project.hasUnsavedChanges alone when nothing changes', async function(){
  var project = makeProject([makeChapter(headingDelta('Chapter One', { centered: true }))]);

  await centerAllHeadingsInAllChaps(project);

  assert.notStrictEqual(project.hasUnsavedChanges, true);
});
