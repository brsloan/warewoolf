const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const renumberDisplayPath = require.resolve('../src/components/views/renumber-chapters_display');

//closePopups() also calls disableSearchView()/focusEditor(), which reach for this fixed shell by
//id - same shell used in outliner_display.test.js / missing-pups_display.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

function makeChap(title){
  return { title: title, hasUnsavedChanges: false };
}

function makeProject(chapters){
  return { chapters: chapters, hasUnsavedChanges: false };
}

function clickSubmit(){
  var submitBtn = Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent === 'Submit'; });
  submitBtn.onclick();
}

function clickClose(){
  var closeBtn = Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent === 'Close'; });
  closeBtn.onclick();
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[renumberDisplayPath];
  delete global.window;
  delete global.document;
});

test('renders a start/end option per chapter, defaulting to the first and last chapters', function(t){
  var showRenumberChapters = require(renumberDisplayPath);
  var project = makeProject([makeChap('Alpha'), makeChap('Beta'), makeChap('Gamma')]);

  showRenumberChapters(project, function(){});

  var startOptions = document.querySelectorAll('#start-chap-select option');
  var endOptions = document.querySelectorAll('#end-chap-select option');
  assert.strictEqual(startOptions.length, 3);
  assert.strictEqual(endOptions.length, 3);
  assert.strictEqual(document.getElementById('start-chap-select').value, '0');
  assert.strictEqual(document.getElementById('end-chap-select').value, '2');
});

//Regression: the end-chapter label/select used to also be appendChild'd straight onto the form
//before being moved into the table row, which left dead, misleading DOM-manipulation code (moving
//a node re-parents it, so those calls were silently undone). This pins the form down to only ever
//holding the table plus the error text and the two buttons directly - no stray label/select.
test('the form has no stray direct children besides the table, error text, and buttons', function(t){
  var showRenumberChapters = require(renumberDisplayPath);
  var project = makeProject([makeChap('Alpha'), makeChap('Beta')]);

  showRenumberChapters(project, function(){});

  var form = document.querySelector('form');
  var childTags = Array.from(form.children).map(function(el){ return el.tagName; });
  assert.deepStrictEqual(childTags, ['TABLE', 'P', 'BUTTON', 'BUTTON']);
  assert.strictEqual(document.querySelectorAll('#end-chap-select').length, 1);
  assert.ok(document.getElementById('end-chap-select').closest('table'), 'end-chap-select should live inside the table');
});

test('Submit renumbers the selected range, closes the popup, and calls onFinish', function(t){
  var showRenumberChapters = require(renumberDisplayPath);
  var chapA = makeChap('Old A');
  var chapB = makeChap('Old B');
  var project = makeProject([chapA, chapB]);
  var finished = false;

  showRenumberChapters(project, function(){ finished = true; });
  document.getElementById('renumber-format-input').value = 'Ch. [num]';
  document.getElementById('use-numerals-check').checked = true;

  clickSubmit();

  assert.strictEqual(chapA.title, 'Ch. 1');
  assert.strictEqual(chapB.title, 'Ch. 2');
  assert.strictEqual(document.getElementsByClassName('popup').length, 0);
  assert.strictEqual(finished, true);
});

test('Close does not renumber and just closes the popup', function(t){
  var showRenumberChapters = require(renumberDisplayPath);
  var chap = makeChap('Untouched');
  var project = makeProject([chap]);
  var finished = false;

  showRenumberChapters(project, function(){ finished = true; });
  clickClose();

  assert.strictEqual(chap.title, 'Untouched');
  assert.strictEqual(document.getElementsByClassName('popup').length, 0);
  assert.strictEqual(finished, false);
});

//Regression: with zero chapters, submit used to silently no-op (the renumber loop's start/end
//index came from an empty <select>'s value, i.e. NaN, so the loop condition was never true) with
//no feedback that nothing happened, even though the popup still warned the action is irreversible.
test('Submit shows an error and does not close the popup when there are no chapters', function(t){
  var showRenumberChapters = require(renumberDisplayPath);
  var project = makeProject([]);
  var finished = false;

  showRenumberChapters(project, function(){ finished = true; });
  clickSubmit();

  assert.match(document.querySelector('form p').innerText, /no chapters/i);
  assert.strictEqual(document.getElementsByClassName('popup').length, 1);
  assert.strictEqual(finished, false);
});

test('Submit shows an error and does not renumber when the start chapter is after the end chapter', function(t){
  var showRenumberChapters = require(renumberDisplayPath);
  var chapA = makeChap('Old A');
  var chapB = makeChap('Old B');
  var project = makeProject([chapA, chapB]);
  var finished = false;

  showRenumberChapters(project, function(){ finished = true; });
  document.getElementById('start-chap-select').value = '1';
  document.getElementById('end-chap-select').value = '0';

  clickSubmit();

  assert.match(document.querySelector('form p').innerText, /start chapter must come before/i);
  assert.strictEqual(chapA.title, 'Old A');
  assert.strictEqual(chapB.title, 'Old B');
  assert.strictEqual(document.getElementsByClassName('popup').length, 1);
  assert.strictEqual(finished, false);
});
