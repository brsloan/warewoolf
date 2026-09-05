const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const displayDeleteConfirmation = require('../src/components/views/delete-confirmation_display');

function getButton(text){
  return Array.from(document.querySelectorAll('button')).find(function(b){ return b.innerHTML === text; });
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete global.window;
  delete global.document;
});

test('the confirmation warns that deleting is permanent and starts on Yes', function(){
  displayDeleteConfirmation(function(){});

  var popup = document.querySelector('.delete-confirm-popup');
  assert.ok(popup);
  assert.strictEqual(popup.querySelector('h1').innerText, 'WARNING:');
  assert.match(popup.querySelector('p').innerText, /permanent/);
  assert.strictEqual(document.activeElement, getButton('Yes'));
});

test('Yes runs the deletion and takes the popup down', function(){
  var confirmed = 0;
  displayDeleteConfirmation(function(){ confirmed++; });

  getButton('Yes').onclick();

  assert.strictEqual(confirmed, 1);
  assert.strictEqual(document.querySelector('.delete-confirm-popup'), null);
});

test('No takes the popup down without deleting anything', function(){
  var confirmed = 0;
  displayDeleteConfirmation(function(){ confirmed++; });

  getButton('No').onclick();

  assert.strictEqual(confirmed, 0);
  assert.strictEqual(document.querySelector('.delete-confirm-popup'), null);
});

//Holding the delete shortcut, or clicking through twice, used to stack a second popup on top of the
//first - leaving one behind after the visible one had been answered.
test('asking twice in a row does not stack a second popup', function(){
  displayDeleteConfirmation(function(){});
  var second = displayDeleteConfirmation(function(){});

  assert.strictEqual(second, null);
  assert.strictEqual(document.querySelectorAll('.delete-confirm-popup').length, 1);
});

test('the popup can be raised again once the first has been answered', function(){
  displayDeleteConfirmation(function(){});
  getButton('No').onclick();

  assert.ok(displayDeleteConfirmation(function(){}));
  assert.strictEqual(document.querySelectorAll('.delete-confirm-popup').length, 1);
});
