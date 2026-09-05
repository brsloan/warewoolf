const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const requestProjectTitle = require('../src/components/views/new-project_display');

//closePopups() (run on both submit and Cancel) also calls disableSearchView()/focusEditor(),
//which reach for this fixed set of app-shell elements by id - same shell used in
//exit-confirmation_display.test.js / missing-pups_display.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

function getButton(text){
  return Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent === text; });
}

function submitForm(){
  document.querySelector('form').onsubmit({ preventDefault: function(){} });
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete global.window;
  delete global.document;
});

test('submitting a title calls back with it and closes the popup', function(){
  var titles = [];
  requestProjectTitle(function(title){ titles.push(title); });

  document.getElementById('title-input').value = 'Mrs. Dalloway 2';
  submitForm();

  assert.deepStrictEqual(titles, ['Mrs. Dalloway 2']);
  assert.strictEqual(document.querySelector('.popup'), null);
});

test('submitting a blank title falls back to "New Project"', function(){
  var titles = [];
  requestProjectTitle(function(title){ titles.push(title); });

  submitForm();

  assert.deepStrictEqual(titles, ['New Project']);
});

//Regression: the emptiness check only compared against "", so a title of pure whitespace was
//accepted verbatim instead of falling back like a genuinely empty field does.
test('submitting a whitespace-only title falls back to "New Project"', function(){
  var titles = [];
  requestProjectTitle(function(title){ titles.push(title); });

  document.getElementById('title-input').value = '   ';
  submitForm();

  assert.deepStrictEqual(titles, ['New Project']);
});

//Regression: leading/trailing whitespace around a real title used to be kept verbatim.
test('submitting a title with surrounding whitespace trims it', function(){
  var titles = [];
  requestProjectTitle(function(title){ titles.push(title); });

  document.getElementById('title-input').value = '  Frankenstein  ';
  submitForm();

  assert.deepStrictEqual(titles, ['Frankenstein']);
});

test('Cancel closes the popup without calling back', function(){
  var titles = [];
  requestProjectTitle(function(title){ titles.push(title); });

  getButton('Cancel').onclick();

  assert.deepStrictEqual(titles, []);
  assert.strictEqual(document.querySelector('.popup'), null);
});

//Regression: the dialog never cleared out a pre-existing popup, so triggering it twice (e.g. the
//startup auto-prompt racing the File > New Project menu action) stacked two forms, each with a
//duplicate id="title-input" element.
test('requesting a title replaces any existing popup and focuses the input', function(){
  var stalePopup = document.createElement('div');
  stalePopup.classList.add('popup');
  document.body.appendChild(stalePopup);

  requestProjectTitle(function(){});

  var popups = document.querySelectorAll('.popup');
  assert.strictEqual(popups.length, 1, 'the stale popup should be removed');
  assert.strictEqual(document.querySelectorAll('#title-input').length, 1);
  assert.strictEqual(document.activeElement, document.getElementById('title-input'));
});
