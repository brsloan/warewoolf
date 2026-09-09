require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');

const { makeChapter, makeProject } = require('./helpers');
const { getNextIndex, getNextMatch, compileSearch, expandReplacement, matchEntireText, findInText, replaceAllInDelta, replaceAllInAllChapters, find } = require('../src/components/controllers/findreplace');

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
  var result = replaceAllInDelta('cat', 'dog', textDelta('the cat sat on the cat mat'));
  assert.strictEqual(result.changed, 2);
  assert.strictEqual(result.delta.ops[0].insert, 'the dog sat on the dog mat\n');
});

test('replaceAllInDelta reports no changes when the term is absent', function(){
  var result = replaceAllInDelta('zzz', 'dog', textDelta('the cat sat'));
  assert.strictEqual(result.changed, 0);
});

test('replaceAllInDelta guards against an empty search term instead of looping forever', function(){
  var delt = textDelta('the cat sat');
  var result = replaceAllInDelta('', 'dog', delt);
  assert.strictEqual(result.changed, 0);
  assert.strictEqual(result.delta, delt);
});

//Regression: a footnote marker is an embed, and Quill drops embeds from getText() entirely - so
//every index past the marker came back one short of the index deleteText/insertText actually act
//on, and Replace All cut from the wrong place ("the cat sat" losing " ca" rather than "cat").
//getIndexableText counts one U+FFFC per embed, matching Quill's own index space.
test('replaceAllInDelta replaces correctly in a chapter containing a footnote marker', function(){
  const { registerFootnoteBlots } = require('../src/components/blots/footnotes');
  registerFootnoteBlots();

  var delt = { ops: [
    { insert: 'The cat sat' },
    { insert: { footnote: { n: '1' } } },
    { insert: ' and the cat slept.\n' },
    { insert: 'A note about cats.' },
    { insert: '\n', attributes: { footnoteBody: '1' } }
  ]};

  var result = replaceAllInDelta('cat', 'dog', delt);

  assert.strictEqual(result.changed, 3);
  assert.deepStrictEqual(result.delta.ops, [
    { insert: 'The dog sat' },
    { insert: { footnote: { n: '1' } } },
    { insert: ' and the dog slept.\nA note about dogs.' },
    { insert: '\n', attributes: { footnoteBody: '1' } }
  ]);
});

test('replaceAllInAllChapters only marks chapters that actually changed', async function(){
  var hasMatch = makeChapter(textDelta('the cat sat'));
  var noMatch = makeChapter(textDelta('the dog sat'));

  var project = makeProject([hasMatch, noMatch]);

  await replaceAllInAllChapters(project, 'cat', 'dog');

  assert.strictEqual(hasMatch.hasUnsavedChanges, true);
  assert.notStrictEqual(noMatch.hasUnsavedChanges, true);
});

test('replaceAllInAllChapters also searches reference chapters', async function(){
  var chap = makeChapter(textDelta('no match here'));
  var refChap = makeChapter(textDelta('the cat sat'));

  var project = makeProject([chap], [refChap]);

  var numReplaced = await replaceAllInAllChapters(project, 'cat', 'dog');

  assert.strictEqual(numReplaced, 1);
  assert.strictEqual(refChap.hasUnsavedChanges, true);
});

//Regression: replaceAllInAllChapters marked individual chapters dirty but never told the project,
//so Replace All never tripped the exit/open-project unsaved-changes confirmation.
test('replaceAllInAllChapters sets project.hasUnsavedChanges when a chapter changes', async function(){
  var project = makeProject([makeChapter(textDelta('the cat sat'))]);

  await replaceAllInAllChapters(project, 'cat', 'dog');

  assert.strictEqual(project.hasUnsavedChanges, true);
});

test('replaceAllInAllChapters leaves project.hasUnsavedChanges alone when nothing changes', async function(){
  var project = makeProject([makeChapter(textDelta('the dog sat'))]);

  await replaceAllInAllChapters(project, 'cat', 'dog');

  assert.notStrictEqual(project.hasUnsavedChanges, true);
});

//Regression: a match starting exactly at the search's starting index (most notably index 0, where
//the cursor sits on a freshly opened chapter) used to be discarded by a heuristic that assumed it
//must be the previously-found match. It isn't, on a fresh search, and got skipped entirely.
test('find does not skip a match that starts at the search\'s starting index', function(){
  var editorQuill = makeEditorQuill('cat sat on the mat\n');
  var project = makeProject([]);

  var index = find(editorQuill, project, 'cat', 0, false, undefined);

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

  var first = find(editorQuill, project, 'cat', 0, false, undefined);
  assert.strictEqual(first, 0);

  var selection = editorQuill.getSelection(true);
  var second = find(editorQuill, project, 'cat', selection.index + selection.length, false, undefined);

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

  var index = find(editorQuill, project, 'cat', 0, true, displayChapterByIndex, { wholeWordOnly: true });

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

  var index = find(editorQuill, project, 'zzz', 0, true, displayChapterByIndex);

  assert.strictEqual(index, -1);
  assert.deepStrictEqual(visited, [1, 2, 0]);
  assert.strictEqual(project.activeChapterIndex, 0);
});

//---------------------------------------------------------------------------
// straight quotes in the search box, curly ones in the manuscript
//---------------------------------------------------------------------------

//A writer's fingers still type a straight quote into the search box long after the editors stopped
//putting one in the manuscript (see models/autocorrect.js), so the commonest search there is - for
//a line of dialogue, or for a contraction - has to keep working.
test('a straight quote in the search term finds a curly one', function(){
  assert.strictEqual(getNextIndex('"', '“Get out,” she said.', 0, false), 0);
  assert.strictEqual(getNextIndex("don't", 'and he don’t stop', 0, false), 7);
});

test('the index a folded match reports still describes the untouched text', function(){
  var text = 'she said “get out” loudly';

  //Pointing at the closing curly quote, not at some position shifted by the folding.
  assert.strictEqual(getNextIndex('"', text, 10, false), 17);
  assert.strictEqual(text[17], '”');
});

test('a curly quote in the search term means that exact quote', function(){
  //So one particular quote can still be hunted down: the opening quote is not found by searching
  //for a closing one.
  assert.strictEqual(getNextIndex('”', '“Get out,” she said.', 0, false), 9);
  assert.strictEqual(getNextIndex('“', '“Get out,” she said.', 1, false), -1);
});

test('the low and reversed quotes an imported manuscript brings with it are folded too', function(){
  assert.strictEqual(getNextIndex('"', '„Raus!‟', 0, false), 0);
  assert.strictEqual(getNextIndex("'", '‚so‛', 0, false), 0);
});

test('a search term with no quote in it is matched against the text as written', function(){
  assert.strictEqual(getNextIndex('out', '“Get out,” she said.', 0, false), 5);
  assert.strictEqual(getNextIndex('Get out,”', '“Get out,” she said.', 0, false), 1);
});

test('whole word search folds quotes the same way', function(){
  assert.strictEqual(getNextIndex("don't", 'and he don’t stop', 0, true), 7);
});

test('Replace All reaches curly quotes through a straight search term', function(){
  var delt = { ops: [{ insert: 'and he don’t stop\n' }] };

  var result = replaceAllInDelta("don't", 'will not', delt);

  assert.strictEqual(result.changed, 1);
  assert.strictEqual(result.delta.ops[0].insert, 'and he will not stop\n');
});

//---------------------------------------------------------------------------
// Use Regex
//---------------------------------------------------------------------------

const REGEX = { useRegex: true };

//A match now carries its captures as well as its index and length, so these assert on the span
//rather than on the whole object.
function assertMatch(match, index, length){
  assert.notStrictEqual(match, null, 'expected a match at ' + index);
  assert.strictEqual(match.index, index);
  assert.strictEqual(match.length, length);
}

test('a regex match reports its own length, not the pattern\'s', function(){
  assertMatch(getNextMatch('c.t', 'the cat sat', 0, REGEX), 4, 3);
  assertMatch(getNextMatch('sa+t', 'the caaat saaat', 0, REGEX), 10, 5);
  assertMatch(getNextMatch('colou?r', 'the color of it', 0, REGEX), 4, 5);
});

test('the pattern is literal text unless Use Regex is on', function(){
  assert.strictEqual(getNextMatch('c.t', 'the cat sat', 0, {}), null);
  assertMatch(getNextMatch('c.t', 'a c.t here', 0, {}), 2, 3);
});

//Lowercasing the pattern to search case-insensitively would turn \S into \s and \W into \w, quietly
//inverting it - so regex mode has to use the 'i' flag instead.
test('a case insensitive regex search uses the flag rather than lowercasing the pattern', function(){
  var insensitive = { useRegex: true, caseSensitive: false };

  assertMatch(getNextMatch('\\S+', '  Word  ', 0, insensitive), 2, 4);
  assertMatch(getNextMatch('\\W', 'ab!cd', 0, insensitive), 2, 1);
  assertMatch(getNextMatch('CAT', 'the Cat sat', 0, insensitive), 4, 3);
  assert.strictEqual(getNextMatch('CAT', 'the Cat sat', 0, REGEX), null);
});

test('Whole Word Only wraps the pattern rather than rewriting it', function(){
  var opts = { useRegex: true, wholeWordOnly: true };

  assertMatch(getNextMatch('cat|dog', 'the dog sat', 0, opts), 4, 3);
  //Without the non-capturing group the boundaries would bind to one alternative only, and this
  //would match inside "dogged" or "catty".
  assert.strictEqual(getNextMatch('cat|dog', 'a dogged catty day', 0, opts), null);
  assertMatch(getNextMatch('c.t', 'concatenate the c-t', 0, opts), 16, 3);
});

//'m' is set so that a writer's ^ and $ mean a line, which is what they can see; 's' deliberately is
//not, so that "." stops at a paragraph break rather than running on through the chapter.
test('^ and $ anchor to a line, and . does not cross one', function(){
  assertMatch(getNextMatch('^and', 'she said\nand he left', 0, REGEX), 9, 3);
  assertMatch(getNextMatch('said$', 'she said\nand he left', 0, REGEX), 4, 4);
  assert.strictEqual(getNextMatch('said.and', 'she said\nand he left', 0, REGEX), null);
  assertMatch(getNextMatch('said\\nand', 'she said\nand he left', 0, REGEX), 4, 8);
});

test('a straight quote in a pattern still finds the curly one', function(){
  assertMatch(getNextMatch("don't|won't", 'and he don’t stop', 0, REGEX), 7, 5);
});

//---------------------------------------------------------------------------
// a pattern that will not compile
//---------------------------------------------------------------------------

test('compileSearch reports why a half-typed pattern is not a regex yet', function(){
  var search = compileSearch('(', REGEX);

  assert.strictEqual(search.findFrom, undefined);
  assert.strictEqual(typeof search.error, 'string');
  assert.ok(search.error.length > 0);
  //The reason alone: the pattern is already in the box in front of the writer, and Whole Word Only
  //may have wrapped it into something they never typed.
  assert.strictEqual(search.error.indexOf('Invalid regular expression'), -1);
});

test('a pattern that is not a regex is still fine as literal text', function(){
  assert.strictEqual(compileSearch('(', {}).error, undefined);
  assert.strictEqual(compileSearch('(', { wholeWordOnly: true }).error, undefined);
});

test('an uncompilable pattern finds nothing instead of throwing', function(){
  assert.doesNotThrow(function(){ getNextMatch('[a-', 'a b c', 0, REGEX); });
  assert.strictEqual(getNextMatch('[a-', 'a b c', 0, REGEX), null);

  var editorQuill = makeEditorQuill('the cat sat\n');
  assert.strictEqual(find(editorQuill, makeProject([]), '(', 0, false, undefined, REGEX), -1);
});

//Replace All runs over every chapter in the project, so a pattern that will not compile has to be
//refused before anything is edited rather than part-way through.
test('Replace All refuses an uncompilable pattern and leaves the chapter untouched', function(){
  var delt = textDelta('the cat sat');

  var result = replaceAllInDelta('a{2,1}', 'dog', delt, REGEX);

  assert.strictEqual(result.changed, 0);
  assert.strictEqual(result.delta, delt);
  assert.strictEqual(typeof result.error, 'string');
});

test('Replace All reports no error for a pattern that compiles', function(){
  var result = replaceAllInDelta('c.t', 'dog', textDelta('the cat sat'), REGEX);

  assert.strictEqual(result.error, undefined);
  assert.strictEqual(result.changed, 1);
});

//---------------------------------------------------------------------------
// matches of nothing
//---------------------------------------------------------------------------

//"x*", "\b", "^" and a lookahead all match without consuming anything. Replacing such a match would
//drop the replacement between every pair of characters in the manuscript, and with an empty
//replacement the search would never advance past it.
test('a match of nothing is stepped over rather than returned', function(){
  assertMatch(getNextMatch('x*', 'the xxx cat', 0, REGEX), 4, 3);
  assert.strictEqual(getNextMatch('x*', 'the cat sat', 0, REGEX), null);
  assert.strictEqual(getNextMatch('\\b', 'the cat', 0, REGEX), null);
  assert.strictEqual(getNextMatch('(?=cat)', 'the cat', 0, REGEX), null);
});

test('Replace All terminates on a pattern that can match nothing, replacing only real runs', function(){
  var result = replaceAllInDelta('x*', '-', textDelta('a xx b x c'), REGEX);

  assert.strictEqual(result.changed, 2);
  assert.strictEqual(result.delta.ops[0].insert, 'a - b - c\n');
});

test('Replace All terminates when a pattern that can match nothing never matches anything', function(){
  var result = replaceAllInDelta('x*', '-', textDelta('the cat sat'), REGEX);

  assert.strictEqual(result.changed, 0);
});

//Regex mode makes an empty replacement reachable alongside a zero-length match, which is the pair
//that would otherwise leave the loop standing still.
test('Replace All terminates when the replacement is empty too', function(){
  var result = replaceAllInDelta('\\s+$', '', textDelta('trailing space   '), REGEX);

  assert.strictEqual(result.changed, 1);
  assert.strictEqual(result.delta.ops[0].insert, 'trailing space\n');
});

//---------------------------------------------------------------------------
// capture groups in the replacement
//---------------------------------------------------------------------------

function capturesOf(pattern, text){
  return getNextMatch(pattern, text, 0, REGEX).captures;
}

test('a regex match carries its capture groups', function(){
  var captures = capturesOf('(\\w+), (\\w+)', 'Smith, John wrote');

  assert.strictEqual(captures[0], 'Smith, John');
  assert.strictEqual(captures[1], 'Smith');
  assert.strictEqual(captures[2], 'John');
});

test('$1 and $& are expanded from the match', function(){
  var match = getNextMatch('(\\w+), (\\w+)', 'Smith, John wrote', 0, REGEX);

  assert.strictEqual(expandReplacement(match, '$2 $1', REGEX), 'John Smith');
  assert.strictEqual(expandReplacement(match, '[$&]', REGEX), '[Smith, John]');
});

test('$$ is a literal dollar, and a lone $ is left alone', function(){
  var match = getNextMatch('(cat)', 'the cat sat', 0, REGEX);

  assert.strictEqual(expandReplacement(match, '$$1', REGEX), '$1');
  assert.strictEqual(expandReplacement(match, '$$$1', REGEX), '$cat');
  assert.strictEqual(expandReplacement(match, 'costs $5 today', REGEX), 'costs $5 today');
});

//A group past the end of the pattern is left as typed, the same as JavaScript's own replace does.
test('a group number the pattern does not have is left as typed', function(){
  var match = getNextMatch('(cat)', 'the cat sat', 0, REGEX);

  assert.strictEqual(expandReplacement(match, '$1 $7', REGEX), 'cat $7');
});

//The other side of an alternation takes no part in the match, and counts as empty rather than
//printing the word "undefined" into the manuscript.
test('a group that took no part in the match expands to nothing', function(){
  var match = getNextMatch('(cat)|(dog)', 'the dog sat', 0, REGEX);

  assert.strictEqual(expandReplacement(match, '[$1][$2]', REGEX), '[][dog]');
});

//Outside regex mode a '$' a writer typed is a dollar sign, which is the commoner thing to want in
//prose - so nothing is expanded there at all.
test('$1 is literal text when Use Regex is off', function(){
  var match = getNextMatch('cat', 'the cat sat', 0, {});

  assert.strictEqual(expandReplacement(match, '$1 and $&', {}), '$1 and $&');
  assert.strictEqual(expandReplacement(match, 'a $5 note', {}), 'a $5 note');
});

test('Replace All expands a capture group per match', function(){
  var result = replaceAllInDelta('(\\w+) said', '"$1 remarked"', textDelta('Ann said and Bob said'), REGEX);

  assert.strictEqual(result.changed, 2);
  assert.strictEqual(result.delta.ops[0].insert, '"Ann remarked" and "Bob remarked"\n');
});

//Regression risk from the expansion: the loop resumes past the text actually inserted, which is the
//expanded replacement and not the "$1" the writer typed.
test('Replace All resumes past the expanded replacement, not the typed one', function(){
  var result = replaceAllInDelta('(a+)', '<$1>', textDelta('aa b aaa'), REGEX);

  assert.strictEqual(result.changed, 2);
  assert.strictEqual(result.delta.ops[0].insert, '<aa> b <aaa>\n');
});

test('Replace All leaves a dollar alone when Use Regex is off', function(){
  var result = replaceAllInDelta('cost', '$1', textDelta('the cost of it'), {});

  assert.strictEqual(result.changed, 1);
  assert.strictEqual(result.delta.ops[0].insert, 'the $1 of it\n');
});

//---------------------------------------------------------------------------
// is the selection still the match?
//---------------------------------------------------------------------------

test('matchEntireText accepts only a match covering the whole of the text', function(){
  assertMatch(matchEntireText('c.t', 'cat', REGEX), 0, 3);
  assert.strictEqual(matchEntireText('c.t', 'the cat sat', REGEX), null);
  assert.strictEqual(matchEntireText('c.t', 'cats', REGEX), null);
  assert.strictEqual(matchEntireText('c.t', 'dog', REGEX), null);
});

test('matchEntireText hands back the captures for the replacement', function(){
  var match = matchEntireText('(\\w+), (\\w+)', 'Smith, John', REGEX);

  assert.strictEqual(expandReplacement(match, '$2 $1', REGEX), 'John Smith');
});

test('matchEntireText compares literally when Use Regex is off', function(){
  assertMatch(matchEntireText('cat', 'cat', {}), 0, 3);
  assert.strictEqual(matchEntireText('c.t', 'cat', {}), null);
  assert.strictEqual(matchEntireText('cat', 'CAT', {}), null);
  assertMatch(matchEntireText('cat', 'CAT', { caseSensitive: false }), 0, 3);
});

test('matchEntireText refuses an empty term or an uncompilable pattern', function(){
  assert.strictEqual(matchEntireText('', 'cat', {}), null);
  assert.strictEqual(matchEntireText('(', 'cat', REGEX), null);
});

//Regression: Find highlights the curly-quoted "don’t" when a writer types the straight-quoted
//"don't", but Replace compared the selection with what was typed and so refused to replace what
//Find had just found. Replace All was never affected, which is what hid it.
test('the selection Find highlighted through a folded quote is still replaceable', function(){
  assertMatch(matchEntireText("don't", 'don’t', {}), 0, 5);
  assertMatch(matchEntireText('"', '“', {}), 0, 1);
});
