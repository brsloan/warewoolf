const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const bluetoothManager = require('../src/components/controllers/bluetooth-manager');
const displayPath = require.resolve('../src/components/views/bluetooth-manager_display');

//bluetooth-manager_display.js destructures its controller functions at require-time, so the mocks
//only take effect through a fresh require - same pattern as wifi-manager_display.test.js.
function freshDisplay(){
  delete require.cache[displayPath];
  return require(displayPath);
}

var KEYBOARD = { address: 'AA:BB:CC:DD:EE:02', name: 'K380', paired: false, connected: false, icon: 'input-keyboard' };
var PAIRED = { address: 'AA:BB:CC:DD:EE:03', name: 'Old Keys', paired: true, connected: true, icon: 'input-keyboard' };

function mockBluetoothManager(t, overrides){
  overrides = overrides || {};
  var defaults = {
    getBluetoothStatus: function(){ return Promise.resolve({ status: 'enabled', message: null }); },
    enableBluetooth: function(){ return Promise.resolve(null); },
    disableBluetooth: function(){ return Promise.resolve(null); },
    getBluetoothDevices: function(){ return Promise.resolve([PAIRED]); },
    scanForDevices: function(){ return Promise.resolve({ devices: [PAIRED, KEYBOARD], message: null }); },
    connectDevice: function(device){ return Promise.resolve('Connected to ' + device.name + '.'); },
    forgetDevice: function(device){ return Promise.resolve('Forgot ' + device.name + '.'); }
  };
  var calls = {};
  Object.keys(defaults).forEach(function(name){
    calls[name] = [];
    var impl = overrides[name] || defaults[name];
    t.mock.method(bluetoothManager, name, function(){
      calls[name].push(Array.from(arguments));
      return impl.apply(null, arguments);
    });
  });
  return calls;
}

function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

function findButton(text){
  return Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent === text; });
}

function flushMicrotasks(){
  return new Promise(function(resolve){ setImmediate(resolve); });
}

function optionTexts(){
  return Array.from(document.getElementById('bluetooth-devices-select').options).map(function(o){ return o.innerText; });
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[displayPath];
  delete global.window;
  delete global.document;
});

test('opens showing the adapter state and the known devices', async function(t){
  mockBluetoothManager(t);
  freshDisplay()();
  await flushMicrotasks();

  assert.strictEqual(document.querySelector('.popup h1').innerText, 'Bluetooth Manager');
  assert.strictEqual(document.getElementById('enable-bluetooth-check').checked, true);
  assert.strictEqual(document.querySelector('.popup fieldset').disabled, false);
  assert.deepStrictEqual(optionTexts(), ['Old Keys (keyboard) - connected']);
});

test('with no adapter it says why and offers nothing to press', async function(t){
  mockBluetoothManager(t, {
    getBluetoothStatus: function(){ return Promise.resolve({ status: 'unavailable', message: 'No Bluetooth adapter was found.' }); },
    getBluetoothDevices: function(){ return Promise.resolve([]); }
  });
  freshDisplay()();
  await flushMicrotasks();

  assert.strictEqual(document.getElementById('bluetooth-status').innerText, 'No Bluetooth adapter was found.');
  assert.strictEqual(document.getElementById('enable-bluetooth-check').disabled, true);
  assert.strictEqual(document.querySelector('.popup fieldset').disabled, true);
});

test('Scan lists what it found, and Connect pairs the chosen device', async function(t){
  var calls = mockBluetoothManager(t, {
    getBluetoothDevices: (function(){
      var n = 0;
      return function(){ n++; return Promise.resolve(n === 1 ? [PAIRED] : [Object.assign({}, KEYBOARD, { paired: true, connected: true }), PAIRED]); };
    })()
  });
  freshDisplay()();
  await flushMicrotasks();

  findButton('Scan').onclick();
  await flushMicrotasks();
  assert.deepStrictEqual(optionTexts(), ['Old Keys (keyboard) - connected', 'K380 (keyboard)']);

  var select = document.getElementById('bluetooth-devices-select');
  select.selectedIndex = 1;
  findButton('Connect').onclick();
  await flushMicrotasks();

  assert.strictEqual(calls.connectDevice.length, 1);
  assert.strictEqual(calls.connectDevice[0][0].address, KEYBOARD.address);
  assert.strictEqual(document.getElementById('bluetooth-message').innerText, 'Connected to K380.');
  assert.deepStrictEqual(optionTexts(), ['K380 (keyboard) - connected', 'Old Keys (keyboard) - connected']);
  assert.strictEqual(select.options[select.selectedIndex].value, KEYBOARD.address, 'the chosen device stays chosen');
});

test('Enter on the device list connects, and Forget forgets', async function(t){
  var calls = mockBluetoothManager(t);
  freshDisplay()();
  await flushMicrotasks();

  var select = document.getElementById('bluetooth-devices-select');
  select.onkeydown({ key: 'Enter', preventDefault: function(){} });
  await flushMicrotasks();
  assert.strictEqual(calls.connectDevice.length, 1);

  findButton('Forget').onclick();
  await flushMicrotasks();
  assert.strictEqual(calls.forgetDevice[0][0].address, PAIRED.address);
  assert.strictEqual(document.getElementById('bluetooth-message').innerText, 'Forgot Old Keys.');
});

test('turning Bluetooth off asks the adapter, then rereads its state', async function(t){
  var enabled = true;
  var calls = mockBluetoothManager(t, {
    getBluetoothStatus: function(){ return Promise.resolve({ status: enabled ? 'enabled' : 'disabled', message: null }); },
    disableBluetooth: function(){ enabled = false; return Promise.resolve(null); }
  });
  freshDisplay()();
  await flushMicrotasks();

  var check = document.getElementById('enable-bluetooth-check');
  check.checked = false;
  check.onclick();
  await flushMicrotasks();

  assert.strictEqual(calls.disableBluetooth.length, 1);
  assert.strictEqual(check.checked, false);
  assert.strictEqual(document.querySelector('.popup fieldset').disabled, true);
});

//A scan takes ten seconds; closing the dialog in the meantime must not have its result land in
//whatever popup is open by then.
test('a scan that finishes after Close writes nothing', async function(t){
  var finishScan;
  mockBluetoothManager(t, {
    scanForDevices: function(){ return new Promise(function(resolve){ finishScan = resolve; }); }
  });
  freshDisplay()();
  await flushMicrotasks();

  var message = document.getElementById('bluetooth-message');
  var select = document.getElementById('bluetooth-devices-select');
  findButton('Scan').onclick();
  findButton('Close').onclick();

  finishScan({ devices: [KEYBOARD], message: null });
  await flushMicrotasks();

  assert.strictEqual(message.innerText, 'Scanning for ten seconds...');
  assert.strictEqual(select.options.length, 1);
});
