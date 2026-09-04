const test = require('node:test');
const assert = require('node:assert');

const autosavePath = require.resolve('../src/components/controllers/autosave');

//autosave.js keeps its running interval id in module-level state, so each test
//needs a fresh module instance to avoid one test's timer id leaking into the next.
function freshAutosave(){
  delete require.cache[autosavePath];
  return require(autosavePath);
}

test('initiateAutosave does not schedule a save when minutes is 0', function(t){
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { initiateAutosave } = freshAutosave();
  let calls = 0;
  initiateAutosave(0, function(){ calls++; });
  t.mock.timers.tick(60 * 60000);
  assert.strictEqual(calls, 0);
});

test('initiateAutosave schedules save on the given interval', function(t){
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { initiateAutosave } = freshAutosave();
  let calls = 0;
  initiateAutosave(5, function(){ calls++; });
  t.mock.timers.tick(5 * 60000);
  assert.strictEqual(calls, 1);
  t.mock.timers.tick(5 * 60000);
  assert.strictEqual(calls, 2);
});

//Regression: calling initiateAutosave again while a timer is already running used to leak the old interval.
test('initiateAutosave replaces a previously running interval instead of stacking it', function(t){
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { initiateAutosave } = freshAutosave();
  let calls = 0;
  initiateAutosave(5, function(){ calls++; });
  initiateAutosave(10, function(){ calls++; });
  t.mock.timers.tick(5 * 60000);
  assert.strictEqual(calls, 0);
  t.mock.timers.tick(5 * 60000);
  assert.strictEqual(calls, 1);
});

test('updateAutosave restarts the timer on the new interval', function(t){
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { initiateAutosave, updateAutosave } = freshAutosave();
  let calls = 0;
  initiateAutosave(5, function(){ calls++; });
  t.mock.timers.tick(5 * 60000);
  assert.strictEqual(calls, 1);

  updateAutosave(10, function(){ calls++; });
  t.mock.timers.tick(5 * 60000);
  assert.strictEqual(calls, 1);
  t.mock.timers.tick(5 * 60000);
  assert.strictEqual(calls, 2);
});

//Regression: disabling autosave (minutes=0) left a stale interval id around instead of clearing it.
test('updateAutosave with 0 minutes stops further autosaves', function(t){
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { initiateAutosave, updateAutosave } = freshAutosave();
  let calls = 0;
  initiateAutosave(5, function(){ calls++; });
  t.mock.timers.tick(5 * 60000);
  assert.strictEqual(calls, 1);

  updateAutosave(0, function(){ calls++; });
  t.mock.timers.tick(60 * 60000);
  assert.strictEqual(calls, 1);
});
