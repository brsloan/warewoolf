const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { setLogDirectory } = require('../src/components/controllers/error-log');
const { runSpellcheck, addWordToPersonalDictFile, getBeginningOfCurrentWord } = require('../src/components/controllers/spellcheck');

function tempDir(prefix){
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

//A small hand-rolled dictionary instead of the real (946KB) shipped one, so tests stay fast and
//don't depend on which real words happen to be in en_US-large.dic. The aff only needs to be
//well-formed enough for nspell to parse - no affix rules are needed for these tests.
const DICT_WORDS = ['the', 'cat', 'sat', 'on', 'mat', 'boys', 'shoes', 'are', 'here', 'she', 'said', 'stop', "don't"];

function writeFixtureDictionary(appDir){
  var dictDir = path.join(appDir, 'dictionaries');
  fs.mkdirSync(dictDir, { recursive: true });
  fs.writeFileSync(path.join(dictDir, 'en_US-large.aff'), 'SET UTF-8\n', 'utf8');
  fs.writeFileSync(path.join(dictDir, 'en_US-large.dic'), DICT_WORDS.length + '\n' + DICT_WORDS.join('\n') + '\n', 'utf8');
}

function makeSysDirectories(){
  var appDir = tempDir('warewoolf-spellcheck-app-');
  var userDataDir = tempDir('warewoolf-spellcheck-userdata-');
  writeFixtureDictionary(appDir);
  return { app: appDir, userData: userDataDir };
}

//spellcheck.js only ever calls getText() on the editor it's given, so a bare object stands in
//fine - no need for a real Quill instance like findreplace.test.js uses.
function makeEditorQuill(text){
  return { getText: function(){ return text; } };
}

test.beforeEach(function(){
  setLogDirectory(tempDir('warewoolf-spellcheck-log-'));
});

test('runSpellcheck finds the first misspelled word and its position', function(){
  var sysDirectories = makeSysDirectories();
  var editorQuill = makeEditorQuill('the cat sat on the zxqzxq mat\n');

  var result = runSpellcheck(editorQuill, sysDirectories);

  assert.strictEqual(result.word, 'zxqzxq');
  assert.strictEqual(editorQuill.getText().slice(result.index, result.index + result.word.length), 'zxqzxq');
});

test('runSpellcheck returns null when every word is valid', function(){
  var sysDirectories = makeSysDirectories();
  var editorQuill = makeEditorQuill('the cat sat on the mat\n');

  assert.strictEqual(runSpellcheck(editorQuill, sysDirectories), null);
});

test('runSpellcheck starts searching from startingIndex', function(){
  var sysDirectories = makeSysDirectories();
  var editorQuill = makeEditorQuill('zxqzxq the cat sat\n');

  //Skip past the leading misspelling entirely.
  var result = runSpellcheck(editorQuill, sysDirectories, 7);

  assert.strictEqual(result, null);
});

test('runSpellcheck skips words on the ignore list', function(){
  var sysDirectories = makeSysDirectories();
  var editorQuill = makeEditorQuill('the zxqzxq cat sat\n');

  var result = runSpellcheck(editorQuill, sysDirectories, 0, ['zxqzxq']);

  assert.strictEqual(result, null);
});

test('runSpellcheck treats a digit sequence as a number, not a misspelling', function(){
  var sysDirectories = makeSysDirectories();
  var editorQuill = makeEditorQuill("the cat sat on the 1990s\n");

  assert.strictEqual(runSpellcheck(editorQuill, sysDirectories), null);
});

//Regression: wordRegx used to be /(\w'*)+/, which swallows any apostrophe immediately following a
//word - not just apostrophes internal to it. That flagged ordinary plural possessives like
//"boys'" as misspelled, since "boys'" (with the trailing apostrophe) isn't a dictionary word.
test('runSpellcheck does not flag a trailing possessive apostrophe as part of the word', function(){
  var sysDirectories = makeSysDirectories();
  var editorQuill = makeEditorQuill("the boys' shoes are here\n");

  assert.strictEqual(runSpellcheck(editorQuill, sysDirectories), null);
});

test('runSpellcheck still keeps an internal apostrophe as part of the word', function(){
  var sysDirectories = makeSysDirectories();
  var editorQuillValid = makeEditorQuill("she said don't stop\n");
  assert.strictEqual(runSpellcheck(editorQuillValid, sysDirectories), null);

  //Same contraction missing its apostrophe is a different, genuinely misspelled token.
  var editorQuillInvalid = makeEditorQuill("she said dont stop\n");
  var result = runSpellcheck(editorQuillInvalid, sysDirectories);
  assert.strictEqual(result.word, 'dont');
});

//Regression: a failure inside loadDictionaries (missing/unreadable dictionary files) was logged
//but the function fell through and returned undefined. runSpellcheck passed that straight into
//findInvalidWord, which called .correct() on undefined and crashed instead of failing gracefully.
test('runSpellcheck does not throw when the dictionary files are missing', function(){
  var sysDirectories = { app: tempDir('warewoolf-spellcheck-missing-'), userData: tempDir('warewoolf-spellcheck-userdata-') };
  var editorQuill = makeEditorQuill('the cat sat\n');

  var result;
  assert.doesNotThrow(function(){
    result = runSpellcheck(editorQuill, sysDirectories);
  });
  assert.strictEqual(result, null);
});

//Regression: personal.dic is seeded as "WareWoolf\n". Splitting that on "\n" leaves a trailing
//empty entry, and appending a new word re-joined that empty entry back into the middle of the
//file instead of dropping it, leaving a stray blank line.
test('addWordToPersonalDictFile does not leave a blank line in personal.dic', function(){
  var userDataDir = tempDir('warewoolf-spellcheck-userdata-');
  var dictDir = path.join(userDataDir, 'dictionaries');
  fs.mkdirSync(dictDir, { recursive: true });
  var personalPath = path.join(dictDir, 'personal.dic');
  fs.writeFileSync(personalPath, 'WareWoolf\n', 'utf8');

  addWordToPersonalDictFile('Nebula', { userData: userDataDir });

  var contents = fs.readFileSync(personalPath, 'utf8');
  assert.ok(!contents.includes('\n\n'), 'expected no blank line in: ' + JSON.stringify(contents));
  assert.deepStrictEqual(contents.split('\n').filter(function(w){ return w.trim() !== ''; }), ['WareWoolf', 'Nebula']);
});

test('addWordToPersonalDictFile does not add the same word twice', function(){
  var userDataDir = tempDir('warewoolf-spellcheck-userdata-');
  var dictDir = path.join(userDataDir, 'dictionaries');
  fs.mkdirSync(dictDir, { recursive: true });
  var personalPath = path.join(dictDir, 'personal.dic');
  fs.writeFileSync(personalPath, 'WareWoolf\n', 'utf8');

  addWordToPersonalDictFile('Nebula', { userData: userDataDir });
  var afterFirstAdd = fs.readFileSync(personalPath, 'utf8');

  addWordToPersonalDictFile('Nebula', { userData: userDataDir });
  var afterSecondAdd = fs.readFileSync(personalPath, 'utf8');

  assert.strictEqual(afterSecondAdd, afterFirstAdd);
});

test('a word added to the personal dictionary is accepted on the next spellcheck', function(){
  var sysDirectories = makeSysDirectories();
  var editorQuill = makeEditorQuill('the cat sat on the nebulon mat\n');

  var before = runSpellcheck(editorQuill, sysDirectories);
  assert.strictEqual(before.word, 'nebulon');

  addWordToPersonalDictFile('nebulon', sysDirectories);

  assert.strictEqual(runSpellcheck(editorQuill, sysDirectories), null);
});

test('getBeginningOfCurrentWord finds the start of the word at the cursor', function(){
  assert.strictEqual(getBeginningOfCurrentWord('the cat sat', 11), 8);
  assert.strictEqual(getBeginningOfCurrentWord('the cat sat', 8), 8);
});

test('getBeginningOfCurrentWord treats whitespace, periods and hyphens as word borders', function(){
  assert.strictEqual(getBeginningOfCurrentWord('wait. sat', 9), 6);
  assert.strictEqual(getBeginningOfCurrentWord('well-known', 10), 5);
});

//Matches findInvalidWord's own wordRegx, which keeps an internal apostrophe as part of the word.
test('getBeginningOfCurrentWord does not treat an internal apostrophe as a word border', function(){
  assert.strictEqual(getBeginningOfCurrentWord("don't stop", 5), 0);
});

test('getBeginningOfCurrentWord returns 0 at the start of the text', function(){
  assert.strictEqual(getBeginningOfCurrentWord('hello', 0), 0);
});
