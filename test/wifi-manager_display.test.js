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

//All seven of wifi-manager.js's functions are promise-returning now (they route entirely through
//the platform facade as of the group K wifi gap closing) - the mocks below stand in for those
//promises rather than for a callback parameter.
function mockWifiManager(t, overrides){
  overrides = overrides || {};
  var defaults = {
    getWifiStatus: function(){ return Promise.resolve('disabled'); },
    getIpAddress: function(){ return Promise.resolve('no data'); },
    getWifiNetworks: function(){ return Promise.resolve([]); },
    getConnectionState: function(){ return Promise.resolve({ state: 'unknown', connection: null }); },
    enableWifi: function(){ return Promise.resolve(); },
    disableWifi: function(){ return Promise.resolve(); },
    connectToNewWifi: function(){ return Promise.resolve('ok'); }
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

//Every controller call the dialog makes on open (and on most clicks) resolves on a microtask at
//the earliest now that wifi-manager.js is async throughout - flush one before asserting on
//anything the resulting `.then` would have set.
function flushMicrotasks(){
  return new Promise(function(resolve){ setImmediate(resolve); });
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
//only removes the DOM nodes and never touched this timer chain. Converting the poll to
//pollUntilConnected() (a promise chain, not a timer) reopened the same question from a different
//angle: nothing external can cancel a promise, so isCurrent() has to be checked inside the loop
//itself. This is the direct proof that check does its job - deleting it (or checking it only once,
//outside the loop) leaves this test failing with pollCalls still climbing after Close.
test('closing the popup stops the connection-state poll started by enabling Wi-Fi', async function(t){
  t.mock.timers.enable({ apis: ['setTimeout'] });
  var pollCalls = 0;
  mockWifiManager(t, {
    getConnectionState: function(){
      pollCalls++;
      return Promise.resolve({ state: 'connecting', connection: null });
    }
  });

  var showWifiManager = freshWifiManagerDisplay();
  showWifiManager();
  await flushMicrotasks();
  var callsAtOpen = pollCalls;

  document.getElementById('enable-wifi-check').click();
  await flushMicrotasks();
  t.mock.timers.tick(500);
  await flushMicrotasks();
  t.mock.timers.tick(250);
  await flushMicrotasks();
  t.mock.timers.tick(250);
  await flushMicrotasks();

  assert.ok(pollCalls > callsAtOpen, 'the poll should be running while Wi-Fi is enabled and the popup is open');

  findButton('Close').onclick();
  var callsAtClose = pollCalls;

  t.mock.timers.tick(250 * 10);
  await flushMicrotasks();

  assert.strictEqual(pollCalls, callsAtClose, 'the poll must stop once the popup is closed');
});

//Regression: calling showWifiManager() again (e.g. reopening the dialog) while a previous
//instance's poll was still running left that stale poll ticking away in the background
//indefinitely, since each call only tore down the DOM of the popup being replaced.
test('reopening the popup stops the previous instance\'s connection-state poll', async function(t){
  t.mock.timers.enable({ apis: ['setTimeout'] });
  var pollCalls = 0;
  mockWifiManager(t, {
    getConnectionState: function(){
      pollCalls++;
      return Promise.resolve({ state: 'connecting', connection: null });
    }
  });

  var showWifiManager = freshWifiManagerDisplay();
  showWifiManager();
  await flushMicrotasks();

  document.getElementById('enable-wifi-check').click();
  await flushMicrotasks();
  t.mock.timers.tick(500);
  await flushMicrotasks();
  t.mock.timers.tick(250);
  await flushMicrotasks();

  assert.ok(pollCalls > 0, 'sanity check: the poll should have fired at least once');

  showWifiManager();
  await flushMicrotasks();
  var callsAtReopen = pollCalls;

  t.mock.timers.tick(250 * 10);
  await flushMicrotasks();

  assert.strictEqual(pollCalls, callsAtReopen, 'the stale instance\'s poll must not keep firing after reopen');
});

//Distinct from the two tests above: those catch the loop *re-issuing* a call after close. This
//catches the other half - a call already in flight when Close is clicked, whose result lands
//afterward. Without the isCurrent() check right after the await (not just the one in the while
//condition), a 'connected' result arriving late would still be written into a dialog nobody can
//see any more.
test('a connected result that arrives after Close is not written into the stale dialog', async function(t){
  t.mock.timers.enable({ apis: ['setTimeout'] });
  var resolvePoll;
  var callCount = 0;
  mockWifiManager(t, {
    getConnectionState: function(){
      callCount++;
      //Call 1 is showWifiManager()'s own initial load; call 2 is pollUntilConnected's first
      //iteration, left pending so the test can close the dialog while it is still in flight.
      if(callCount === 1) return Promise.resolve({ state: 'unknown', connection: null });
      return new Promise(function(resolve){ resolvePoll = resolve; });
    }
  });

  var showWifiManager = freshWifiManagerDisplay();
  showWifiManager();
  await flushMicrotasks();

  var rows = document.querySelectorAll('table')[0].querySelectorAll('tr');
  var stateLabel = rows[2].querySelectorAll('td')[1].querySelector('label');

  document.getElementById('enable-wifi-check').click();
  await flushMicrotasks();
  t.mock.timers.tick(500);
  await flushMicrotasks();

  assert.strictEqual(callCount, 2, 'sanity check: the poll\'s first getConnectionState call should be in flight');

  findButton('Close').onclick();

  resolvePoll({ state: 'connected', connection: 'HomeNet' });
  await flushMicrotasks();

  assert.notStrictEqual(stateLabel.innerText, 'connected',
    'a result that lands after Close must not still be written into the dialog it closed');
});

//The failure mode this guards against is not "throws a visible error" but "a crash with nothing on
//screen" - Phase 5's missing-pups_display regression was exactly this shape: async work that
//outlived the DOM it was scheduled against turned into an unhandled rejection instead of a test
//failure. Reproducing the same sequence here (close, then tear down globals, then let the pending
//step of the poll actually run) is the direct check that isCurrent() stops the loop before it ever
//reaches code that would touch a gone-away document/window.
test('a poll left in flight when the dialog closes does not throw or reject once the globals are gone', async function(t){
  t.mock.timers.enable({ apis: ['setTimeout'] });
  mockWifiManager(t, {
    getConnectionState: function(){ return Promise.resolve({ state: 'connecting', connection: null }); }
  });

  var unhandled = [];
  function onUnhandledRejection(err){ unhandled.push(err); }
  process.on('unhandledRejection', onUnhandledRejection);
  t.after(function(){ process.removeListener('unhandledRejection', onUnhandledRejection); });

  var showWifiManager = freshWifiManagerDisplay();
  showWifiManager();
  await flushMicrotasks();

  document.getElementById('enable-wifi-check').click();
  await flushMicrotasks();
  t.mock.timers.tick(500);
  await flushMicrotasks();

  //Close while pollUntilConnected is paused mid-loop (inside `await delay(250)`), then tear down
  //the DOM globals entirely - the same order test.afterEach uses, and the order a real app close
  //or a real test teardown would hit if this were still in flight.
  findButton('Close').onclick();
  delete global.window;
  delete global.document;

  assert.doesNotThrow(function(){
    t.mock.timers.tick(250 * 10);
  }, 'the resumed poll must not dereference a torn-down global to decide it is stale');
  await flushMicrotasks();

  assert.deepStrictEqual(unhandled, [], 'no unhandled rejection should surface once the DOM is gone');
});

//Regression: clicking Connect sent networksSelect.value straight to connectToNewWifi with no
//check that a network was actually selected, so clicking it before the network list finished
//loading (or when the scan returned nothing) silently issued `nmcli ... connect "" password ...`.
test('Connect refuses to proceed when no network is selected', async function(t){
  var connectCalls = 0;
  mockWifiManager(t, {
    connectToNewWifi: function(){ connectCalls++; return Promise.resolve('ok'); }
  });

  var showWifiManager = freshWifiManagerDisplay();
  showWifiManager();
  await flushMicrotasks();

  findButton('Connect').onclick();

  assert.strictEqual(connectCalls, 0);
  assert.strictEqual(document.querySelector('p').innerText, 'Select a network first.');
});

//Regression: nothing disabled the Connect button while a connection attempt was in flight, so
//repeated clicks spawned multiple concurrent `nmcli device wifi connect` processes whose
//callbacks could resolve out of order.
test('Connect disables itself while a connection attempt is in flight and re-enables when it resolves', async function(t){
  var capturedResolve;
  mockWifiManager(t, {
    getWifiNetworks: function(){ return Promise.resolve([{ ssid: 'HomeNet', isConnected: false }]); },
    connectToNewWifi: function(){
      return new Promise(function(resolve){ capturedResolve = resolve; });
    }
  });

  var showWifiManager = freshWifiManagerDisplay();
  showWifiManager();
  await flushMicrotasks();

  var connectBtn = findButton('Connect');
  assert.strictEqual(document.getElementById('networks-select').value, 'HomeNet');

  connectBtn.onclick();
  assert.strictEqual(connectBtn.disabled, true, 'Connect should disable itself once a request is in flight');

  capturedResolve('Device activated');
  await flushMicrotasks();
  assert.strictEqual(connectBtn.disabled, false, 'Connect should re-enable once the attempt resolves');
});

//Regression: the "New Connection" fieldset (network select/password/connect) was never disabled
//based on the Wi-Fi radio state, so a user could try to scan/connect while the radio was off.
test('the new-connection fieldset stays disabled while Wi-Fi is off and enables once it is on', async function(t){
  mockWifiManager(t, { getWifiStatus: function(){ return Promise.resolve('disabled'); } });

  var showWifiManager = freshWifiManagerDisplay();
  showWifiManager();
  await flushMicrotasks();

  var fieldset = document.querySelector('fieldset');
  assert.strictEqual(fieldset.disabled, true, 'fieldset should start disabled while Wi-Fi is off');

  t.mock.timers.enable({ apis: ['setTimeout'] });
  document.getElementById('enable-wifi-check').click();
  assert.strictEqual(fieldset.disabled, false, 'checking the box should enable the fieldset immediately');

  document.getElementById('enable-wifi-check').click();
  assert.strictEqual(fieldset.disabled, true, 'unchecking the box should disable the fieldset again');
});

test('a Wi-Fi radio already enabled leaves the new-connection fieldset enabled', async function(t){
  mockWifiManager(t, { getWifiStatus: function(){ return Promise.resolve('enabled'); } });

  var showWifiManager = freshWifiManagerDisplay();
  showWifiManager();
  await flushMicrotasks();

  assert.strictEqual(document.querySelector('fieldset').disabled, false);
});
