const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { setPlatform } = require('../src/components/controllers/error-log');
const { createPlatform } = require('../src/components/controllers/platform');
const { createNodeBacking } = require('../src/components/controllers/platform-node');
const {
  runSpellcheck, addWordToPersonalDictFile, getBeginningOfCurrentWord,
  setSelectedDictionaries, setProjectWords, releaseSpellchecker
} = require('../src/components/controllers/spellcheck');
const { installBridge, uninstallBridge } = require('./fake-bridge');

function tempDir(prefix){
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

//A small hand-rolled dictionary instead of the real (946KB) shipped one, so tests stay fast and
//don't depend on which real words happen to be in en_US-large.dic. The aff only needs to be
//well-formed enough for nspell to parse - no affix rules are needed for these tests.
const DICT_WORDS = ['the', 'cat', 'sat', 'on', 'mat', 'boys', 'shoes', 'are', 'here', 'she', 'said', 'stop', "don't"];

function writeFixtureDictionary(appDir){
  writeDictFixture(appDir, 'en_US-large', DICT_WORDS);
}

function writeDictFixture(appDir, id, words){
  var dictDir = path.join(appDir, 'dictionaries');
  fs.mkdirSync(dictDir, { recursive: true });
  fs.writeFileSync(path.join(dictDir, id + '.aff'), 'SET UTF-8\n', 'utf8');
  fs.writeFileSync(path.join(dictDir, id + '.dic'), words.length + '\n' + words.join('\n') + '\n', 'utf8');
}

//spellcheck.js no longer takes sysDirectories: the dictionaries live under paths.app/userData,
//which the main process owns now, so the paths go to the backing behind the bridge instead of
//through the module's own arguments. Each test still gets its own pair of real temp directories -
//they just arrive from the other side of the boundary.
function useSysDirectories(dirs){
  installBridge({ paths: dirs });
  return dirs;
}

function makeSysDirectories(){
  var appDir = tempDir('warewoolf-spellcheck-app-');
  var userDataDir = tempDir('warewoolf-spellcheck-userdata-');
  writeFixtureDictionary(appDir);
  return useSysDirectories({ app: appDir, userData: userDataDir });
}

//Counts calls to one command crossing the bridge - the only way to see from out here whether
//getSpellchecker() actually reused a cached instance list instead of rebuilding it.
function countInvocations(name){
  var original = globalThis.warewoolf.invoke;
  var count = 0;

  globalThis.warewoolf.invoke = function(cmdName, args){
    if(cmdName === name)
      count++;
    return original(cmdName, args);
  };

  return { count: function(){ return count; } };
}

//spellcheck.js reads the editor through getIndexableText() (quill-utils.js), which calls
//getContents() rather than getText() - so a bare object needs only that one method to stand in,
//no real Quill instance like findreplace.test.js uses. getText() is kept too, for any assertion
//in this file that still reads it directly.
function makeEditorQuill(text){
  return {
    getText: function(){ return text; },
    getContents: function(){ return { ops: [ { insert: text } ] }; }
  };
}

test.beforeEach(function(){
  setPlatform(createPlatform(createNodeBacking({ paths: { userData: tempDir('warewoolf-spellcheck-log-') } })));
  //Module-level state - a test that selects dictionaries or project words must not leak them into
  //the next one.
  setSelectedDictionaries([]);
  setProjectWords([]);
});

test.after(uninstallBridge);

test('runSpellcheck finds the first misspelled word and its position', async function(){
  var sysDirectories = makeSysDirectories();
  var editorQuill = makeEditorQuill('the cat sat on the zxqzxq mat\n');

  var result = await runSpellcheck(editorQuill);

  assert.strictEqual(result.word, 'zxqzxq');
  assert.strictEqual(editorQuill.getText().slice(result.index, result.index + result.word.length), 'zxqzxq');
});

test('runSpellcheck returns null when every word is valid', async function(){
  var sysDirectories = makeSysDirectories();
  var editorQuill = makeEditorQuill('the cat sat on the mat\n');

  assert.strictEqual(await runSpellcheck(editorQuill), null);
});

test('runSpellcheck starts searching from startingIndex', async function(){
  var sysDirectories = makeSysDirectories();
  var editorQuill = makeEditorQuill('zxqzxq the cat sat\n');

  //Skip past the leading misspelling entirely.
  var result = await runSpellcheck(editorQuill, 7);

  assert.strictEqual(result, null);
});

test('runSpellcheck skips words on the ignore list', async function(){
  var sysDirectories = makeSysDirectories();
  var editorQuill = makeEditorQuill('the zxqzxq cat sat\n');

  var result = await runSpellcheck(editorQuill, 0, ['zxqzxq']);

  assert.strictEqual(result, null);
});

test('runSpellcheck treats a digit sequence as a number, not a misspelling', async function(){
  var sysDirectories = makeSysDirectories();
  var editorQuill = makeEditorQuill("the cat sat on the 1990s\n");

  assert.strictEqual(await runSpellcheck(editorQuill), null);
});

//Regression: wordRegx used to be /(\w'*)+/, which swallows any apostrophe immediately following a
//word - not just apostrophes internal to it. That flagged ordinary plural possessives like
//"boys'" as misspelled, since "boys'" (with the trailing apostrophe) isn't a dictionary word.
test('runSpellcheck does not flag a trailing possessive apostrophe as part of the word', async function(){
  var sysDirectories = makeSysDirectories();
  var editorQuill = makeEditorQuill("the boys' shoes are here\n");

  assert.strictEqual(await runSpellcheck(editorQuill), null);
});

test('runSpellcheck still keeps an internal apostrophe as part of the word', async function(){
  var sysDirectories = makeSysDirectories();
  var editorQuillValid = makeEditorQuill("she said don't stop\n");
  assert.strictEqual(await runSpellcheck(editorQuillValid), null);

  //Same contraction missing its apostrophe is a different, genuinely misspelled token.
  var editorQuillInvalid = makeEditorQuill("she said dont stop\n");
  var result = await runSpellcheck(editorQuillInvalid);
  assert.strictEqual(result.word, 'dont');
});

//Regression: a failure inside loadDictionaries (missing/unreadable dictionary files) was logged
//but the function fell through and returned undefined. runSpellcheck passed that straight into
//findInvalidWord, which called .correct() on undefined and crashed instead of failing gracefully.
test('runSpellcheck does not throw when the dictionary files are missing', async function(){
  var sysDirectories = useSysDirectories({ app: tempDir('warewoolf-spellcheck-missing-'), userData: tempDir('warewoolf-spellcheck-userdata-') });
  var editorQuill = makeEditorQuill('the cat sat\n');

  var result;
  await assert.doesNotReject(async function(){
    result = await runSpellcheck(editorQuill);
  });
  assert.strictEqual(result, null);
});

//Regression: personal.dic is seeded as "WareWoolf\n". Splitting that on "\n" leaves a trailing
//empty entry, and appending a new word re-joined that empty entry back into the middle of the
//file instead of dropping it, leaving a stray blank line.
test('addWordToPersonalDictFile does not leave a blank line in personal.dic', async function(){
  var userDataDir = tempDir('warewoolf-spellcheck-userdata-');
  var dictDir = path.join(userDataDir, 'dictionaries');
  fs.mkdirSync(dictDir, { recursive: true });
  var personalPath = path.join(dictDir, 'personal.dic');
  fs.writeFileSync(personalPath, 'WareWoolf\n', 'utf8');

  useSysDirectories({ userData: userDataDir });
  await addWordToPersonalDictFile('Nebula');

  var contents = fs.readFileSync(personalPath, 'utf8');
  assert.ok(!contents.includes('\n\n'), 'expected no blank line in: ' + JSON.stringify(contents));
  assert.deepStrictEqual(contents.split('\n').filter(function(w){ return w.trim() !== ''; }), ['WareWoolf', 'Nebula']);
});

test('addWordToPersonalDictFile does not add the same word twice', async function(){
  var userDataDir = tempDir('warewoolf-spellcheck-userdata-');
  var dictDir = path.join(userDataDir, 'dictionaries');
  fs.mkdirSync(dictDir, { recursive: true });
  var personalPath = path.join(dictDir, 'personal.dic');
  fs.writeFileSync(personalPath, 'WareWoolf\n', 'utf8');

  await addWordToPersonalDictFile('Nebula');
  var afterFirstAdd = fs.readFileSync(personalPath, 'utf8');

  await addWordToPersonalDictFile('Nebula');
  var afterSecondAdd = fs.readFileSync(personalPath, 'utf8');

  assert.strictEqual(afterSecondAdd, afterFirstAdd);
});

test('a word added to the personal dictionary is accepted on the next spellcheck', async function(){
  var sysDirectories = makeSysDirectories();
  var editorQuill = makeEditorQuill('the cat sat on the nebulon mat\n');

  var before = await runSpellcheck(editorQuill);
  assert.strictEqual(before.word, 'nebulon');

  await addWordToPersonalDictFile('nebulon');

  assert.strictEqual(await runSpellcheck(editorQuill), null);
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

//---------------------------------------------------------------------------
// curly apostrophes
//---------------------------------------------------------------------------

//Regression: the word pattern only knew the straight apostrophe, so once the editors started
//turning one into '’' as it was typed (see models/autocorrect.js) every contraction in the
//manuscript tokenized as two words - "don" and "t" - and the writer was stopped on both.
test('a contraction written with a curly apostrophe is not flagged', async function(){
  makeSysDirectories();
  var editorQuill = makeEditorQuill('she said don’t stop\n');

  var result = await runSpellcheck(editorQuill);

  assert.strictEqual(result, null);
});

test('a misspelling with a curly apostrophe is reported as it is written in the manuscript', async function(){
  makeSysDirectories();
  var editorQuill = makeEditorQuill('she said zxqzxq’t here\n');

  var result = await runSpellcheck(editorQuill);

  //The word carries the curly apostrophe, because the popup selects and replaces it by this
  //string - it has to match the text on the page character for character.
  assert.strictEqual(result.word, 'zxqzxq’t');
  assert.strictEqual(result.index, 9);
});

//A suggestion arrives from the dictionary with a straight apostrophe, and accepting it would undo
//the smart quote the writer just got.
test('suggestions come back with the same apostrophe the misspelled word used', async function(){
  makeSysDirectories();
  var editorQuill = makeEditorQuill('she said don’tt here\n');

  var result = await runSpellcheck(editorQuill);

  assert.ok(result.suggestions.includes('don’t'),
    'expected a curly-apostrophe suggestion in: ' + JSON.stringify(result.suggestions));
  assert.ok(!result.suggestions.includes("don't"));
});

test('a word added to the personal dictionary is stored the way the dictionary spells it', async function(){
  var userDataDir = tempDir('warewoolf-spellcheck-userdata-');
  var dictDir = path.join(userDataDir, 'dictionaries');
  fs.mkdirSync(dictDir, { recursive: true });
  var personalPath = path.join(dictDir, 'personal.dic');
  fs.writeFileSync(personalPath, 'WareWoolf\n', 'utf8');

  useSysDirectories({ userData: userDataDir });
  await addWordToPersonalDictFile('Ozy’mandias');

  //Stored straight, so the flattened lookup every later spellcheck does actually finds it.
  var contents = fs.readFileSync(personalPath, 'utf8');
  assert.ok(contents.includes("Ozy'mandias"), 'expected a straight apostrophe in: ' + JSON.stringify(contents));
});

test('a word added with a curly apostrophe is not flagged the next time round', async function(){
  var dirs = makeSysDirectories();
  await addWordToPersonalDictFile('Ozy’mandias');

  useSysDirectories(dirs);
  var result = await runSpellcheck(makeEditorQuill('she said Ozy’mandias here\n'));

  assert.strictEqual(result, null);
});

test('getBeginningOfCurrentWord treats an em dash as a word border', function(){
  assert.strictEqual(getBeginningOfCurrentWord('wait—stop', 9), 5);
});

test('getBeginningOfCurrentWord does not treat a curly apostrophe as a word border', function(){
  assert.strictEqual(getBeginningOfCurrentWord('don’t stop', 5), 0);
});

//---------------------------------------------------------------------------
// multiple simultaneous dictionaries
//---------------------------------------------------------------------------

test('a word in the second selected dictionary is accepted', async function(){
  var appDir = tempDir('warewoolf-spellcheck-app-');
  writeDictFixture(appDir, 'en_US-large', DICT_WORDS);
  writeDictFixture(appDir, 'fr_FR', ['bonjour', 'chat']);
  useSysDirectories({ app: appDir, userData: tempDir('warewoolf-spellcheck-userdata-') });
  setSelectedDictionaries(['en_US-large', 'fr_FR']);

  var editorQuill = makeEditorQuill('the cat sat bonjour\n');

  assert.strictEqual(await runSpellcheck(editorQuill), null);
});

test('a word in neither selected dictionary is not accepted', async function(){
  var appDir = tempDir('warewoolf-spellcheck-app-');
  writeDictFixture(appDir, 'en_US-large', DICT_WORDS);
  writeDictFixture(appDir, 'fr_FR', ['bonjour', 'chat']);
  useSysDirectories({ app: appDir, userData: tempDir('warewoolf-spellcheck-userdata-') });
  setSelectedDictionaries(['en_US-large', 'fr_FR']);

  var editorQuill = makeEditorQuill('the cat sat zxqzxq\n');
  var result = await runSpellcheck(editorQuill);

  assert.strictEqual(result.word, 'zxqzxq');
});

test('suggestions from two dictionaries are interleaved and deduped', async function(){
  var appDir = tempDir('warewoolf-spellcheck-app-');
  //Both dictionaries carry a word one edit away from "cta", so each contributes a suggestion.
  writeDictFixture(appDir, 'first', ['cat']);
  writeDictFixture(appDir, 'second', ['cot']);
  useSysDirectories({ app: appDir, userData: tempDir('warewoolf-spellcheck-userdata-') });
  setSelectedDictionaries(['first', 'second']);

  var editorQuill = makeEditorQuill('cta\n');
  var result = await runSpellcheck(editorQuill);

  assert.strictEqual(result.word, 'cta');
  assert.ok(result.suggestions.includes('cat'), JSON.stringify(result.suggestions));
  assert.ok(result.suggestions.includes('cot'), JSON.stringify(result.suggestions));
  assert.strictEqual(new Set(result.suggestions).size, result.suggestions.length);
});

test('project words are accepted and personal words still are', async function(){
  var appDir = tempDir('warewoolf-spellcheck-app-');
  var userDataDir = tempDir('warewoolf-spellcheck-userdata-');
  writeFixtureDictionary(appDir);
  var dictDir = path.join(userDataDir, 'dictionaries');
  fs.mkdirSync(dictDir, { recursive: true });
  fs.writeFileSync(path.join(dictDir, 'personal.dic'), 'WareWoolf\nnebulon\n', 'utf8');

  useSysDirectories({ app: appDir, userData: userDataDir });
  setProjectWords(['Aurelion']);

  var editorQuill = makeEditorQuill('the cat sat nebulon Aurelion mat\n');

  assert.strictEqual(await runSpellcheck(editorQuill), null);
});

test('the instance list is built once across a multi-word pass and rebuilt after releaseSpellchecker()', async function(){
  makeSysDirectories();
  var calls = countInvocations('loadDictionaries');

  var editorQuill = makeEditorQuill('the cat sat on the mat\n');
  await runSpellcheck(editorQuill);
  await runSpellcheck(editorQuill, 4);
  assert.strictEqual(calls.count(), 1);

  releaseSpellchecker();
  await runSpellcheck(editorQuill);
  assert.strictEqual(calls.count(), 2);
});

test('nspell#add via addWordToPersonalDictFile takes effect without a rebuild', async function(){
  makeSysDirectories();
  var editorQuill = makeEditorQuill('the cat sat on the nebulon mat\n');

  //Prime the cache.
  var before = await runSpellcheck(editorQuill);
  assert.strictEqual(before.word, 'nebulon');

  var calls = countInvocations('loadDictionaries');
  await addWordToPersonalDictFile('nebulon');
  var after = await runSpellcheck(editorQuill);

  assert.strictEqual(after, null);
  assert.strictEqual(calls.count(), 0, 'expected no dictionary reparse');
});

test('an unknown id is skipped and an all-unknown selection falls back to the shared default', async function(){
  makeSysDirectories();
  setSelectedDictionaries(['nonexistent']);

  var editorQuill = makeEditorQuill('the cat sat on the mat\n');

  assert.strictEqual(await runSpellcheck(editorQuill), null);
});
