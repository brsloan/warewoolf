const test = require('node:test');
const assert = require('node:assert');

const { getTotalWordCount, countWords } = require('../src/components/controllers/wordcount');

function chapterWithContents(delt){
  return { getContentsOrFile: function(){ return delt; } };
}

function delta(inserts){
  return { ops: inserts.map(function(insert){ return { insert: insert }; }) };
}

//---------------------------------------------------------------------------
// countWords
//---------------------------------------------------------------------------

test('countWords counts space-separated words', function(){
  assert.strictEqual(countWords('one two three'), 3);
});

test('countWords returns 0 for an empty string', function(){
  assert.strictEqual(countWords(''), 0);
});

test('countWords ignores repeated spaces', function(){
  assert.strictEqual(countWords('one   two'), 2);
});

test('countWords treats newlines and carriage returns as word separators', function(){
  assert.strictEqual(countWords('one\ntwo\r\nthree'), 3);
});

test('countWords treats em dashes and double hyphens as word separators', function(){
  assert.strictEqual(countWords('one—two'), 2);
  assert.strictEqual(countWords('one--two'), 2);
});

test('countWords treats a single hyphen as part of a word', function(){
  assert.strictEqual(countWords('well-known'), 1);
});

//---------------------------------------------------------------------------
// getTotalWordCount
//---------------------------------------------------------------------------

test('getTotalWordCount sums word counts across every chapter', function(){
  const project = { chapters: [
    chapterWithContents(delta(['one two ', 'three'])),
    chapterWithContents(delta(['four five six']))
  ] };

  assert.strictEqual(getTotalWordCount(project), 6);
});

test('getTotalWordCount returns 0 for a project with no chapters', function(){
  assert.strictEqual(getTotalWordCount({ chapters: [] }), 0);
});

test('getTotalWordCount regression: does not throw when a chapter has no readable contents', function(){
  //getContentsOrFile()/getFile() return undefined when a chapter's file is missing or fails to
  //parse; convertToPlainText used to assume it always got back a Delta and crashed on `.ops`.
  const project = { chapters: [
    chapterWithContents(undefined),
    chapterWithContents(delta(['two words']))
  ] };

  assert.doesNotThrow(function(){ getTotalWordCount(project); });
  assert.strictEqual(getTotalWordCount(project), 2);
});

test('getTotalWordCount regression: does not throw when a chapter delta has no ops', function(){
  const project = { chapters: [ chapterWithContents({}) ] };

  assert.doesNotThrow(function(){ getTotalWordCount(project); });
  assert.strictEqual(getTotalWordCount(project), 0);
});

test('getTotalWordCount regression: ignores non-string insert values instead of stringifying them', function(){
  //Embeds (e.g. images) store a non-string `insert`; it must not turn into text like
  //"[object Object]" and inflate the count.
  const project = { chapters: [
    chapterWithContents(delta(['one ', { image: 'data:...' }, ' two']))
  ] };

  assert.strictEqual(getTotalWordCount(project), 2);
});
