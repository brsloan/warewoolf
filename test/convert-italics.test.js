require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');

const { makeChapter, makeProject } = require('./helpers');
const { convertMarkedItalics, convertMarkedItalicsForAllChapters } = require('../src/components/controllers/convert-italics');

function markedDelta(text){
  return { ops: [ { insert: text + '\n' } ] };
}

test('convertMarkedItalics italicizes marked text and strips the markers', function(){
  var result = convertMarkedItalics(markedDelta('a *word* here.'), '*');
  assert.strictEqual(result.changed, 1);

  var italicOp = result.delta.ops.find(op => op.attributes && op.attributes.italic);
  assert.strictEqual(italicOp.insert, 'word');
  assert.ok(!result.delta.ops.some(op => op.insert.includes('*')));
});

test('convertMarkedItalics reports no changes when the marker is absent', function(){
  var result = convertMarkedItalics(markedDelta('nothing marked here.'), '*');
  assert.strictEqual(result.changed, 0);
});

test('convertMarkedItalics handles multiple marked runs in one line', function(){
  var result = convertMarkedItalics(markedDelta('*one* and *two*.'), '*');
  assert.strictEqual(result.changed, 2);
});

//Regression: an empty marker turned the delimiter regex into /([^]+)/, which matches the whole
//text on every pass, so the delete/reinsert loop never terminated and hung the app.
test('convertMarkedItalics makes no changes and does not hang when the marker is empty', function(){
  var result = convertMarkedItalics(markedDelta('hello world.'), '');
  assert.strictEqual(result.changed, 0);
  assert.strictEqual(result.delta.ops[0].insert, 'hello world.\n');
});

//Regression: a multi-character marker was spliced into a [^...] character class, which excludes
//each individual character of the marker rather than the marker sequence. Any of those characters
//appearing inside the marked text (even as part of an unrelated word) broke the match entirely.
test('convertMarkedItalics handles multi-character markers whose characters also appear inside the marked text', function(){
  var result = convertMarkedItalics(markedDelta('ab banana ab end.'), 'ab');
  assert.strictEqual(result.changed, 1);

  var italicOp = result.delta.ops.find(op => op.attributes && op.attributes.italic);
  assert.strictEqual(italicOp.insert, ' banana ');
  assert.ok(!result.delta.ops.some(op => op.insert.includes('ab')));
});

test('convertMarkedItalicsForAllChapters only marks chapters that actually changed', function(){
  var hasMarker = makeChapter(markedDelta('a *word* here.'));
  var noMarker = makeChapter(markedDelta('nothing marked.'));

  var project = makeProject([hasMarker, noMarker]);

  convertMarkedItalicsForAllChapters(project, '*');

  assert.strictEqual(hasMarker.hasUnsavedChanges, true);
  assert.notStrictEqual(noMarker.hasUnsavedChanges, true);
});

//Regression: convertMarkedItalicsForAllChapters marked chapters dirty but never told the project,
//so the exit/open-project confirmation never fired after running this from the menu.
test('convertMarkedItalicsForAllChapters sets project.hasUnsavedChanges when a chapter changes', function(){
  var project = makeProject([makeChapter(markedDelta('a *word* here.'))]);

  convertMarkedItalicsForAllChapters(project, '*');

  assert.strictEqual(project.hasUnsavedChanges, true);
});

test('convertMarkedItalicsForAllChapters leaves project.hasUnsavedChanges alone when nothing changes', function(){
  var project = makeProject([makeChapter(markedDelta('nothing marked.'))]);

  convertMarkedItalicsForAllChapters(project, '*');

  assert.notStrictEqual(project.hasUnsavedChanges, true);
});
