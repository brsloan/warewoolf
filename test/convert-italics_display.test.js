const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const italicsDisplayPath = require.resolve('../src/components/views/convert-italics_display');
const italicsControllerPath = require.resolve('../src/components/controllers/convert-italics');
const workingDisplayPath = require.resolve('../src/components/views/working_display');

//convert-italics_display.js destructures convertMarkedItalicsForAllChapters and
//showWorkingAndThen/hideWorking from their modules at require-time, so these mocks only take
//effect if the cache is primed with them before convert-italics_display.js is (re-)required -
//same pattern as compile_display.test.js's freshCompileDisplay().
function freshItalicsDisplay(mocks){
  delete require.cache[italicsDisplayPath];
  require.cache[italicsControllerPath] = { id: italicsControllerPath, filename: italicsControllerPath, loaded: true, exports: { convertMarkedItalicsForAllChapters: mocks.convertMarkedItalicsForAllChapters } };
  require.cache[workingDisplayPath] = { id: workingDisplayPath, filename: workingDisplayPath, loaded: true, exports: { showWorkingAndThen: mocks.showWorkingAndThen, hideWorking: mocks.hideWorking } };
  return require(italicsDisplayPath);
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
  delete require.cache[italicsDisplayPath];
  delete require.cache[italicsControllerPath];
  delete require.cache[workingDisplayPath];
  delete global.window;
  delete global.document;
});

//Regression: the conversion used to run synchronously on submit with no working indicator, so a
//project with many/large chapters would freeze the UI with the popup stuck on screen and no
//feedback. The working indicator must show before the conversion runs, and must not be hidden
//(nor onFinish called) until the conversion actually completes.
test('submitting the form shows a working indicator and only converts/finishes once it resolves', function(t){
  var project = { title: 'My Novel', chapters: [] };

  var convertCalls = [];
  var convertMarkedItalicsForAllChapters = function(project, marker){
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
  var showItalicsOptions = freshItalicsDisplay({
    convertMarkedItalicsForAllChapters: convertMarkedItalicsForAllChapters,
    showWorkingAndThen: showWorkingAndThen,
    hideWorking: hideWorking
  });

  showItalicsOptions(project, function(){ onFinishCalls++; });

  var input = document.getElementById('italics-str-input');
  input.value = '**';
  document.querySelector('form').onsubmit({ preventDefault: function(){} });

  assert.strictEqual(showWorkingCalls, 1, 'the working indicator should show before converting');
  assert.strictEqual(convertCalls.length, 0, 'conversion must not run until the working indicator has had a chance to paint');
  assert.strictEqual(document.querySelector('.popup'), null, 'the options popup should close immediately on submit');

  capturedWorkingCallback();

  assert.strictEqual(convertCalls.length, 1);
  assert.strictEqual(convertCalls[0].project, project);
  assert.strictEqual(convertCalls[0].marker, '**');
  assert.strictEqual(hideWorkingCalls, 1, 'hideWorking should run once the conversion completes');
  assert.strictEqual(onFinishCalls, 1, 'onFinish should run once the conversion completes');
});

//Regression: an all-whitespace marker passed the input's `required` check (required only rejects
//a fully empty value) and silently reached the converter as a no-op. Submitting with nothing but
//whitespace should be treated like an empty marker and not close the popup or attempt to convert.
test('submitting with a whitespace-only marker does not close the popup or convert', function(t){
  var convertCalls = [];
  var showItalicsOptions = freshItalicsDisplay({
    convertMarkedItalicsForAllChapters: function(){ convertCalls.push(true); },
    showWorkingAndThen: function(status, cb){ cb(); },
    hideWorking: function(){}
  });

  var onFinishCalls = 0;
  showItalicsOptions({ title: 'My Novel', chapters: [] }, function(){ onFinishCalls++; });

  var input = document.getElementById('italics-str-input');
  input.value = '   ';
  document.querySelector('form').onsubmit({ preventDefault: function(){} });

  assert.strictEqual(convertCalls.length, 0);
  assert.strictEqual(onFinishCalls, 0);
  assert.ok(document.querySelector('.popup'), 'popup should stay open for a whitespace-only marker');
});

test('the Cancel button closes the popup without converting', function(t){
  var convertCalls = [];
  var showItalicsOptions = freshItalicsDisplay({
    convertMarkedItalicsForAllChapters: function(){ convertCalls.push(true); },
    showWorkingAndThen: function(status, cb){ cb(); },
    hideWorking: function(){}
  });

  showItalicsOptions({ title: 'My Novel', chapters: [] }, function(){});

  var cancelBtn = Array.from(document.querySelectorAll('button')).find(function(b){ return b.innerHTML === 'Cancel'; });
  assert.ok(cancelBtn, 'expected to find the Cancel button');

  cancelBtn.onclick();

  assert.strictEqual(convertCalls.length, 0);
  assert.strictEqual(document.querySelector('.popup'), null);
});
