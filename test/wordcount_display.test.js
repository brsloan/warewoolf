const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { assertDialogDescribed, assertControlsNamed } = require('./helpers');

const wordcountDisplayPath = require.resolve('../src/components/views/wordcount_display');

//closePopups() (called on Close) reaches for this fixed set of app-shell elements by id - same
//shell used in settings_display.test.js/findreplace_display.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

function makeChapter(text){
  return { getContentsOrFile: function(){ return { ops: [{ insert: text }] }; } };
}

function makeProject(overrides){
  return Object.assign({
    wordGoal: 0,
    wordCountOnLoad: 0,
    chapters: []
  }, overrides);
}

function makeEditorQuill(text){
  return { getText: function(){ return text; } };
}

function makeUserSettings(overrides){
  return Object.assign({
    wordsPerPage: 300,
    saveCount: 0,
    save: function(){ this.saveCount++; }
  }, overrides);
}

function findButton(text){
  return Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent === text; });
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[wordcountDisplayPath];
  delete global.window;
  delete global.document;
});

test('renders chapter, project, and session totals from the editor and project chapters', async function(){
  var showWordCount = require(wordcountDisplayPath);
  var project = makeProject({ wordCountOnLoad: 3, chapters: [makeChapter('one two three four')] });
  var editorQuill = makeEditorQuill('one two');

  await showWordCount(project, editorQuill, makeUserSettings());

  assert.strictEqual(document.getElementById('word-goal-input').value, '0');
  var paragraphs = document.querySelectorAll('table p');
  assert.strictEqual(paragraphs[0].innerText, '2 wds / ~1 pgs'); //chapter (from editorQuill)
  assert.strictEqual(paragraphs[1].innerText, '4 wds / ~1 pgs'); //project (from project.chapters)
  assert.strictEqual(paragraphs[2].innerText, '1 wds / ~1 pgs'); //session (4 - wordCountOnLoad of 3)
});

//Regression: the goal field wrote project.wordGoal back as the raw string input.value instead of a
//Number, even though the project model initializes wordGoal as a Number (project.js). This let a
//string value get persisted to the .woolf file on save (already visible as "wordGoal": "0" in
//src/examples/HelpDoc/HelpDoc.woolf).
test('editing the goal field coerces project.wordGoal to a Number', async function(){
  var showWordCount = require(wordcountDisplayPath);
  var project = makeProject();
  var editorQuill = makeEditorQuill('');

  await showWordCount(project, editorQuill, makeUserSettings());

  var goalInput = document.getElementById('word-goal-input');
  goalInput.value = '500';
  goalInput.oninput();

  assert.strictEqual(project.wordGoal, 500);
  assert.strictEqual(typeof project.wordGoal, 'number');
});

//Regression: clearing the goal field used to set project.wordGoal to the empty string; guard against
//a NaN/empty result ever being written back (NaN serializes as null via JSON.stringify, silently
//corrupting the saved project file).
test('clearing the goal field falls back to a Number 0 instead of NaN', async function(){
  var showWordCount = require(wordcountDisplayPath);
  var project = makeProject({ wordGoal: 500 });
  var editorQuill = makeEditorQuill('');

  await showWordCount(project, editorQuill, makeUserSettings());

  var goalInput = document.getElementById('word-goal-input');
  goalInput.value = '';
  goalInput.oninput();

  assert.strictEqual(project.wordGoal, 0);
  assert.ok(Number.isFinite(project.wordGoal));
});

//Regression: the handler was wired to onkeyup, which never fires for the number input's spinner
//arrows or a context-menu paste - only oninput covers every way the value can change.
test('the goal field is wired to oninput rather than onkeyup', async function(){
  var showWordCount = require(wordcountDisplayPath);
  var project = makeProject();
  await showWordCount(project, makeEditorQuill(''), makeUserSettings());

  var goalInput = document.getElementById('word-goal-input');
  assert.strictEqual(typeof goalInput.oninput, 'function');
  assert.strictEqual(goalInput.onkeyup, null);
});

test('the goal field rejects negative values via the min attribute', async function(){
  var showWordCount = require(wordcountDisplayPath);
  await showWordCount(makeProject(), makeEditorQuill(''), makeUserSettings());

  assert.strictEqual(document.getElementById('word-goal-input').min, '0');
});

test('updating the goal recalculates the progress bar width and color', async function(){
  var showWordCount = require(wordcountDisplayPath);
  var project = makeProject({ chapters: [makeChapter('one two three four five')] }); //total = 5
  await showWordCount(project, makeEditorQuill(''), makeUserSettings());

  var goalInput = document.getElementById('word-goal-input');
  var progressBarFill = document.getElementById('prog-bar-fill');

  goalInput.value = '10';
  goalInput.oninput();
  assert.strictEqual(progressBarFill.style.width, '50%');

  goalInput.value = '2';
  goalInput.oninput();
  assert.strictEqual(progressBarFill.style.width, '100%'); //capped even though 5/2 > 100%
});

test('Close removes the popup', async function(){
  var showWordCount = require(wordcountDisplayPath);
  await showWordCount(makeProject(), makeEditorQuill(''), makeUserSettings());

  assert.strictEqual(document.getElementsByClassName('popup').length, 1);
  findButton('Close').onclick();
  assert.strictEqual(document.getElementsByClassName('popup').length, 0);
});

test('page estimates round a part-filled page up, and follow the words-per-page field', async function(){
  var showWordCount = require(wordcountDisplayPath);
  var project = makeProject({ chapters: [makeChapter(new Array(1000).fill('word').join(' '))] });
  var userSettings = makeUserSettings();

  await showWordCount(project, makeEditorQuill(''), userSettings);

  var totalDisplay = document.querySelectorAll('table p')[1];
  assert.strictEqual(totalDisplay.innerText, '1000 wds / ~4 pgs'); //1000/300 = 3.33, rounded up

  var perPageInput = document.getElementById('words-per-page-input');
  perPageInput.value = '200';
  perPageInput.oninput();

  assert.strictEqual(totalDisplay.innerText, '1000 wds / ~5 pgs');
  assert.strictEqual(document.querySelectorAll('table p')[0].innerText, '0 wds / ~0 pgs');
});

test('the words-per-page field starts on the saved setting and writes changes back through save', async function(){
  var showWordCount = require(wordcountDisplayPath);
  var userSettings = makeUserSettings({ wordsPerPage: 250 });

  await showWordCount(makeProject(), makeEditorQuill(''), userSettings);

  var perPageInput = document.getElementById('words-per-page-input');
  assert.strictEqual(perPageInput.value, '250');

  perPageInput.value = '400';
  perPageInput.oninput();

  assert.strictEqual(userSettings.wordsPerPage, 400);
  assert.strictEqual(typeof userSettings.wordsPerPage, 'number');
  assert.strictEqual(userSettings.saveCount, 1);
});

//A cleared field would otherwise divide by zero and report every count as "~Infinity pgs".
test('clearing the words-per-page field drops the estimate rather than dividing by zero', async function(){
  var showWordCount = require(wordcountDisplayPath);
  var project = makeProject({ chapters: [makeChapter('one two three')] });
  var userSettings = makeUserSettings();

  await showWordCount(project, makeEditorQuill(''), userSettings);

  var perPageInput = document.getElementById('words-per-page-input');
  perPageInput.value = '';
  perPageInput.oninput();

  assert.strictEqual(userSettings.wordsPerPage, 0);
  assert.strictEqual(document.querySelectorAll('table p')[1].innerText, '3 wds');
});

//Math.ceil answers -0 for a session that has lost a handful of words, which would print as "-0 pgs".
test('a session count gone slightly negative reports 0 pages, not -0', async function(){
  var showWordCount = require(wordcountDisplayPath);
  var project = makeProject({ wordCountOnLoad: 5, chapters: [makeChapter('one two')] });

  await showWordCount(project, makeEditorQuill(''), makeUserSettings());

  assert.strictEqual(document.querySelectorAll('table p')[2].innerText, '-3 wds / ~0 pgs');
});

test('the words-per-page field rejects a zero or negative value via the min attribute', async function(){
  var showWordCount = require(wordcountDisplayPath);
  await showWordCount(makeProject(), makeEditorQuill(''), makeUserSettings());

  assert.strictEqual(document.getElementById('words-per-page-input').min, '1');
});

test('the word count popup is a dialog and its fields are labelled', async function(){
  var showWordCount = require(wordcountDisplayPath);
  await showWordCount(makeProject(), makeEditorQuill('one two'), makeUserSettings());

  var popup = document.querySelector('.popup');
  assertDialogDescribed(popup, 'dialog');
  assert.ok(assertControlsNamed(popup) >= 2, 'the goal and words-per-page fields should be there to check');
});
