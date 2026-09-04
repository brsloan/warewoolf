const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const errorLog = require('../src/components/controllers/error-log');
const { setLogDirectory, logError, loadErrorLog, clearErrorLog } = errorLog;

function tempDir(){
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-error-log-'));
}

//logError writes via the async fs.appendFile, so give it a moment to land before asserting.
async function waitForLogToContain(logPath, text, timeoutMs){
  const start = Date.now();
  while(true){
    if(fs.existsSync(logPath) && fs.readFileSync(logPath, 'utf8').includes(text))
      return;
    if(Date.now() - start > (timeoutMs || 500))
      throw new Error('timed out waiting for log to contain: ' + text);
    await new Promise(function(r){ setTimeout(r, 20); });
  }
}

test.beforeEach(function(){
  setLogDirectory(tempDir());
});

test('logError writes a real Error\'s stack to the log file', async function(){
  const dir = tempDir();
  setLogDirectory(dir);

  logError(new Error('boom'));

  const logPath = path.join(dir, 'error_log.txt');
  await waitForLogToContain(logPath, 'Error: boom');
});

//Regression: logError used to read e.stack directly, so a bare string (e.g. raw stderr output)
//had no .stack and "undefined" was written to the log instead of the actual message.
test('logError with a bare string logs the string itself, not "undefined"', async function(){
  const dir = tempDir();
  setLogDirectory(dir);

  logError('cat: permission denied');

  const logPath = path.join(dir, 'error_log.txt');
  await waitForLogToContain(logPath, 'cat: permission denied');
  assert.ok(!fs.readFileSync(logPath, 'utf8').includes('undefined'));
});

test('logError with a plain object logs its contents, not "undefined"', async function(){
  const dir = tempDir();
  setLogDirectory(dir);

  logError({ code: 'ENOENT', message: 'no such file' });

  const logPath = path.join(dir, 'error_log.txt');
  await waitForLogToContain(logPath, 'ENOENT');
});

test('logError does not throw when given null or undefined', function(){
  assert.doesNotThrow(function(){ logError(null); });
  assert.doesNotThrow(function(){ logError(undefined); });
});

test('loadErrorLog returns an empty string when no log file exists yet', function(){
  assert.strictEqual(loadErrorLog(), '');
});

test('loadErrorLog returns what logError wrote', async function(){
  const dir = tempDir();
  setLogDirectory(dir);

  logError(new Error('read me back'));
  await waitForLogToContain(path.join(dir, 'error_log.txt'), 'read me back');

  assert.ok(loadErrorLog().includes('read me back'));
});

test('clearErrorLog empties an existing log file', async function(){
  const dir = tempDir();
  setLogDirectory(dir);
  const logPath = path.join(dir, 'error_log.txt');

  logError(new Error('will be cleared'));
  await waitForLogToContain(logPath, 'will be cleared');

  clearErrorLog();

  assert.strictEqual(fs.readFileSync(logPath, 'utf8'), '');
});

test('clearErrorLog on a missing log file does not throw', function(){
  assert.doesNotThrow(function(){ clearErrorLog(); });
});

//Regression: error_log.txt only ever grew via appendFile - nothing capped its size, so a
//long-lived install could accumulate an unbounded file. logError should truncate it once it
//crosses the size cap instead of appending forever.
test('logError truncates the log once it grows past the size cap', async function(){
  const dir = tempDir();
  setLogDirectory(dir);
  const logPath = path.join(dir, 'error_log.txt');

  fs.writeFileSync(logPath, 'x'.repeat(2 * 1024 * 1024));
  logError(new Error('fresh entry after rotation'));

  await waitForLogToContain(logPath, 'fresh entry after rotation');
  const written = fs.readFileSync(logPath, 'utf8');
  assert.ok(!written.includes('xxxx'));
  assert.ok(written.length < 2 * 1024 * 1024);
});

test('using different directories keeps their logs independent', async function(){
  const dirA = tempDir();
  const dirB = tempDir();

  setLogDirectory(dirA);
  logError(new Error('from A'));
  await waitForLogToContain(path.join(dirA, 'error_log.txt'), 'from A');

  setLogDirectory(dirB);
  logError(new Error('from B'));
  await waitForLogToContain(path.join(dirB, 'error_log.txt'), 'from B');

  assert.ok(!fs.readFileSync(path.join(dirA, 'error_log.txt'), 'utf8').includes('from B'));
});
