const test = require('node:test');
const assert = require('node:assert');
const child_process = require('child_process');
const { EventEmitter } = require('events');

const errorLog = require('../src/components/controllers/error-log');
const wifiManagerPath = require.resolve('../src/components/controllers/wifi-manager');

//wifi-manager.js destructures `spawn` from child_process at require-time, so any test that
//mocks child_process.spawn must re-require this module afterward for the fresh destructure to
//see the mock - same reasoning as battery-monitor.test.js and updates.test.js.
function freshWifiManager(){
  delete require.cache[wifiManagerPath];
  return require(wifiManagerPath);
}

function makeFakeChild(){
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

//Mocks the sequence of spawn() calls a test expects, in order. Each response can supply
//stdout/stderr chunks, a close code, or a spawn-level error. `close` fires on both the child and
//child.stdout so it works regardless of which one the code under test listens on.
function mockSpawnSequence(t, responses){
  const calls = [];
  t.mock.method(child_process, 'spawn', function(command, args){
    calls.push({ command: command, args: args });
    const child = makeFakeChild();
    const spec = responses[calls.length - 1] || {};
    setImmediate(function(){
      if(spec.error){
        child.emit('error', spec.error);
        return;
      }
      (spec.stderrChunks || []).forEach(function(chunk){ child.stderr.emit('data', Buffer.from(chunk)); });
      (spec.chunks || []).forEach(function(chunk){ child.stdout.emit('data', Buffer.from(chunk)); });
      const code = spec.code != null ? spec.code : 0;
      child.emit('close', code);
      child.stdout.emit('close', code);
    });
    return child;
  });
  return calls;
}

//---------------------------------------------------------------------------
// getIpAddress
//---------------------------------------------------------------------------

test('getIpAddress resolves with the address reported by hostname -I', async function(t){
  mockSpawnSequence(t, [{ chunks: ['192.168.1.42 fe80::1\n'] }]);
  const { getIpAddress } = freshWifiManager();

  const result = await new Promise(function(resolve){ getIpAddress(resolve); });
  assert.strictEqual(result, '192.168.1.42');
});

//Regression: the old code called back on every stdout 'data' event instead of accumulating,
//so an address split across chunks (e.g. "192.168." then "1.42\n") could be reported partially.
test('getIpAddress assembles an address split across multiple stdout chunks', async function(t){
  mockSpawnSequence(t, [{ chunks: ['192.168.', '1.42\n'] }]);
  const { getIpAddress } = freshWifiManager();

  const result = await new Promise(function(resolve){ getIpAddress(resolve); });
  assert.strictEqual(result, '192.168.1.42');
});

test('getIpAddress reports "no data" when hostname produces no output', async function(t){
  mockSpawnSequence(t, [{ chunks: [] }]);
  const { getIpAddress } = freshWifiManager();

  const result = await new Promise(function(resolve){ getIpAddress(resolve); });
  assert.strictEqual(result, 'no data');
});

//Regression: spawn() emitting an unhandled 'error' event (missing binary, EMFILE, etc.) used to
//throw uncaught and crash the process instead of resolving gracefully.
test('getIpAddress reports "no data" instead of crashing when spawn fails', async function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  mockSpawnSequence(t, [{ error: new Error('spawn hostname ENOENT') }]);
  const { getIpAddress } = freshWifiManager();

  const result = await new Promise(function(resolve){ getIpAddress(resolve); });
  assert.strictEqual(result, 'no data');
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

//Regression: cback used to fire once per stdout 'data' event rather than once overall.
test('getIpAddress calls back exactly once even when stdout emits multiple chunks', async function(t){
  mockSpawnSequence(t, [{ chunks: ['192.', '168.', '1.1\n'] }]);
  const { getIpAddress } = freshWifiManager();

  let callCount = 0;
  await new Promise(function(resolve){
    getIpAddress(function(){ callCount++; resolve(); });
  });
  await new Promise(function(resolve){ setImmediate(resolve); });

  assert.strictEqual(callCount, 1);
});

//---------------------------------------------------------------------------
// getConnectionState
//---------------------------------------------------------------------------

test('getConnectionState reports the wifi device\'s state and connection name', async function(t){
  mockSpawnSequence(t, [{ chunks: ['eth0:ethernet:connected:Wired\nwlan0:wifi:connected:HomeNet\n'] }]);
  const { getConnectionState } = freshWifiManager();

  const result = await new Promise(function(resolve){ getConnectionState(resolve); });
  assert.deepStrictEqual(result, { state: 'connected', connection: 'HomeNet' });
});

//Regression: statusData.find() returning undefined (no wifi device present) used to be
//dereferenced with .split(':') unconditionally, throwing a TypeError.
test('getConnectionState reports unknown instead of throwing when no wifi device is present', async function(t){
  mockSpawnSequence(t, [{ chunks: ['eth0:ethernet:connected:Wired\n'] }]);
  const { getConnectionState } = freshWifiManager();

  const result = await new Promise(function(resolve){ getConnectionState(resolve); });
  assert.deepStrictEqual(result, { state: 'unknown', connection: null });
});

//Regression: a plain split(':') misaligned fields whenever a value contained a literal colon,
//which nmcli terse output escapes as "\:".
test('getConnectionState unescapes a connection name containing a literal colon', async function(t){
  mockSpawnSequence(t, [{ chunks: ['wlan0:wifi:connected:My\\:Home\n'] }]);
  const { getConnectionState } = freshWifiManager();

  const result = await new Promise(function(resolve){ getConnectionState(resolve); });
  assert.deepStrictEqual(result, { state: 'connected', connection: 'My:Home' });
});

//Regression: nmcliMulti used to join stdout chunks with Array.prototype.join()'s default ','
//separator instead of ''. A line split across two chunks came back with a stray comma spliced
//into the middle of it, corrupting the field that straddled the boundary.
test('getConnectionState assembles output split across stdout chunks without inserting a stray comma', async function(t){
  mockSpawnSequence(t, [{ chunks: ['wlan0:wifi:conne', 'cted:HomeNet\n'] }]);
  const { getConnectionState } = freshWifiManager();

  const result = await new Promise(function(resolve){ getConnectionState(resolve); });
  assert.deepStrictEqual(result, { state: 'connected', connection: 'HomeNet' });
});

test('getConnectionState reports unknown instead of crashing when nmcli fails to spawn', async function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  mockSpawnSequence(t, [{ error: new Error('spawn nmcli ENOENT') }]);
  const { getConnectionState } = freshWifiManager();

  const result = await new Promise(function(resolve){ getConnectionState(resolve); });
  assert.deepStrictEqual(result, { state: 'unknown', connection: null });
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

//---------------------------------------------------------------------------
// getWifiNetworks
//---------------------------------------------------------------------------

test('getWifiNetworks lists networks and flags the currently connected one', async function(t){
  mockSpawnSequence(t, [{ chunks: [':aa:bb:cc:dd:ee:ff:Office\n*:aa:bb:cc:dd:ee:ff:HomeNet\n'] }]);
  const { getWifiNetworks } = freshWifiManager();

  const result = await new Promise(function(resolve){ getWifiNetworks(resolve); });
  assert.deepStrictEqual(result, [
    { ssid: 'Office', isConnected: false },
    { ssid: 'HomeNet', isConnected: true }
  ]);
});

test('getWifiNetworks filters out lines with no ssid', async function(t){
  mockSpawnSequence(t, [{ chunks: [':aa:bb:cc:dd:ee:ff:\n*:aa:bb:cc:dd:ee:ff:HomeNet\n\n'] }]);
  const { getWifiNetworks } = freshWifiManager();

  const result = await new Promise(function(resolve){ getWifiNetworks(resolve); });
  assert.deepStrictEqual(result, [{ ssid: 'HomeNet', isConnected: true }]);
});

//Regression: a plain split(':') misaligned fields whenever the SSID contained a literal colon,
//which nmcli terse output escapes as "\:".
test('getWifiNetworks unescapes an SSID containing a literal colon', async function(t){
  mockSpawnSequence(t, [{ chunks: ['*:aa:bb:cc:dd:ee:ff:Office\\:5G\n'] }]);
  const { getWifiNetworks } = freshWifiManager();

  const result = await new Promise(function(resolve){ getWifiNetworks(resolve); });
  assert.deepStrictEqual(result, [{ ssid: 'Office:5G', isConnected: true }]);
});

//Regression: joining stdout chunks with the default ',' separator spliced a stray comma into
//whichever field straddled a chunk boundary.
test('getWifiNetworks assembles output split across stdout chunks without inserting a stray comma', async function(t){
  mockSpawnSequence(t, [{ chunks: ['*:aa:bb:cc:dd:ee:ff:Home', 'Net\n'] }]);
  const { getWifiNetworks } = freshWifiManager();

  const result = await new Promise(function(resolve){ getWifiNetworks(resolve); });
  assert.deepStrictEqual(result, [{ ssid: 'HomeNet', isConnected: true }]);
});

test('getWifiNetworks resolves with an empty list instead of crashing when nmcli fails to spawn', async function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  mockSpawnSequence(t, [{ error: new Error('spawn nmcli ENOENT') }]);
  const { getWifiNetworks } = freshWifiManager();

  const result = await new Promise(function(resolve){ getWifiNetworks(resolve); });
  assert.deepStrictEqual(result, []);
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

//---------------------------------------------------------------------------
// getWifiStatus / enableWifi / disableWifi
//---------------------------------------------------------------------------

test('getWifiStatus resolves with the trimmed nmcli radio wifi output', async function(t){
  const calls = mockSpawnSequence(t, [{ chunks: ['enabled\n'] }]);
  const { getWifiStatus } = freshWifiManager();

  const result = await new Promise(function(resolve){ getWifiStatus(resolve); });
  assert.strictEqual(result, 'enabled');
  assert.deepStrictEqual(calls[0].args, ['radio', 'wifi']);
});

test('enableWifi and disableWifi invoke nmcli with the matching radio command', async function(t){
  const enableCalls = mockSpawnSequence(t, [{ chunks: ['enabled\n'] }]);
  const { enableWifi } = freshWifiManager();
  await new Promise(function(resolve){ enableWifi(resolve); });
  assert.deepStrictEqual(enableCalls[0].args, ['radio', 'wifi', 'on']);

  const disableCalls = mockSpawnSequence(t, [{ chunks: ['disabled\n'] }]);
  const { disableWifi } = freshWifiManager();
  await new Promise(function(resolve){ disableWifi(resolve); });
  assert.deepStrictEqual(disableCalls[0].args, ['radio', 'wifi', 'off']);
});

//Regression: spawn() emitting an unhandled 'error' event used to throw uncaught and crash the
//process instead of resolving gracefully.
test('disableWifi reports "no data" instead of crashing when spawn fails', async function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  mockSpawnSequence(t, [{ error: new Error('spawn nmcli ENOENT') }]);
  const { disableWifi } = freshWifiManager();

  const result = await new Promise(function(resolve){ disableWifi(resolve); });
  assert.strictEqual(result, 'no data');
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

//Regression: cback used to fire once per stdout 'data' event rather than once overall.
test('getWifiStatus calls back exactly once even when stdout emits multiple chunks', async function(t){
  mockSpawnSequence(t, [{ chunks: ['ena', 'bled\n'] }]);
  const { getWifiStatus } = freshWifiManager();

  let callCount = 0;
  await new Promise(function(resolve){
    getWifiStatus(function(){ callCount++; resolve(); });
  });
  await new Promise(function(resolve){ setImmediate(resolve); });

  assert.strictEqual(callCount, 1);
});

//---------------------------------------------------------------------------
// connectToNewWifi
//---------------------------------------------------------------------------

test('connectToNewWifi passes the ssid and password as separate argv elements and relays the result', async function(t){
  const calls = mockSpawnSequence(t, [{ chunks: ['Device \'wlan0\' successfully activated\n'] }]);
  const { connectToNewWifi } = freshWifiManager();

  const result = await new Promise(function(resolve){
    connectToNewWifi('Office:5G', 'p"a$s\'w`ord; rm -rf /', resolve);
  });

  assert.strictEqual(calls[0].command, 'nmcli');
  assert.deepStrictEqual(calls[0].args, ['device', 'wifi', 'connect', 'Office:5G', 'password', 'p"a$s\'w`ord; rm -rf /']);
  assert.ok(result.includes('successfully activated'));
});
