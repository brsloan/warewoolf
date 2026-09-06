const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const errorLog = require('../src/components/controllers/error-log');
const { setPlatform, logError, loadErrorLog, clearErrorLog } = errorLog;
const { createPlatform } = require('../src/components/controllers/platform');
const { createNodeBacking } = require('../src/components/controllers/platform-node');

function tempDir(){
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-error-log-'));
}

//Points error-log.js at a fresh node-backed platform instance, replacing the old
//setLogDirectory(dir) - the same conversion every other test file that touches error-log.js went
//through. logError still returns the (always-resolving) promise platform.logError() produces, so
//tests can await a specific call instead of polling the log file for it to land.
function configureErrorLog(dir){
  setPlatform(createPlatform(createNodeBacking({ paths: { userData: dir } })));
  return dir;
}

test.beforeEach(function(){
  configureErrorLog(tempDir());
});

test('logError writes a real Error\'s stack to the log file', async function(){
  const dir = configureErrorLog(tempDir());

  await logError(new Error('boom'));

  const logPath = path.join(dir, 'error_log.txt');
  assert.ok(fs.readFileSync(logPath, 'utf8').includes('Error: boom'));
});

//Regression: logError used to read e.stack directly, so a bare string (e.g. raw stderr output)
//had no .stack and "undefined" was written to the log instead of the actual message.
test('logError with a bare string logs the string itself, not "undefined"', async function(){
  const dir = configureErrorLog(tempDir());

  await logError('cat: permission denied');

  const logPath = path.join(dir, 'error_log.txt');
  const written = fs.readFileSync(logPath, 'utf8');
  assert.ok(written.includes('cat: permission denied'));
  assert.ok(!written.includes('undefined'));
});

test('logError with a plain object logs its contents, not "undefined"', async function(){
  const dir = configureErrorLog(tempDir());

  await logError({ code: 'ENOENT', message: 'no such file' });

  const logPath = path.join(dir, 'error_log.txt');
  assert.ok(fs.readFileSync(logPath, 'utf8').includes('ENOENT'));
});

test('logError does not throw when given null or undefined', function(){
  assert.doesNotThrow(function(){ logError(null); });
  assert.doesNotThrow(function(){ logError(undefined); });
});

test('loadErrorLog returns an empty string when no log file exists yet', async function(){
  assert.strictEqual(await loadErrorLog(), '');
});

test('loadErrorLog returns what logError wrote', async function(){
  const dir = configureErrorLog(tempDir());

  await logError(new Error('read me back'));

  assert.ok((await loadErrorLog()).includes('read me back'));
});

test('clearErrorLog empties an existing log file', async function(){
  const dir = configureErrorLog(tempDir());
  const logPath = path.join(dir, 'error_log.txt');

  await logError(new Error('will be cleared'));
  await clearErrorLog();

  assert.strictEqual(fs.readFileSync(logPath, 'utf8'), '');
});

test('clearErrorLog on a missing log file does not throw', async function(){
  await assert.doesNotReject(clearErrorLog());
});

//Regression: error_log.txt only ever grew via appendFile - nothing capped its size, so a
//long-lived install could accumulate an unbounded file. logError should truncate it once it
//crosses the size cap instead of appending forever.
test('logError truncates the log once it grows past the size cap', async function(){
  const dir = configureErrorLog(tempDir());
  const logPath = path.join(dir, 'error_log.txt');

  fs.writeFileSync(logPath, 'x'.repeat(2 * 1024 * 1024));
  await logError(new Error('fresh entry after rotation'));

  const written = fs.readFileSync(logPath, 'utf8');
  assert.ok(written.includes('fresh entry after rotation'));
  assert.ok(!written.includes('xxxx'));
  assert.ok(written.length < 2 * 1024 * 1024);
});

test('using different directories keeps their logs independent', async function(){
  const dirA = configureErrorLog(tempDir());
  await logError(new Error('from A'));

  const dirB = configureErrorLog(tempDir());
  await logError(new Error('from B'));

  assert.ok(!fs.readFileSync(path.join(dirA, 'error_log.txt'), 'utf8').includes('from B'));
});

test('logError is fire-and-forget: nothing is configured, and it does not throw or reject', async function(){
  setPlatform(null);

  assert.doesNotThrow(function(){ logError(new Error('nowhere to log this')); });
  await assert.doesNotReject(logError(new Error('nowhere to log this')));
  assert.strictEqual(await loadErrorLog(), '');
  await assert.doesNotReject(clearErrorLog());
});
