const test = require('node:test');
const assert = require('node:assert');
const child_process = require('child_process');
const { EventEmitter } = require('events');

const errorLog = require('../src/components/controllers/error-log');
const wifiManagerPath = require.resolve('../src/components/controllers/wifi-manager');

//wifi-manager.js holds a standing `createPlatform(createNodeBacking({}))` instance built at
//require-time, and that instance captures child_process.spawn once, when createNodeBacking() is
//called - so any test that mocks child_process.spawn must re-require this module afterward for a
//fresh backing to pick up the mock, same reasoning as battery-monitor.test.js and updates.test.js.
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

//A spawn ENOENT (the binary is not installed) is the shape platform-node.js's
//unavailableOrIoError() maps to CODES.UNAVAILABLE - the ordinary case off a writerDeck, not a
//failure worth logging every time this dialog opens. Any other error - a generic Error, or an
//ENOENT-flavored message with no `.code` - falls through to IO_ERROR instead, which does log.
//Matches platform.test.js's own enoent() helper.
function enoent(command){
  const err = new Error('spawn ' + command + ' ENOENT');
  err.code = 'ENOENT';
  return err;
}

//---------------------------------------------------------------------------
// getIpAddress
//---------------------------------------------------------------------------

test('getIpAddress resolves with the address reported by hostname -I', async function(t){
  mockSpawnSequence(t, [{ chunks: ['192.168.1.42 fe80::1\n'] }]);
  const { getIpAddress } = freshWifiManager();

  assert.strictEqual(await getIpAddress(), '192.168.1.42');
});

//Regression: the old code called back on every stdout 'data' event instead of accumulating,
//so an address split across chunks (e.g. "192.168." then "1.42\n") could be reported partially.
test('getIpAddress assembles an address split across multiple stdout chunks', async function(t){
  mockSpawnSequence(t, [{ chunks: ['192.168.', '1.42\n'] }]);
  const { getIpAddress } = freshWifiManager();

  assert.strictEqual(await getIpAddress(), '192.168.1.42');
});

test('getIpAddress reports "no data" when hostname produces no output', async function(t){
  mockSpawnSequence(t, [{ chunks: [] }]);
  const { getIpAddress } = freshWifiManager();

  assert.strictEqual(await getIpAddress(), 'no data');
});

//UNAVAILABLE (hostname not installed) is the everyday case off a writerDeck and must not be logged.
test('getIpAddress reports "no data" without logging when hostname is not installed', async function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  mockSpawnSequence(t, [{ error: enoent('hostname') }]);
  const { getIpAddress } = freshWifiManager();

  assert.strictEqual(await getIpAddress(), 'no data');
  assert.strictEqual(logErrorMock.mock.calls.length, 0);
});

//A genuine spawn failure (not "missing binary") is still worth logging.
test('getIpAddress reports "no data" and logs on a genuine spawn failure', async function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  mockSpawnSequence(t, [{ error: new Error('spawn hostname EMFILE') }]);
  const { getIpAddress } = freshWifiManager();

  assert.strictEqual(await getIpAddress(), 'no data');
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

//---------------------------------------------------------------------------
// getConnectionState
//---------------------------------------------------------------------------

test('getConnectionState reports the wifi device\'s state and connection name', async function(t){
  mockSpawnSequence(t, [{ chunks: ['eth0:ethernet:connected:Wired\nwlan0:wifi:connected:HomeNet\n'] }]);
  const { getConnectionState } = freshWifiManager();

  assert.deepStrictEqual(await getConnectionState(), { state: 'connected', connection: 'HomeNet' });
});

test('getConnectionState reports unknown instead of throwing when no wifi device is present', async function(t){
  mockSpawnSequence(t, [{ chunks: ['eth0:ethernet:connected:Wired\n'] }]);
  const { getConnectionState } = freshWifiManager();

  assert.deepStrictEqual(await getConnectionState(), { state: 'unknown', connection: null });
});

//Regression: a plain split(':') misaligned fields whenever a value contained a literal colon,
//which nmcli terse output escapes as "\:".
test('getConnectionState unescapes a connection name containing a literal colon', async function(t){
  mockSpawnSequence(t, [{ chunks: ['wlan0:wifi:connected:My\\:Home\n'] }]);
  const { getConnectionState } = freshWifiManager();

  assert.deepStrictEqual(await getConnectionState(), { state: 'connected', connection: 'My:Home' });
});

test('getConnectionState reports unknown without logging when nmcli is not installed', async function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  mockSpawnSequence(t, [{ error: enoent('nmcli') }]);
  const { getConnectionState } = freshWifiManager();

  assert.deepStrictEqual(await getConnectionState(), { state: 'unknown', connection: null });
  assert.strictEqual(logErrorMock.mock.calls.length, 0);
});

test('getConnectionState reports unknown and logs on a genuine spawn failure', async function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  mockSpawnSequence(t, [{ error: new Error('spawn nmcli EMFILE') }]);
  const { getConnectionState } = freshWifiManager();

  assert.deepStrictEqual(await getConnectionState(), { state: 'unknown', connection: null });
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

//---------------------------------------------------------------------------
// getWifiNetworks
//---------------------------------------------------------------------------

test('getWifiNetworks lists networks and flags the currently connected one', async function(t){
  mockSpawnSequence(t, [{ chunks: [':aa:bb:cc:dd:ee:ff:Office\n*:aa:bb:cc:dd:ee:ff:HomeNet\n'] }]);
  const { getWifiNetworks } = freshWifiManager();

  assert.deepStrictEqual(await getWifiNetworks(), [
    { ssid: 'Office', isConnected: false },
    { ssid: 'HomeNet', isConnected: true }
  ]);
});

test('getWifiNetworks unescapes an SSID containing a literal colon', async function(t){
  mockSpawnSequence(t, [{ chunks: ['*:aa:bb:cc:dd:ee:ff:Office\\:5G\n'] }]);
  const { getWifiNetworks } = freshWifiManager();

  assert.deepStrictEqual(await getWifiNetworks(), [{ ssid: 'Office:5G', isConnected: true }]);
});

test('getWifiNetworks resolves with an empty list instead of crashing when nmcli fails to spawn', async function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  mockSpawnSequence(t, [{ error: new Error('spawn nmcli EMFILE') }]);
  const { getWifiNetworks } = freshWifiManager();

  assert.deepStrictEqual(await getWifiNetworks(), []);
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

test('getWifiNetworks resolves with an empty list without logging when nmcli is not installed', async function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  mockSpawnSequence(t, [{ error: enoent('nmcli') }]);
  const { getWifiNetworks } = freshWifiManager();

  assert.deepStrictEqual(await getWifiNetworks(), []);
  assert.strictEqual(logErrorMock.mock.calls.length, 0);
});

//---------------------------------------------------------------------------
// getWifiStatus / enableWifi / disableWifi
//---------------------------------------------------------------------------

test('getWifiStatus resolves with the trimmed nmcli radio wifi output', async function(t){
  const calls = mockSpawnSequence(t, [{ chunks: ['enabled\n'] }]);
  const { getWifiStatus } = freshWifiManager();

  assert.strictEqual(await getWifiStatus(), 'enabled');
  assert.deepStrictEqual(calls[0].args, ['radio', 'wifi']);
});

test('getWifiStatus reports "no data" without logging when nmcli is not installed', async function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  mockSpawnSequence(t, [{ error: enoent('nmcli') }]);
  const { getWifiStatus } = freshWifiManager();

  assert.strictEqual(await getWifiStatus(), 'no data');
  assert.strictEqual(logErrorMock.mock.calls.length, 0);
});

test('enableWifi and disableWifi invoke nmcli with the matching radio command', async function(t){
  const enableCalls = mockSpawnSequence(t, [{ code: 0 }]);
  const { enableWifi } = freshWifiManager();
  await enableWifi();
  assert.deepStrictEqual(enableCalls[0].args, ['radio', 'wifi', 'on']);

  const disableCalls = mockSpawnSequence(t, [{ code: 0 }]);
  const { disableWifi } = freshWifiManager();
  await disableWifi();
  assert.deepStrictEqual(disableCalls[0].args, ['radio', 'wifi', 'off']);
});

//Regression: spawn() emitting an unhandled 'error' event used to throw uncaught and crash the
//process instead of resolving gracefully. Not-installed is UNAVAILABLE and must not be logged.
test('disableWifi resolves without logging when nmcli is not installed', async function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  mockSpawnSequence(t, [{ error: enoent('nmcli') }]);
  const { disableWifi } = freshWifiManager();

  await assert.doesNotReject(disableWifi());
  assert.strictEqual(logErrorMock.mock.calls.length, 0);
});

test('enableWifi resolves but logs when nmcli exits non-zero', async function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  mockSpawnSequence(t, [{ stderrChunks: ['nmcli: radio control unavailable'], code: 1 }]);
  const { enableWifi } = freshWifiManager();

  await assert.doesNotReject(enableWifi());
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

//---------------------------------------------------------------------------
// connectToNewWifi
//---------------------------------------------------------------------------

//Phase 8: connectToNewWifi routes through platform.wifiConnect(), which reports success as a
//resolved void rather than nmcli's own stdout text (see platform-node.js) - the caller now gets a
//fixed confirmation message on success rather than whatever nmcli happened to print.
test('connectToNewWifi passes the ssid and password as separate argv elements and reports success', async function(t){
  const calls = mockSpawnSequence(t, [{ chunks: ['Device \'wlan0\' successfully activated\n'] }]);
  const { connectToNewWifi } = freshWifiManager();

  const result = await connectToNewWifi('Office:5G', 'p"a$s\'w`ord; rm -rf /');

  assert.strictEqual(calls[0].command, 'nmcli');
  assert.deepStrictEqual(calls[0].args, ['device', 'wifi', 'connect', 'Office:5G', 'password', 'p"a$s\'w`ord; rm -rf /']);
  assert.strictEqual(result, 'Connected.');
});

//Regression coverage for the native path: a non-zero nmcli exit code (wrong password, no
//such network) must be reported to the caller with nmcli's own output, not silently as success.
test('connectToNewWifi reports nmcli\'s own output when the connection attempt fails', async function(t){
  mockSpawnSequence(t, [{ chunks: [], stderrChunks: ['Error: No network with SSID \'Office:5G\' found.\n'], code: 1 }]);
  const { connectToNewWifi } = freshWifiManager();

  const result = await connectToNewWifi('Office:5G', 'wrong-password');

  assert.match(result, /No network with SSID/);
});

test('connectToNewWifi reports the failure message without logging when nmcli is not installed', async function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  mockSpawnSequence(t, [{ error: enoent('nmcli') }]);
  const { connectToNewWifi } = freshWifiManager();

  const result = await connectToNewWifi('Office', 'secret');

  assert.match(result, /nmcli/);
  assert.strictEqual(logErrorMock.mock.calls.length, 0);
});
