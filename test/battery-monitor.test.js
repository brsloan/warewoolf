const test = require('node:test');
const assert = require('node:assert');
const child_process = require('child_process');
const fs = require('fs');
const { EventEmitter } = require('events');

const errorLog = require('../src/components/controllers/error-log');
const batteryMonitorPath = require.resolve('../src/components/controllers/battery-monitor');
const { installBridge, uninstallBridge } = require('./fake-bridge');

test.after(uninstallBridge);

//battery-monitor.js keeps its running interval id in module-level state (like autosave.js), so
//each test needs a fresh module instance to avoid one test's timer id leaking into the next.
//Phase 8: getBatteryCapacity (group K) also holds its own standing platform instance. As of Phase
//9a that instance is ipc-backed, and the node backing behind the bridge is what resolves
//child_process.spawn/fs.readdirSync off the real modules - once, at construction, not fresh on
//every call. So a test that mocks either has to do it *before* the bridge is installed here, same
//reasoning as updates.test.js's/wifi-manager.test.js's own freshXxx() helpers.
function freshBatteryMonitor(){
  delete require.cache[batteryMonitorPath];
  installBridge();
  return require(batteryMonitorPath);
}

function makeFakeCat(){
  const cat = new EventEmitter();
  cat.stdout = new EventEmitter();
  cat.stderr = new EventEmitter();
  return cat;
}

//Real `cat`/sysfs only exist on Linux, so every test here mocks child_process.spawn and
//fs.readdirSync instead of touching the real OS - that keeps these tests OS-independent
//(they run the same on Windows/macOS/Linux/CI) while still exercising the real callback logic.
function mockSpawnWithChunks(t, chunks){
  return t.mock.method(child_process, 'spawn', function(){
    const cat = makeFakeCat();
    setImmediate(function(){
      chunks.forEach(function(chunk){ cat.stdout.emit('data', Buffer.from(chunk)); });
      cat.stdout.emit('close', 0);
    });
    return cat;
  });
}

function mockSpawnWithSpawnError(t, err){
  return t.mock.method(child_process, 'spawn', function(){
    const cat = makeFakeCat();
    setImmediate(function(){
      cat.emit('error', err);
    });
    return cat;
  });
}

function mockSpawnWithStderr(t, stderrText){
  return t.mock.method(child_process, 'spawn', function(){
    const cat = makeFakeCat();
    setImmediate(function(){
      cat.stderr.emit('data', Buffer.from(stderrText));
      cat.stdout.emit('close', 0);
    });
    return cat;
  });
}

//No BAT* entry (the readdirSync mock below returning an empty/battery-less directory) is
//UNAVAILABLE, not a spawn failure - checkBatteryMinutely reports that as 'N/A' without logging,
//since it is the everyday result on every machine that isn't a writerDeck.
test('checkBatteryMinutely reports N/A without logging when no battery is present', async function(t){
  t.mock.method(fs, 'readdirSync', function(){ return ['AC']; });
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  const { checkBatteryMinutely, endAutocheck } = freshBatteryMonitor();
  t.after(endAutocheck);

  const result = await new Promise(function(resolve){
    checkBatteryMinutely(resolve);
  });

  assert.strictEqual(result, 'N/A');
  assert.strictEqual(logErrorMock.mock.calls.length, 0, 'the ordinary "no battery" case must not spam the error log');
});

//Regression: the power_supply path itself can be missing (containers, restricted environments,
//non-Linux) - readdirSync throwing must resolve the same UNAVAILABLE path as "no BAT* entry",
//not crash checkBatteryMinutely's caller.
test('checkBatteryMinutely reports N/A instead of throwing when the power supply path is missing', async function(t){
  t.mock.method(fs, 'readdirSync', function(){
    const err = new Error('ENOENT: no such file or directory');
    err.code = 'ENOENT';
    throw err;
  });
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  const { checkBatteryMinutely, endAutocheck } = freshBatteryMonitor();
  t.after(endAutocheck);

  const result = await new Promise(function(resolve){
    checkBatteryMinutely(resolve);
  });

  assert.strictEqual(result, 'N/A');
  assert.strictEqual(logErrorMock.mock.calls.length, 0);
});

test('checkBatteryMinutely reports the initial percentage immediately', async function(t){
  t.mock.method(fs, 'readdirSync', function(){ return ['BAT0']; });
  mockSpawnWithChunks(t, ['42\n']);
  const { checkBatteryMinutely, endAutocheck } = freshBatteryMonitor();
  t.after(endAutocheck);

  const result = await new Promise(function(resolve){
    checkBatteryMinutely(resolve);
  });

  assert.strictEqual(result, '42');
});

//Regression: the old code called back on every stdout 'data' event instead of accumulating,
//so a value split across chunks (e.g. "8" then "7\n") could be reported as a partial "8".
test('checkBatteryMinutely assembles a value split across multiple stdout chunks', async function(t){
  t.mock.method(fs, 'readdirSync', function(){ return ['BAT0']; });
  mockSpawnWithChunks(t, ['8', '7', '\n']);
  const { checkBatteryMinutely, endAutocheck } = freshBatteryMonitor();
  t.after(endAutocheck);

  const result = await new Promise(function(resolve){
    checkBatteryMinutely(resolve);
  });

  assert.strictEqual(result, '87');
});

//Regression: spawn() emitting an unhandled 'error' event (missing binary, EMFILE, etc.) used to
//throw uncaught and crash the process. A battery that exists but cannot be read is a real
//failure (IO_ERROR), unlike "no battery at all" above, so it is reported as 'no data' *and* logged.
test('checkBatteryMinutely reports "no data" and logs when a battery exists but spawn fails', async function(t){
  t.mock.method(fs, 'readdirSync', function(){ return ['BAT0']; });
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  mockSpawnWithSpawnError(t, new Error('spawn cat ENOENT'));
  const { checkBatteryMinutely, endAutocheck } = freshBatteryMonitor();
  t.after(endAutocheck);

  const result = await new Promise(function(resolve){
    checkBatteryMinutely(resolve);
  });

  assert.strictEqual(result, 'no data');
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

test('checkBatteryMinutely reports "no data" and logs when the kernel read produces non-numeric output', async function(t){
  t.mock.method(fs, 'readdirSync', function(){ return ['BAT0']; });
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  mockSpawnWithStderr(t, 'cat: permission denied');
  const { checkBatteryMinutely, endAutocheck } = freshBatteryMonitor();
  t.after(endAutocheck);

  const result = await new Promise(function(resolve){
    checkBatteryMinutely(resolve);
  });

  assert.strictEqual(result, 'no data');
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

test('initiateAutocheck does not schedule a check when minutes is 0', function(t){
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { initiateAutocheck } = freshBatteryMonitor();
  let calls = 0;
  initiateAutocheck(0, function(){ calls++; });
  t.mock.timers.tick(60 * 60000);
  assert.strictEqual(calls, 0);
});

test('initiateAutocheck schedules a check on the given interval', function(t){
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { initiateAutocheck } = freshBatteryMonitor();
  let calls = 0;
  initiateAutocheck(1, function(){ calls++; });
  t.mock.timers.tick(60000);
  assert.strictEqual(calls, 1);
  t.mock.timers.tick(60000);
  assert.strictEqual(calls, 2);
});

//Regression: checkBatteryMinutely used to call initiateAutocheck directly, so calling it a
//second time (without an intervening endAutocheck()) silently orphaned the previous interval,
//which kept firing forever - the same interval-leak bug already fixed for autosave.
test('updateAutocheck replaces a previously running interval instead of stacking it', function(t){
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { initiateAutocheck, updateAutocheck } = freshBatteryMonitor();
  let calls = 0;
  initiateAutocheck(1, function(){ calls++; });
  updateAutocheck(5, function(){ calls++; });
  t.mock.timers.tick(60000);
  assert.strictEqual(calls, 0);
  t.mock.timers.tick(4 * 60000);
  assert.strictEqual(calls, 1);
});

test('endAutocheck stops further checks and allows a later restart', function(t){
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { initiateAutocheck, updateAutocheck, endAutocheck } = freshBatteryMonitor();
  let calls = 0;
  initiateAutocheck(1, function(){ calls++; });
  t.mock.timers.tick(60000);
  assert.strictEqual(calls, 1);

  endAutocheck();
  t.mock.timers.tick(5 * 60000);
  assert.strictEqual(calls, 1);

  updateAutocheck(1, function(){ calls++; });
  t.mock.timers.tick(60000);
  assert.strictEqual(calls, 2);
});
