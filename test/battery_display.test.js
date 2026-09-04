const test = require('node:test');
const assert = require('node:assert');

const errorLog = require('../src/components/controllers/error-log');
const batteryMonitor = require('../src/components/controllers/battery-monitor');
const batteryDisplayPath = require.resolve('../src/components/views/battery_display');

//battery_display.js destructures checkBatteryMinutely/endAutocheck/logError from their modules
//at require-time (same pattern as battery-monitor.js), so mocking those modules' methods only
//takes effect if it happens before this re-require picks up a fresh module instance.
function freshBatteryDisplay(){
  delete require.cache[batteryDisplayPath];
  return require(batteryDisplayPath);
}

//The repo has no jsdom dependency, and battery_display.js only touches createElement,
//body.appendChild, getElementById, classList and .remove() - so a small hand-rolled stand-in
//is enough to exercise the real logic without pulling in a new dependency.
function makeFakeDocument(){
  var elementsById = {};

  function makeClassList(){
    var classes = new Set();
    return {
      add: function(cls){ classes.add(cls); },
      remove: function(cls){ classes.delete(cls); },
      contains: function(cls){ return classes.has(cls); }
    };
  }

  function makeElement(){
    var el = { _id: null, classList: makeClassList() };
    Object.defineProperty(el, 'id', {
      get: function(){ return el._id; },
      set: function(v){ el._id = v; elementsById[v] = el; }
    });
    el.appendChild = function(){};
    el.remove = function(){ if(el._id != null) delete elementsById[el._id]; };
    return el;
  }

  return {
    createElement: function(){ return makeElement(); },
    body: makeElement(),
    getElementById: function(id){ return elementsById[id] || null; }
  };
}

function mockCheckBatteryMinutely(t){
  var capturedCallback;
  t.mock.method(batteryMonitor, 'checkBatteryMinutely', function(callback){
    capturedCallback = callback;
  });
  return function trigger(value){ capturedCallback(value); };
}

test.beforeEach(function(){
  global.document = makeFakeDocument();
});

test.afterEach(function(){
  delete global.document;
});

test('showBattery renders the battery block with a placeholder before the first reading', function(t){
  t.mock.method(batteryMonitor, 'checkBatteryMinutely', function(){});
  const { showBattery } = freshBatteryDisplay();

  showBattery();

  const batteryText = document.getElementById('battery-text');
  assert.ok(document.getElementById('battery-block'), 'battery-block should be added to the document');
  assert.strictEqual(batteryText.innerText, '--%');
});

test('a numeric reading is shown with the lightning bolt and marks emergency under 10%', function(t){
  const trigger = mockCheckBatteryMinutely(t);
  const { showBattery } = freshBatteryDisplay();
  showBattery();

  trigger('42');
  assert.strictEqual(document.getElementById('battery-text').innerText, '⚡42%');
  assert.strictEqual(document.getElementById('battery-block').classList.contains('battery-emergency'), false);

  trigger('7');
  assert.strictEqual(document.getElementById('battery-text').innerText, '⚡7%');
  assert.strictEqual(document.getElementById('battery-block').classList.contains('battery-emergency'), true);

  trigger('50');
  assert.strictEqual(document.getElementById('battery-block').classList.contains('battery-emergency'), false);
});

//Regression: a non-numeric reading ('N/A' when no battery is found, 'no data' when the kernel
//read fails) used to be rendered as the nonsensical "⚡N/A%"/"⚡no data%".
test('a non-numeric reading is shown as-is instead of "⚡N/A%"', function(t){
  const trigger = mockCheckBatteryMinutely(t);
  const { showBattery } = freshBatteryDisplay();
  showBattery();

  trigger('N/A');

  assert.strictEqual(document.getElementById('battery-text').innerText, 'N/A');
  assert.strictEqual(document.getElementById('battery-block').classList.contains('battery-emergency'), false);
});

test('removeBattery stops the autocheck and removes the battery block', function(t){
  t.mock.method(batteryMonitor, 'checkBatteryMinutely', function(){});
  const endAutocheckMock = t.mock.method(batteryMonitor, 'endAutocheck', function(){});
  const { showBattery, removeBattery } = freshBatteryDisplay();
  showBattery();

  removeBattery();

  assert.strictEqual(endAutocheckMock.mock.calls.length, 1);
  assert.strictEqual(document.getElementById('battery-block'), null);
});

//Regression: removeBattery() called document.getElementById('battery-block').remove() directly,
//which threw "Cannot read properties of null (reading 'remove')" if the block was never created
//(e.g. userSettings.showBattery is true but showBattery() was never called for this session).
test('removeBattery does not throw when there is no battery block to remove', function(t){
  const endAutocheckMock = t.mock.method(batteryMonitor, 'endAutocheck', function(){});
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  const { removeBattery } = freshBatteryDisplay();

  assert.doesNotThrow(function(){ removeBattery(); });

  assert.strictEqual(endAutocheckMock.mock.calls.length, 1);
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});
