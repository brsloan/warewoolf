require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');

const { makeChapter, makeProject } = require('./helpers');
const { getNextIndex, findInText, replaceAllInDelta, replaceAllInAllChapters, find } = require('../src/components/controllers/findreplace');

//find() needs a real editorQuill (it calls getText()/setSelection()/getSelection()), so these
//tests drive it with a Quill instance the same way the app does. Unlike quill-utils.js's
//getTempQuill(), the container is attached to the document - getSelection() needs a focusable,
//attached root to report a non-null range.
function makeEditorQuill(text){
  const Quill = require('quill');
  var container = document.createElement('div');
  document.body.appendChild(container);
  var quill = new Quill(container);
  quill.setText(text);
  return quill;
}

//Mirrors the relevant part of render.js's displayChapterByIndex: swap the editor's contents for
//the target chapter's and record which chapter is now active.
function makeDisplayChapterByIndex(project, editorQuill, chapters){
  return function(ind){
    project.activeChapterIndex = ind;
    editorQuill.setText(chapters[ind].contents);
  };
}

test('substring search finds a match at or after the starting index', function(){
  assert.strictEqual(getNextIndex('cat', 'the cat sat', 0, false), 4);
  assert.strictEqual(getNextIndex('cat', 'cat and cat', 1, false), 8);
  assert.strictEqual(getNextIndex('dog', 'the cat sat', 0, false), -1);
});

test('substring search matches inside a longer word, whole word search does not', function(){
  assert.strictEqual(getNextIndex('cat', 'concatenate', 0, false), 3);
  assert.strictEqual(getNextIndex('cat', 'concatenate', 0, true), -1);
});

test('whole word search matches a word bounded by punctuation or line ends', function(){
  assert.strictEqual(getNextIndex('cat', 'the cat.', 0, true), 4);
  assert.strictEqual(getNextIndex('cat', '"cat"', 0, true), 1);
  assert.strictEqual(getNextIndex('cat', 'cat', 0, true), 0);
  assert.strictEqual(getNextIndex('cat', 'a\ncat\nb', 0, true), 2);
});

//Regression: the search term is user input and was previously interpolated into a RegExp as-is.
test('whole word search treats regex metacharacters as literal text', function(){
  assert.strictEqual(getNextIndex('c.t', 'the cat sat', 0, true), -1);
  assert.strictEqual(getNextIndex('c.t', 'the c.t sat', 0, true), 4);
  assert.strictEqual(getNextIndex('a+b', 'x a+b y', 0, true), 2);
  assert.strictEqual(getNextIndex('(x)', 'say (x) now', 0, true), 4);
});

//Regression: an unescaped term containing an opening bracket threw out of the Find button handler.
test('whole word search does not throw on unbalanced regex syntax', async function(){
  assert.doesNotThrow(function(){ getNextIndex('(hi', 'a (hi b', 0, true); });
  assert.doesNotThrow(function(){ getNextIndex('a[b', 'x a[b y', 0, true); });
  assert.doesNotThrow(function(){ getNextIndex('*', 'x * y', 0, true); });
  assert.strictEqual(getNextIndex('(hi', 'a (hi b', 0, true), 2);
});

//Regression: \b only marks a word/non-word boundary, so a term made of punctuation never matched.
test('whole word search matches terms that start or end with punctuation', function(){
  assert.strictEqual(getNextIndex('--', 'a -- b', 0, true), 2);
  assert.strictEqual(getNextIndex("'tis", "so 'tis said", 0, true), 3);
  assert.strictEqual(getNextIndex('...', 'well ... then', 0, true), 5);
});

test('whole word search still rejects a punctuation term glued to a word', function(){
  assert.strictEqual(getNextIndex('-x', 'a -xy b', 0, true), -1);
  assert.strictEqual(getNextIndex('-x', 'a -x b', 0, true), 2);
});

test('whole word search handles terms containing an internal apostrophe or hyphen', function(){
  assert.strictEqual(getNextIndex("don't", "I don't go", 0, true), 2);
  assert.strictEqual(getNextIndex('well-known', 'a well-known fact', 0, true), 2);
});

test('findInText lowercases both sides when the search is case insensitive', function(){
  assert.strictEqual(findInText('CAT', 'the Cat sat', false, 0, false), 4);
  assert.strictEqual(findInText('CAT', 'the Cat sat', true, 0, false), -1);
  assert.strictEqual(findInText('CAT', 'the Cat.', false, 0, true), 4);
  assert.strictEqual(findInText('CAT', 'concatenate', false, 0, true), -1);
});

test('findInText respects the starting index in whole word mode', function(){
  assert.strictEqual(findInText('cat', 'cat and cat', true, 0, true), 0);
  assert.strictEqual(findInText('cat', 'cat and cat', true, 1, true), 8);
  assert.strictEqual(findInText('cat', 'cat and cat', true, 9, true), -1);
});

function textDelta(text){
  return { ops: [ { insert: text + '\n' } ] };
}

test('replaceAllInDelta replaces every occurrence and reports how many', function(){
  var result = replaceAllInDelta('cat', 'dog', true, textDelta('the cat sat on the cat mat'));
  assert.strictEqual(result.changed, 2);
  assert.strictEqual(result.delta.ops[0].insert, 'the dog sat on the dog mat\n');
});

test('replaceAllInDelta reports no changes when the term is absent', function(){
  var result = replaceAllInDelta('zzz', 'dog', true, textDelta('the cat sat'));
  assert.strictEqual(result.changed, 0);
});

test('replaceAllInDelta guards against an empty search term instead of looping forever', function(){
  var delt = textDelta('the cat sat');
  var result = replaceAllInDelta('', 'dog', true, delt);
  assert.strictEqual(result.changed, 0);
  assert.strictEqual(result.delta, delt);
});

test('replaceAllInAllChapters only marks chapters that actually changed', async function(){
  var hasMatch = makeChapter(textDelta('the cat sat'));
  var noMatch = makeChapter(textDelta('the dog sat'));

  var project = makeProject([hasMatch, noMatch]);

  await replaceAllInAllChapters(project, 'cat', 'dog', true);

  assert.strictEqual(hasMatch.hasUnsavedChanges, true);
  assert.notStrictEqual(noMatch.hasUnsavedChanges, true);
});

test('replaceAllInAllChapters also searches reference chapters', async function(){
  var chap = makeChapter(textDelta('no match here'));
  var refChap = makeChapter(textDelta('the cat sat'));

  var project = makeProject([chap], [refChap]);

  var numReplaced = await replaceAllInAllChapters(project, 'cat', 'dog', true);

  assert.strictEqual(numReplaced, 1);
  assert.strictEqual(refChap.hasUnsavedChanges, true);
});

//Regression: replaceAllInAllChapters marked individual chapters dirty but never told the project,
//so Replace All never tripped the exit/open-project unsaved-changes confirmation.
test('replaceAllInAllChapters sets project.hasUnsavedChanges when a chapter changes', async function(){
  var project = makeProject([makeChapter(textDelta('the cat sat'))]);

  await replaceAllInAllChapters(project, 'cat', 'dog', true);

  assert.strictEqual(project.hasUnsavedChanges, true);
});

test('replaceAllInAllChapters leaves project.hasUnsavedChanges alone when nothing changes', async function(){
  var project = makeProject([makeChapter(textDelta('the dog sat'))]);

  await replaceAllInAllChapters(project, 'cat', 'dog', true);

  assert.notStrictEqual(project.hasUnsavedChanges, true);
});

//Regression: a match starting exactly at the search's starting index (most notably index 0, where
//the cursor sits on a freshly opened chapter) used to be discarded by a heuristic that assumed it
//must be the previously-found match. It isn't, on a fresh search, and got skipped entirely.
test('find does not skip a match that starts at the search\'s starting index', function(){
  var editorQuill = makeEditorQuill('cat sat on the mat\n');
  var project = makeProject([]);

  var index = find(editorQuill, project, 'cat', true, 0, false, undefined, false);

  assert.strictEqual(index, 0);
  var selection = editorQuill.getSelection(true);
  assert.strictEqual(selection.index, 0);
  assert.strictEqual(selection.length, 3);
});

//Regression coverage for the caller-side fix: searching from the end of the current selection
//(rather than its start) is what lets a repeat Find move past the match that's currently selected
//without the old skip-hack, which incorrectly discarded matches on a fresh search too (above).
test('searching from the end of a just-found match advances to the next occurrence', function(){
  var editorQuill = makeEditorQuill('cat and cat\n');
  var project = makeProject([]);

  var first = find(editorQuill, project, 'cat', true, 0, false, undefined, false);
  assert.strictEqual(first, 0);

  var selection = editorQuill.getSelection(true);
  var second = find(editorQuill, project, 'cat', true, selection.index + selection.length, false, undefined, false);

  assert.strictEqual(second, 8);
});

//Regression: the recursive call made when a search-all-chapters wraparound landed back on the
//first chapter omitted wholeWordOnly, so it silently fell back to substring matching once the
//search wrapped. activeChapterIndex is set to the last chapter so the very first hop wraps to
//chapter 0 immediately, exercising that same transition.
test('find keeps respecting wholeWordOnly across a search-all-chapters wraparound', function(){
  var chapters = [
    { contents: 'concatenate\n' },     //substring-only match, must be skipped
    { contents: 'the cat sat\n' },     //whole-word match
    { contents: 'no match here\n' }    //active chapter search starts from
  ];
  var editorQuill = makeEditorQuill(chapters[2].contents);
  var project = makeProject(chapters, [], 2);
  var displayChapterByIndex = makeDisplayChapterByIndex(project, editorQuill, chapters);

  var index = find(editorQuill, project, 'cat', true, 0, true, displayChapterByIndex, true);

  assert.strictEqual(index, 4);
  assert.strictEqual(project.activeChapterIndex, 1);
});

//Regression: a failed search-all-chapters search re-walked chapters it had already searched during
//the wraparound, and left the view on whichever chapter that redundant pass happened to end on
//instead of restoring the chapter the search started from.
test('find visits each other chapter once and restores the starting chapter when nothing is found', function(){
  var chapters = [
    { contents: 'no match here\n' },
    { contents: 'nor here\n' },
    { contents: 'still nothing\n' }
  ];
  var editorQuill = makeEditorQuill(chapters[0].contents);
  var project = makeProject(chapters, [], 0);

  var visited = [];
  var displayChapterByIndex = function(ind){
    visited.push(ind);
    makeDisplayChapterByIndex(project, editorQuill, chapters)(ind);
  };

  var index = find(editorQuill, project, 'zzz', true, 0, true, displayChapterByIndex, false);

  assert.strictEqual(index, -1);
  assert.deepStrictEqual(visited, [1, 2, 0]);
  assert.strictEqual(project.activeChapterIndex, 0);
});
