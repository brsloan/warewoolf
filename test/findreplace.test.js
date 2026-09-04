const test = require('node:test');
const assert = require('node:assert');

const { getNextIndex, findInText } = require('../src/components/controllers/findreplace');

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
test('whole word search does not throw on unbalanced regex syntax', function(){
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
