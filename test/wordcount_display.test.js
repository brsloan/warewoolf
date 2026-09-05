const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

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

test('renders chapter, project, and session totals from the editor and project chapters', function(){
  var showWordCount = require(wordcountDisplayPath);
  var project = makeProject({ wordCountOnLoad: 3, chapters: [makeChapter('one two three four')] });
  var editorQuill = makeEditorQuill('one two');

  showWordCount(project, editorQuill);

  assert.strictEqual(document.getElementById('word-goal-input').value, '0');
  var paragraphs = document.querySelectorAll('table p');
  assert.strictEqual(paragraphs[0].innerText, 2); //chapter (from editorQuill)
  assert.strictEqual(paragraphs[1].innerText, 4); //project (from project.chapters)
  assert.strictEqual(paragraphs[2].innerText, 1); //session (4 - wordCountOnLoad of 3)
});

//Regression: the goal field wrote project.wordGoal back as the raw string input.value instead of a
//Number, even though the project model initializes wordGoal as a Number (project.js). This let a
//string value get persisted to the .woolf file on save (already visible as "wordGoal": "0" in
//src/examples/HelpDoc/HelpDoc.woolf).
test('editing the goal field coerces project.wordGoal to a Number', function(){
  var showWordCount = require(wordcountDisplayPath);
  var project = makeProject();
  var editorQuill = makeEditorQuill('');

  showWordCount(project, editorQuill);

  var goalInput = document.getElementById('word-goal-input');
  goalInput.value = '500';
  goalInput.oninput();

  assert.strictEqual(project.wordGoal, 500);
  assert.strictEqual(typeof project.wordGoal, 'number');
});

//Regression: clearing the goal field used to set project.wordGoal to the empty string; guard against
//a NaN/empty result ever being written back (NaN serializes as null via JSON.stringify, silently
//corrupting the saved project file).
test('clearing the goal field falls back to a Number 0 instead of NaN', function(){
  var showWordCount = require(wordcountDisplayPath);
  var project = makeProject({ wordGoal: 500 });
  var editorQuill = makeEditorQuill('');

  showWordCount(project, editorQuill);

  var goalInput = document.getElementById('word-goal-input');
  goalInput.value = '';
  goalInput.oninput();

  assert.strictEqual(project.wordGoal, 0);
  assert.ok(Number.isFinite(project.wordGoal));
});

//Regression: the handler was wired to onkeyup, which never fires for the number input's spinner
//arrows or a context-menu paste - only oninput covers every way the value can change.
test('the goal field is wired to oninput rather than onkeyup', function(){
  var showWordCount = require(wordcountDisplayPath);
  var project = makeProject();
  showWordCount(project, makeEditorQuill(''));

  var goalInput = document.getElementById('word-goal-input');
  assert.strictEqual(typeof goalInput.oninput, 'function');
  assert.strictEqual(goalInput.onkeyup, null);
});

test('the goal field rejects negative values via the min attribute', function(){
  var showWordCount = require(wordcountDisplayPath);
  showWordCount(makeProject(), makeEditorQuill(''));

  assert.strictEqual(document.getElementById('word-goal-input').min, '0');
});

test('updating the goal recalculates the progress bar width and color', function(){
  var showWordCount = require(wordcountDisplayPath);
  var project = makeProject({ chapters: [makeChapter('one two three four five')] }); //total = 5
  showWordCount(project, makeEditorQuill(''));

  var goalInput = document.getElementById('word-goal-input');
  var progressBarFill = document.getElementById('prog-bar-fill');

  goalInput.value = '10';
  goalInput.oninput();
  assert.strictEqual(progressBarFill.style.width, '50%');

  goalInput.value = '2';
  goalInput.oninput();
  assert.strictEqual(progressBarFill.style.width, '100%'); //capped even though 5/2 > 100%
});

test('Close removes the popup', function(){
  var showWordCount = require(wordcountDisplayPath);
  showWordCount(makeProject(), makeEditorQuill(''));

  assert.strictEqual(document.getElementsByClassName('popup').length, 1);
  findButton('Close').onclick();
  assert.strictEqual(document.getElementsByClassName('popup').length, 0);
});
