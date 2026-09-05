const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const wifiManager = require('../src/components/controllers/wifi-manager');
const wifiManagerDisplayPath = require.resolve('../src/components/views/wifi-manager_display');

//wifi-manager_display.js destructures enableWifi/disableWifi/etc. from wifi-manager.js at
//require-time, so mocking those methods only takes effect if it happens before this re-require
//picks up a fresh module instance - same pattern as battery_display.test.js.
function freshWifiManagerDisplay(){
  delete require.cache[wifiManagerDisplayPath];
  return require(wifiManagerDisplayPath);
}

function mockWifiManager(t, overrides){
  overrides = overrides || {};
  var defaults = {
    getWifiStatus: function(cb){ cb('disabled'); },
    getIpAddress: function(cb){ cb('no data'); },
    getWifiNetworks: function(cb){ cb([]); },
    getConnectionState: function(cb){ cb({ state: 'unknown', connection: null }); },
    enableWifi: function(cb){ cb('enabled'); },
    disableWifi: function(cb){ cb('disabled'); },
    connectToNewWifi: function(ssid, pass, cb){ cb('ok'); }
  };
  Object.keys(defaults).forEach(function(name){
    t.mock.method(wifiManager, name, overrides[name] || defaults[name]);
  });
}

//closePopups() also calls disableSearchView()/focusEditor(), which reach for this fixed shell
//by id - same shell used in settings_display.test.js/properties_display.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
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
  delete require.cache[wifiManagerDisplayPath];
  delete global.window;
  delete global.document;
});

//Regression: updateStateUntilConnected() rescheduled itself via setTimeout with no way to cancel
//it, so once Wi-Fi was enabled it polled getConnectionState/nmcli every 250ms forever if the
//radio never reached the 'connected' state - even after the popup was closed, since closePopups()
//only removes the DOM nodes and never touched this timer chain.
test('closing the popup stops the connection-state poll started by enabling Wi-Fi', function(t){
  t.mock.timers.enable({ apis: ['setTimeout'] });
  var pollCalls = 0;
  mockWifiManager(t, {
    getConnectionState: function(cb){
      pollCalls++;
      cb({ state: 'connecting', connection: null });
    }
  });

  var showWifiManager = freshWifiManagerDisplay();
  showWifiManager();
  var callsAtOpen = pollCalls;

  document.getElementById('enable-wifi-check').click();
  t.mock.timers.tick(500);
  t.mock.timers.tick(250);
  t.mock.timers.tick(250);

  assert.ok(pollCalls > callsAtOpen, 'the poll should be running while Wi-Fi is enabled and the popup is open');

  findButton('Close').onclick();
  var callsAtClose = pollCalls;

  t.mock.timers.tick(250 * 10);

  assert.strictEqual(pollCalls, callsAtClose, 'the poll must stop once the popup is closed');
});

//Regression: calling showWifiManager() again (e.g. reopening the dialog) while a previous
//instance's poll was still running left that stale poll ticking away in the background
//indefinitely, since each call only tore down the DOM of the popup being replaced.
test('reopening the popup stops the previous instance\'s connection-state poll', function(t){
  t.mock.timers.enable({ apis: ['setTimeout'] });
  var pollCalls = 0;
  mockWifiManager(t, {
    getConnectionState: function(cb){
      pollCalls++;
      cb({ state: 'connecting', connection: null });
    }
  });

  var showWifiManager = freshWifiManagerDisplay();
  showWifiManager();
  document.getElementById('enable-wifi-check').click();
  t.mock.timers.tick(500);
  t.mock.timers.tick(250);

  assert.ok(pollCalls > 0, 'sanity check: the poll should have fired at least once');

  showWifiManager();
  var callsAtReopen = pollCalls;

  t.mock.timers.tick(250 * 10);

  assert.strictEqual(pollCalls, callsAtReopen, 'the stale instance\'s poll must not keep firing after reopen');
});

//Regression: clicking Connect sent networksSelect.value straight to connectToNewWifi with no
//check that a network was actually selected, so clicking it before the network list finished
//loading (or when the scan returned nothing) silently issued `nmcli ... connect "" password ...`.
test('Connect refuses to proceed when no network is selected', function(t){
  var connectCalls = 0;
  mockWifiManager(t, {
    connectToNewWifi: function(ssid, pass, cb){ connectCalls++; cb('ok'); }
  });

  var showWifiManager = freshWifiManagerDisplay();
  showWifiManager();

  findButton('Connect').onclick();

  assert.strictEqual(connectCalls, 0);
  assert.strictEqual(document.querySelector('p').innerText, 'Select a network first.');
});

//Regression: nothing disabled the Connect button while a connection attempt was in flight, so
//repeated clicks spawned multiple concurrent `nmcli device wifi connect` processes whose
//callbacks could resolve out of order.
test('Connect disables itself while a connection attempt is in flight and re-enables when it resolves', function(t){
  var capturedCallback;
  mockWifiManager(t, {
    getWifiNetworks: function(cb){ cb([{ ssid: 'HomeNet', isConnected: false }]); },
    connectToNewWifi: function(ssid, pass, cb){ capturedCallback = cb; }
  });

  var showWifiManager = freshWifiManagerDisplay();
  showWifiManager();

  var connectBtn = findButton('Connect');
  assert.strictEqual(document.getElementById('networks-select').value, 'HomeNet');

  connectBtn.onclick();
  assert.strictEqual(connectBtn.disabled, true, 'Connect should disable itself once a request is in flight');

  capturedCallback('Device activated');
  assert.strictEqual(connectBtn.disabled, false, 'Connect should re-enable once the attempt resolves');
});

//Regression: the "New Connection" fieldset (network select/password/connect) was never disabled
//based on the Wi-Fi radio state, so a user could try to scan/connect while the radio was off.
test('the new-connection fieldset stays disabled while Wi-Fi is off and enables once it is on', function(t){
  mockWifiManager(t, { getWifiStatus: function(cb){ cb('disabled'); } });

  var showWifiManager = freshWifiManagerDisplay();
  showWifiManager();

  var fieldset = document.querySelector('fieldset');
  assert.strictEqual(fieldset.disabled, true, 'fieldset should start disabled while Wi-Fi is off');

  t.mock.timers.enable({ apis: ['setTimeout'] });
  document.getElementById('enable-wifi-check').click();
  assert.strictEqual(fieldset.disabled, false, 'checking the box should enable the fieldset immediately');

  document.getElementById('enable-wifi-check').click();
  assert.strictEqual(fieldset.disabled, true, 'unchecking the box should disable the fieldset again');
});

test('a Wi-Fi radio already enabled leaves the new-connection fieldset enabled', function(t){
  mockWifiManager(t, { getWifiStatus: function(cb){ cb('enabled'); } });

  var showWifiManager = freshWifiManagerDisplay();
  showWifiManager();

  assert.strictEqual(document.querySelector('fieldset').disabled, false);
});
