const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const workingDisplayPath = require.resolve('../src/components/views/working_display');

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[workingDisplayPath];
  delete global.window;
  delete global.document;
});

test('showWorking creates a single popup with the given status', function(){
  var { showWorking } = require(workingDisplayPath);

  showWorking('Importing file...');

  assert.strictEqual(document.getElementsByClassName('working-popup').length, 1);
  assert.strictEqual(document.getElementById('working-status').innerText, 'Importing file...');
});

test('showWorking called again updates the existing popup instead of creating another', function(){
  var { showWorking } = require(workingDisplayPath);

  showWorking('Importing file...');
  showWorking('Chapters Generated So Far: 1');

  assert.strictEqual(document.getElementsByClassName('working-popup').length, 1);
  assert.strictEqual(document.getElementById('working-status').innerText, 'Chapters Generated So Far: 1');
});

test('showWorkingAndThen invokes the callback once the hardhat image loads', function(){
  var { showWorkingAndThen } = require(workingDisplayPath);
  var called = false;

  showWorkingAndThen('Exporting...', function(){ called = true; });

  assert.strictEqual(document.getElementsByClassName('working-popup').length, 1);
  assert.strictEqual(called, false);

  document.querySelector('.working-img').dispatchEvent(new window.Event('load'));
  assert.strictEqual(called, true);
});

//Regression: the hardhat image had no onerror handler, so a failed/missing image load meant
//callback() - where the actual export/send/convert work happens - never ran, silently hanging
//the app behind a working popup that never resolved.
test('showWorkingAndThen invokes the callback if the hardhat image fails to load', function(){
  var { showWorkingAndThen } = require(workingDisplayPath);
  var called = false;

  showWorkingAndThen('Exporting...', function(){ called = true; });

  document.querySelector('.working-img').dispatchEvent(new window.Event('error'));
  assert.strictEqual(called, true);
});

//Regression: showWorkingAndThen unconditionally created a new .working-popup with no check for
//one already existing, unlike showWorking. Calling it twice before hideWorking() (e.g. a fast
//double-click) stacked duplicate popups and duplicate #working-status ids.
test('showWorkingAndThen reuses an existing popup instead of stacking a duplicate', function(){
  var { showWorkingAndThen } = require(workingDisplayPath);
  var firstCalled = false;
  var secondCalled = false;

  showWorkingAndThen('Exporting...', function(){ firstCalled = true; });
  showWorkingAndThen('Exporting again...', function(){ secondCalled = true; });

  assert.strictEqual(document.getElementsByClassName('working-popup').length, 1);
  assert.strictEqual(document.getElementById('working-status').innerText, 'Exporting again...');
  //The second call's popup already exists (and its image already settled), so its callback
  //runs immediately rather than waiting on a load/error event that will never come again.
  assert.strictEqual(secondCalled, true);
  assert.strictEqual(firstCalled, false);
});

test('hideWorking removes the popup', function(){
  var { showWorking, hideWorking } = require(workingDisplayPath);

  showWorking('Working...');
  hideWorking();

  assert.strictEqual(document.getElementsByClassName('working-popup').length, 0);
});
