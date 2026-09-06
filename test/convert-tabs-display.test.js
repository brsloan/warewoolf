const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const tabsDisplayPath = require.resolve('../src/components/views/convert-tabs-display');
const tabsControllerPath = require.resolve('../src/components/controllers/convert-tabs');
const workingDisplayPath = require.resolve('../src/components/views/working_display');

//convert-tabs-display.js destructures convertMarkedTabsForAllChapters and
//showWorkingAndThen/hideWorking from their modules at require-time, so these mocks only take
//effect if the cache is primed with them before convert-tabs-display.js is (re-)required -
//same pattern as convert-italics_display.test.js's freshItalicsDisplay().
function freshTabsDisplay(mocks){
  delete require.cache[tabsDisplayPath];
  require.cache[tabsControllerPath] = { id: tabsControllerPath, filename: tabsControllerPath, loaded: true, exports: { convertMarkedTabsForAllChapters: mocks.convertMarkedTabsForAllChapters } };
  require.cache[workingDisplayPath] = { id: workingDisplayPath, filename: workingDisplayPath, loaded: true, exports: { showWorkingAndThen: mocks.showWorkingAndThen, hideWorking: mocks.hideWorking } };
  return require(tabsDisplayPath);
}

//closePopups() (used by both the form submit and Cancel handlers) also calls disableSearchView()
//and focusEditor(), which reach for this fixed set of app-shell elements by id - same shell used
//in utils.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[tabsDisplayPath];
  delete require.cache[tabsControllerPath];
  delete require.cache[workingDisplayPath];
  delete global.window;
  delete global.document;
});

//Regression: the conversion used to run synchronously on submit with no working indicator, so a
//project with many/large chapters would freeze the UI with the popup stuck on screen and no
//feedback. The working indicator must show before the conversion runs, and must not be hidden
//(nor onFinish called) until the conversion actually completes.
test('submitting the form shows a working indicator and only converts/finishes once it resolves', async function(t){
  var project = { title: 'My Novel', chapters: [] };

  var convertCalls = [];
  var convertMarkedTabsForAllChapters = function(project, marker){
    convertCalls.push({ project, marker });
  };

  var showWorkingCalls = 0;
  var hideWorkingCalls = 0;
  var capturedWorkingCallback = null;
  var showWorkingAndThen = function(status, cb){
    showWorkingCalls++;
    capturedWorkingCallback = cb;
  };
  var hideWorking = function(){ hideWorkingCalls++; };

  var onFinishCalls = 0;
  var showTabOptions = freshTabsDisplay({
    convertMarkedTabsForAllChapters: convertMarkedTabsForAllChapters,
    showWorkingAndThen: showWorkingAndThen,
    hideWorking: hideWorking
  });

  showTabOptions(project, function(){ onFinishCalls++; });

  var input = document.getElementById('tab-str-input');
  input.value = '  ';
  document.querySelector('form').onsubmit({ preventDefault: function(){} });

  assert.strictEqual(showWorkingCalls, 1, 'the working indicator should show before converting');
  assert.strictEqual(convertCalls.length, 0, 'conversion must not run until the working indicator has had a chance to paint');
  assert.strictEqual(document.querySelector('.popup'), null, 'the options popup should close immediately on submit');

  //Awaited: converting reads chapters through the platform facade now, so the deferred callback is
  //async and hideWorking/onFinish run after it settles.
  await capturedWorkingCallback();

  assert.strictEqual(convertCalls.length, 1);
  assert.strictEqual(convertCalls[0].project, project);
  assert.strictEqual(convertCalls[0].marker, '  ');
  assert.strictEqual(hideWorkingCalls, 1, 'hideWorking should run once the conversion completes');
  assert.strictEqual(onFinishCalls, 1, 'onFinish should run once the conversion completes');
});

//The marker string itself is whitespace by default (4 spaces), unlike convert-italics_display's
//delimiter character, so the captured value must be passed through untrimmed.
test('the default 4-space marker is passed through untrimmed', function(t){
  var convertCalls = [];
  var showTabOptions = freshTabsDisplay({
    convertMarkedTabsForAllChapters: function(project, marker){ convertCalls.push(marker); },
    showWorkingAndThen: function(status, cb){ cb(); },
    hideWorking: function(){}
  });

  showTabOptions({ title: 'My Novel', chapters: [] }, function(){});

  document.querySelector('form').onsubmit({ preventDefault: function(){} });

  assert.strictEqual(convertCalls.length, 1);
  assert.strictEqual(convertCalls[0], '    ');
});

test('the Cancel button closes the popup without converting', function(t){
  var convertCalls = [];
  var showTabOptions = freshTabsDisplay({
    convertMarkedTabsForAllChapters: function(){ convertCalls.push(true); },
    showWorkingAndThen: function(status, cb){ cb(); },
    hideWorking: function(){}
  });

  showTabOptions({ title: 'My Novel', chapters: [] }, function(){});

  var cancelBtn = Array.from(document.querySelectorAll('button')).find(function(b){ return b.innerHTML === 'Cancel'; });
  assert.ok(cancelBtn, 'expected to find the Cancel button');

  cancelBtn.onclick();

  assert.strictEqual(convertCalls.length, 0);
  assert.strictEqual(document.querySelector('.popup'), null);
});
