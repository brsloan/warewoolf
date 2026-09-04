const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const displayExitConfirmation = require('../src/components/views/exit-confirmation_display');

//closePopups() (run by both Save-on-success and Continue Without Saving) also calls
//disableSearchView() and focusEditor(), which reach for this fixed set of app-shell elements by
//id - same shell used in corkboard_display.test.js / convert-tabs-display.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

function getButton(text){
  return Array.from(document.querySelectorAll('button')).find(function(b){ return b.innerHTML === text; });
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

//Regression: the Save button used to call closePopups()/continueFunc() unconditionally right
//after firing saveFunc(), even though saveFunc (saveProject) can resolve asynchronously (a
//never-saved project falls through to the Save As dialog) or fail outright. That let the app
//exit/open a new project before the save actually completed, silently losing the unsaved work.
test('Save only closes the popup and continues once saveFunc reports success', function(){
  var saveCallback = null;
  var saveCalls = 0;
  var saveFunc = function(onComplete){
    saveCalls++;
    saveCallback = onComplete;
  };

  var continueCalls = 0;
  var continueFunc = function(){ continueCalls++; };

  displayExitConfirmation(saveFunc, continueFunc);

  getButton('Save').onclick();

  assert.strictEqual(saveCalls, 1);
  assert.strictEqual(continueCalls, 0, 'continueFunc must not run before the save resolves');
  assert.ok(document.querySelector('.popup'), 'the popup must stay open while the save is in flight');

  saveCallback(true);

  assert.strictEqual(continueCalls, 1, 'continueFunc should run once the save succeeds');
  assert.strictEqual(document.querySelector('.popup'), null, 'the popup should close once the save succeeds');
});

test('Save leaves the popup open and does not continue when saveFunc reports failure', function(){
  var saveCallback = null;
  var saveFunc = function(onComplete){ saveCallback = onComplete; };

  var continueCalls = 0;
  var continueFunc = function(){ continueCalls++; };

  displayExitConfirmation(saveFunc, continueFunc);

  getButton('Save').onclick();
  saveCallback(false);

  assert.strictEqual(continueCalls, 0, 'continueFunc must not run when the save failed or was cancelled');
  assert.ok(document.querySelector('.popup'), 'the popup should stay open so the user can retry or cancel');
});

test('Continue Without Saving closes the popup and continues without saving', function(){
  var saveCalls = 0;
  var saveFunc = function(){ saveCalls++; };

  var continueCalls = 0;
  var continueFunc = function(){ continueCalls++; };

  displayExitConfirmation(saveFunc, continueFunc);

  getButton('Continue Without Saving').onclick();

  assert.strictEqual(saveCalls, 0);
  assert.strictEqual(continueCalls, 1);
  assert.strictEqual(document.querySelector('.popup'), null);
});

test('Cancel closes the popup without saving or continuing', function(){
  var saveCalls = 0;
  var saveFunc = function(){ saveCalls++; };

  var continueCalls = 0;
  var continueFunc = function(){ continueCalls++; };

  displayExitConfirmation(saveFunc, continueFunc);

  getButton('Cancel').onclick();

  assert.strictEqual(saveCalls, 0);
  assert.strictEqual(continueCalls, 0);
  assert.strictEqual(document.querySelector('.popup'), null);
});

test('displaying the confirmation replaces any existing popup and focuses Save', function(){
  var stalePopup = document.createElement('div');
  stalePopup.classList.add('popup');
  document.body.appendChild(stalePopup);

  displayExitConfirmation(function(){}, function(){});

  var popups = document.querySelectorAll('.popup');
  assert.strictEqual(popups.length, 1, 'the stale popup should be removed');
  assert.strictEqual(document.activeElement, getButton('Save'));
});
