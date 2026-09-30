const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const displayRebootConfirmation = require('../src/components/views/reboot-confirmation_display');

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

test('the confirmation warns that it reboots the computer and starts on No', function(){
  displayRebootConfirmation(function(){});

  var popup = document.querySelector('.reboot-confirm-popup');
  assert.ok(popup);
  assert.strictEqual(popup.querySelector('h1').innerText, 'WARNING:');
  assert.strictEqual(popup.querySelector('p').innerText,
    'This will reboot your computer, not the program. Continue?');
  assert.strictEqual(document.activeElement, getButton('No'));
});

test('Yes continues and takes the popup down', function(){
  var confirmed = 0;
  displayRebootConfirmation(function(){ confirmed++; });

  getButton('Yes').onclick();

  assert.strictEqual(confirmed, 1);
  assert.strictEqual(document.querySelector('.reboot-confirm-popup'), null);
});

test('No takes the popup down without continuing', function(){
  var confirmed = 0;
  displayRebootConfirmation(function(){ confirmed++; });

  getButton('No').onclick();

  assert.strictEqual(confirmed, 0);
  assert.strictEqual(document.querySelector('.reboot-confirm-popup'), null);
});

test('asking twice in a row does not stack a second popup', function(){
  displayRebootConfirmation(function(){});
  var second = displayRebootConfirmation(function(){});

  assert.strictEqual(second, null);
  assert.strictEqual(document.querySelectorAll('.reboot-confirm-popup').length, 1);
});
