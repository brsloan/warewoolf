const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { assertDialogDescribed, assertControlsNamed } = require('./helpers');

const outlinerDisplayPath = require.resolve('../src/components/views/outliner_display');

//closePopups() also calls disableSearchView()/focusEditor(), which reach for this fixed shell by
//id - same shell used in corkboard_display.test.js / missing-pups_display.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

function makeChap(overrides){
  return Object.assign({
    title: 'Chapter One',
    summary: null,
    getContentsOrFile: function(){ return { ops: [{ insert: 'one two three' }] }; }
  }, overrides);
}

function makeProject(overrides){
  return Object.assign({
    chapters: [makeChap()]
  }, overrides);
}

function makeSettings(overrides){
  return Object.assign({ wordsPerPage: 300 }, overrides);
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[outlinerDisplayPath];
  delete global.window;
  delete global.document;
});

test('renders a row per chapter with title, word count, page estimate, and summary', async function(t){
  var showOutliner = require(outlinerDisplayPath);
  var chap = makeChap({ title: 'Intro', summary: 'An intro' });
  var project = makeProject({ chapters: [chap] });

  await showOutliner(project, makeSettings());

  assert.strictEqual(document.querySelector('.outliner-title').innerText, 'Intro');
  assert.strictEqual(document.querySelector('.outliner-word-count').innerText, 3);
  assert.strictEqual(document.querySelector('.outliner-page-count').innerText, '~0.0');
  assert.strictEqual(document.querySelector('.outliner-summary input').value, 'An intro');
});

//The same words-per-page value the Word Count dialog sets, but carried to a tenth of a page - the
//column is there to be compared down its length, and whole pages would round neighbouring chapters
//together and overshoot the project's own page estimate once every row had been rounded up.
test('the page estimate uses the words-per-page setting and keeps a part-filled page as a fraction', async function(t){
  var showOutliner = require(outlinerDisplayPath);
  var chap = makeChap({ getContentsOrFile: function(){ return { ops: [{ insert: 'one two three four five' }] }; } });

  await showOutliner(makeProject({ chapters: [chap] }), makeSettings({ wordsPerPage: 2 }));

  assert.strictEqual(document.querySelector('.outliner-word-count').innerText, 5);
  assert.strictEqual(document.querySelector('.outliner-page-count').innerText, '~2.5');
});

//A tenth is as fine as the column goes, so a chapter far shorter than that reads as ~0.0 rather
//than being rounded up to a page it does not fill.
test('a chapter shorter than a tenth of a page reads as ~0.0', async function(t){
  var showOutliner = require(outlinerDisplayPath);

  await showOutliner(makeProject(), makeSettings({ wordsPerPage: 300 }));

  assert.strictEqual(document.querySelector('.outliner-page-count').innerText, '~0.0');
});

//0 words per page would make every chapter infinitely long, so there is no estimate to give -
//the same case the Word Count dialog answers by falling back to the bare count.
test('a words-per-page setting of 0 leaves the page cell empty instead of showing Infinity', async function(t){
  var showOutliner = require(outlinerDisplayPath);

  await showOutliner(makeProject(), makeSettings({ wordsPerPage: 0 }));

  assert.strictEqual(document.querySelector('.outliner-page-count').innerText, '');
});

//Regression: chapter.js initializes new chapters with summary: null, and every existing .woolf
//project on disk has summary: null for chapters that haven't been given one yet. Assigning
//input.value = null coerces to the string "null" in the DOM, so the field displayed the literal
//word "null" instead of being blank.
test('a chapter with no summary yet shows a blank field instead of the literal word "null"', async function(t){
  var showOutliner = require(outlinerDisplayPath);
  var project = makeProject({ chapters: [makeChap({ summary: null })] });

  await showOutliner(project);

  assert.strictEqual(document.querySelector('.outliner-summary input').value, '');
});

test('editing the summary field updates the chapter and marks the project as having unsaved changes', async function(t){
  var showOutliner = require(outlinerDisplayPath);
  var chap = makeChap({ summary: null });
  var project = makeProject({ chapters: [chap], hasUnsavedChanges: false });

  await showOutliner(project);
  var summaryInput = document.querySelector('.outliner-summary input');
  summaryInput.value = 'A new summary';
  summaryInput.dispatchEvent(new window.Event('change', { bubbles: true, cancelable: true }));

  assert.strictEqual(chap.summary, 'A new summary');
  assert.strictEqual(project.hasUnsavedChanges, true);
});

test('Close removes the popup', async function(t){
  var showOutliner = require(outlinerDisplayPath);
  var project = makeProject();

  await showOutliner(project);
  var closeBtn = Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent === 'Close'; });
  closeBtn.onclick();

  assert.strictEqual(document.getElementsByClassName('popup').length, 0);
});

test('focuses the first summary field on open', async function(t){
  var showOutliner = require(outlinerDisplayPath);
  var project = makeProject({ chapters: [makeChap(), makeChap()] });

  await showOutliner(project);

  var summaryInputs = document.querySelectorAll('.outliner-summary input');
  assert.strictEqual(document.activeElement, summaryInputs[0]);
});

//Regression: with zero chapters the table has no <input>, so the old unconditional
//document.querySelector('#outliner-table input').focus() threw on a null querySelector result,
//breaking the outliner entirely for a project with all chapters moved to reference/trash.
test('does not throw when the project has no chapters', function(t){
  var showOutliner = require(outlinerDisplayPath);
  var project = makeProject({ chapters: [] });

  assert.doesNotThrow(async function(){
    await showOutliner(project);
  });
  assert.strictEqual(document.querySelectorAll('#outliner-table tr').length, 1, 'only the header row should be present');
});

//The outliner has no heading of its own, so it is named outright, and each summary box - a bare
//field in a table cell - says which chapter it belongs to.
test('the outliner is a named dialog and each summary field says which chapter it is for', async function(){
  var showOutliner = require(outlinerDisplayPath);
  await showOutliner(makeProject({ chapters: [makeChap({ title: 'Intro' })] }));

  var popup = document.querySelector('.popup');
  assertDialogDescribed(popup, 'dialog');
  assert.strictEqual(popup.querySelector('.outliner-summary input').getAttribute('aria-label'), 'Summary of Intro');
  assertControlsNamed(popup);
});
