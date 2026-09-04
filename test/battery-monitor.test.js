const test = require('node:test');
const assert = require('node:assert');
const child_process = require('child_process');
const fs = require('fs');
const { EventEmitter } = require('events');

const errorLog = require('../src/components/controllers/error-log');
const batteryMonitorPath = require.resolve('../src/components/controllers/battery-monitor');

//battery-monitor.js keeps its running interval id in module-level state (like autosave.js),
//so each test needs a fresh module instance to avoid one test's timer id leaking into the next.
//It also destructures `spawn` and `logError` from their modules at require-time, so any
//mocking of those must happen before this re-require for the fresh module to pick it up.
function freshBatteryMonitor(){
  delete require.cache[batteryMonitorPath];
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

test('getBatteryPercent resolves with N/A instead of hanging when no battery is found', function(t){
  const { getBatteryPercent } = freshBatteryMonitor();
  let result;
  getBatteryPercent(null, function(resp){ result = resp; });
  assert.strictEqual(result, 'N/A');
});

test('getBatteryPercent reads the capacity reported by the kernel', async function(t){
  mockSpawnWithChunks(t, ['87\n']);
  const { getBatteryPercent } = freshBatteryMonitor();

  const result = await new Promise(function(resolve){
    getBatteryPercent('BAT0', resolve);
  });

  assert.strictEqual(result, '87');
});

//Regression: the old code called back on every stdout 'data' event instead of accumulating,
//so a value split across chunks (e.g. "8" then "7\n") could be reported as a partial "8".
test('getBatteryPercent assembles a value split across multiple stdout chunks', async function(t){
  mockSpawnWithChunks(t, ['8', '7', '\n']);
  const { getBatteryPercent } = freshBatteryMonitor();

  const result = await new Promise(function(resolve){
    getBatteryPercent('BAT0', resolve);
  });

  assert.strictEqual(result, '87');
});

//Regression: spawn() emitting an unhandled 'error' event (missing binary, EMFILE, etc.)
//used to throw uncaught and crash the process.
test('getBatteryPercent reports "no data" instead of crashing when spawn fails', async function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  mockSpawnWithSpawnError(t, new Error('spawn cat ENOENT'));
  const { getBatteryPercent } = freshBatteryMonitor();

  const result = await new Promise(function(resolve){
    getBatteryPercent('BAT0', resolve);
  });

  assert.strictEqual(result, 'no data');
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

//Regression: stderr output used to be logged as a bare string, and error-log's logError()
//reads e.stack when writing to disk - a string has no .stack, so the real message was lost
//and "undefined" was written instead.
test('stderr output is logged as an Error so the real message is preserved', async function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  mockSpawnWithStderr(t, 'cat: permission denied');
  const { getBatteryPercent } = freshBatteryMonitor();

  await new Promise(function(resolve){
    getBatteryPercent('BAT0', resolve);
  });

  assert.strictEqual(logErrorMock.mock.calls.length, 1);
  const loggedArg = logErrorMock.mock.calls[0].arguments[0];
  assert.ok(loggedArg instanceof Error, 'logError should receive an Error, not a raw string');
  assert.strictEqual(loggedArg.message, 'cat: permission denied');
});

test('getBatteryName returns the first BAT* entry from the power supply class', function(t){
  t.mock.method(fs, 'readdirSync', function(){ return ['AC', 'BAT0', 'BAT1']; });
  const { getBatteryName } = freshBatteryMonitor();

  assert.strictEqual(getBatteryName(), 'BAT0');
});

test('getBatteryName returns null when no battery is present', function(t){
  t.mock.method(fs, 'readdirSync', function(){ return ['AC']; });
  const { getBatteryName } = freshBatteryMonitor();

  assert.strictEqual(getBatteryName(), null);
});

//Regression: /sys/class/power_supply can be missing (containers, restricted environments,
//non-Linux). readdirSync throwing was unhandled and crashed the caller synchronously.
test('getBatteryName returns null instead of throwing when the power supply path is missing', function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  t.mock.method(fs, 'readdirSync', function(){
    const err = new Error('ENOENT: no such file or directory');
    err.code = 'ENOENT';
    throw err;
  });
  const { getBatteryName } = freshBatteryMonitor();

  assert.strictEqual(getBatteryName(), null);
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
