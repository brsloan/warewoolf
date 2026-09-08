const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const substitutionsDisplayPath = require.resolve('../src/components/views/convert-substitutions_display');
const substitutionsControllerPath = require.resolve('../src/components/controllers/convert-substitutions');
const workingDisplayPath = require.resolve('../src/components/views/working_display');

const { getAutocorrectDefs, getDefaultRules } = require('../src/components/models/autocorrect');

//convert-substitutions_display.js destructures convertSubstitutionsForAllChapters and
//showWorkingAndThen/hideWorking from their modules at require-time, so these mocks only take effect
//if the cache is primed with them before it is (re-)required - same pattern as
//convert-tabs-display.test.js's freshTabsDisplay().
function freshSubstitutionsDisplay(mocks){
  delete require.cache[substitutionsDisplayPath];
  require.cache[substitutionsControllerPath] = { id: substitutionsControllerPath, filename: substitutionsControllerPath, loaded: true, exports: { convertSubstitutionsForAllChapters: mocks.convertSubstitutionsForAllChapters } };
  require.cache[workingDisplayPath] = { id: workingDisplayPath, filename: workingDisplayPath, loaded: true, exports: { showWorkingAndThen: mocks.showWorkingAndThen, hideWorking: mocks.hideWorking } };
  return require(substitutionsDisplayPath);
}

//closePopups() (used by both the form submit and Cancel handlers) also calls disableSearchView()
//and focusEditor(), which reach for this fixed set of app-shell elements by id - same shell used in
//convert-tabs-display.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

function noopMocks(overrides){
  return Object.assign({
    convertSubstitutionsForAllChapters: function(){},
    showWorkingAndThen: function(status, cb){ cb(); },
    hideWorking: function(){}
  }, overrides);
}

function submit(){
  document.querySelector('form').onsubmit({ preventDefault: function(){} });
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[substitutionsDisplayPath];
  delete require.cache[substitutionsControllerPath];
  delete require.cache[workingDisplayPath];
  delete global.window;
  delete global.document;
});

test('every substitution gets a checkbox, and they all start checked', function(t){
  var showSubstitutionOptions = freshSubstitutionsDisplay(noopMocks());

  showSubstitutionOptions({ title: 'My Novel', chapters: [] }, function(){});

  getAutocorrectDefs().forEach(function(def){
    var check = document.getElementById('convert-' + def.id);
    assert.ok(check, 'expected a checkbox for ' + def.id);
    assert.strictEqual(check.checked, true, def.id + ' should start checked');
  });
});

//The Settings switches say what should happen to the next character typed. This is a one-off pass
//over work already written, so someone who never wanted smart quotes as they type may still want
//them here - which is why the popup does not read those settings at all.
test('the boxes start checked whatever the writer has switched off in Settings', function(t){
  var showSubstitutionOptions = freshSubstitutionsDisplay(noopMocks());

  showSubstitutionOptions({ title: 'My Novel', chapters: [], autocorrectEnabled: false, autocorrect: { emDash: false } }, function(){});

  assert.strictEqual(document.getElementById('convert-emDash').checked, true);
});

test('submitting with everything checked converts with every rule on', function(t){
  var convertCalls = [];
  var showSubstitutionOptions = freshSubstitutionsDisplay(noopMocks({
    convertSubstitutionsForAllChapters: function(project, rules){ convertCalls.push(rules); }
  }));

  showSubstitutionOptions({ title: 'My Novel', chapters: [] }, function(){});
  submit();

  assert.strictEqual(convertCalls.length, 1);
  assert.deepStrictEqual(convertCalls[0], getDefaultRules());
});

test('an unchecked box is passed through as off, leaving the rest on', function(t){
  var convertCalls = [];
  var showSubstitutionOptions = freshSubstitutionsDisplay(noopMocks({
    convertSubstitutionsForAllChapters: function(project, rules){ convertCalls.push(rules); }
  }));

  showSubstitutionOptions({ title: 'My Novel', chapters: [] }, function(){});
  document.getElementById('convert-emDash').checked = false;
  submit();

  assert.strictEqual(convertCalls[0].emDash, false);
  assert.strictEqual(convertCalls[0].smartDoubleQuotes, true);
  assert.strictEqual(convertCalls[0].ellipsis, true);
});

//Same reasoning as convert-tabs-display.js: converting reads every chapter off disk, so the
//working indicator has to show before any of it runs, and nothing may finish until it resolves.
test('submitting shows a working indicator and only converts/finishes once it resolves', async function(t){
  var project = { title: 'My Novel', chapters: [] };

  var convertCalls = [];
  var showWorkingCalls = 0;
  var hideWorkingCalls = 0;
  var capturedWorkingCallback = null;

  var showSubstitutionOptions = freshSubstitutionsDisplay({
    convertSubstitutionsForAllChapters: function(project, rules){ convertCalls.push({ project, rules }); },
    showWorkingAndThen: function(status, cb){ showWorkingCalls++; capturedWorkingCallback = cb; },
    hideWorking: function(){ hideWorkingCalls++; }
  });

  var onFinishCalls = 0;
  showSubstitutionOptions(project, function(){ onFinishCalls++; });
  submit();

  assert.strictEqual(showWorkingCalls, 1, 'the working indicator should show before converting');
  assert.strictEqual(convertCalls.length, 0, 'conversion must not run until the working indicator has had a chance to paint');
  assert.strictEqual(document.querySelector('.popup'), null, 'the options popup should close immediately on submit');

  await capturedWorkingCallback();

  assert.strictEqual(convertCalls.length, 1);
  assert.strictEqual(convertCalls[0].project, project);
  assert.strictEqual(hideWorkingCalls, 1, 'hideWorking should run once the conversion completes');
  assert.strictEqual(onFinishCalls, 1, 'onFinish should run once the conversion completes');
});

test('the popup warns that the conversion cannot be undone', function(t){
  var showSubstitutionOptions = freshSubstitutionsDisplay(noopMocks());

  showSubstitutionOptions({ title: 'My Novel', chapters: [] }, function(){});

  assert.ok(document.querySelector('.warning-text'), 'expected the cannot-be-undone warning');
});

test('the Cancel button closes the popup without converting', function(t){
  var convertCalls = [];
  var showSubstitutionOptions = freshSubstitutionsDisplay(noopMocks({
    convertSubstitutionsForAllChapters: function(){ convertCalls.push(true); }
  }));

  showSubstitutionOptions({ title: 'My Novel', chapters: [] }, function(){});

  var cancelBtn = Array.from(document.querySelectorAll('button')).find(function(b){ return b.innerHTML === 'Cancel'; });
  assert.ok(cancelBtn, 'expected to find the Cancel button');

  cancelBtn.onclick();

  assert.strictEqual(convertCalls.length, 0);
  assert.strictEqual(document.querySelector('.popup'), null);
});
