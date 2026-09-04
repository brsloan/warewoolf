require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');

const { makeChapter, makeProject } = require('./helpers');
const { convertMarkedTabs, convertMarkedTabsForAllChapters } = require('../src/components/controllers/convert-tabs');

function markedDelta(text){
  return { ops: [ { insert: text + '\n' } ] };
}

test('convertMarkedTabs replaces the marker with a real tab', function(){
  var result = convertMarkedTabs(markedDelta('>>indented text'), '>>');
  assert.strictEqual(result.changed, 1);
  assert.strictEqual(result.delta.ops[0].insert, '\tindented text\n');
});

test('convertMarkedTabs reports no changes when the marker is absent', function(){
  var result = convertMarkedTabs(markedDelta('no marker here'), '>>');
  assert.strictEqual(result.changed, 0);
});

test('convertMarkedTabsForAllChapters only marks chapters that actually changed', function(){
  var hasMarker = makeChapter(markedDelta('>>indented text'));
  var noMarker = makeChapter(markedDelta('no marker here'));

  var project = makeProject([hasMarker, noMarker]);

  convertMarkedTabsForAllChapters(project, '>>');

  assert.strictEqual(hasMarker.hasUnsavedChanges, true);
  assert.notStrictEqual(noMarker.hasUnsavedChanges, true);
});

//Regression: same missing project-level flag as the other "for all chapters" converters.
test('convertMarkedTabsForAllChapters sets project.hasUnsavedChanges when a chapter changes', function(){
  var project = makeProject([makeChapter(markedDelta('>>indented text'))]);

  convertMarkedTabsForAllChapters(project, '>>');

  assert.strictEqual(project.hasUnsavedChanges, true);
});

test('convertMarkedTabsForAllChapters leaves project.hasUnsavedChanges alone when nothing changes', function(){
  var project = makeProject([makeChapter(markedDelta('no marker here'))]);

  convertMarkedTabsForAllChapters(project, '>>');

  assert.notStrictEqual(project.hasUnsavedChanges, true);
});
