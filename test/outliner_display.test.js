const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

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

test('renders a row per chapter with title, word count, and summary', async function(t){
  var showOutliner = require(outlinerDisplayPath);
  var chap = makeChap({ title: 'Intro', summary: 'An intro' });
  var project = makeProject({ chapters: [chap] });

  await showOutliner(project);

  assert.strictEqual(document.querySelector('.outliner-title').innerText, 'Intro');
  assert.strictEqual(document.querySelector('.outliner-word-count').innerText, 3);
  assert.strictEqual(document.querySelector('.outliner-summary input').value, 'An intro');
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
