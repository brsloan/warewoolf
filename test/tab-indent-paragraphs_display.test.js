const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const indentDisplayPath = require.resolve('../src/components/views/tab-indent-paragraphs_display');
const indentControllerPath = require.resolve('../src/components/controllers/tab-indent-paragraphs');
const workingDisplayPath = require.resolve('../src/components/views/working_display');

const { getDoNotIndentAfterDefs } = require('../src/components/controllers/tab-indent-paragraphs');

//tab-indent-paragraphs_display.js destructures tabIndentParasInAllChaps and showWorkingAndThen/
//hideWorking from their modules at require-time, so these mocks only take effect if the cache is
//primed with them before it is (re-)required - same pattern as convert-substitutions_display.js's
//freshSubstitutionsDisplay(). getDoNotIndentAfterDefs is mocked through as the real one, since the
//popup builds a checkbox per definition and the point of most of these tests is which boxes exist.
function freshIndentDisplay(mocks){
  delete require.cache[indentDisplayPath];
  require.cache[indentControllerPath] = { id: indentControllerPath, filename: indentControllerPath, loaded: true, exports: { tabIndentParasInAllChaps: mocks.tabIndentParasInAllChaps, getDoNotIndentAfterDefs: getDoNotIndentAfterDefs } };
  require.cache[workingDisplayPath] = { id: workingDisplayPath, filename: workingDisplayPath, loaded: true, exports: { showWorkingAndThen: mocks.showWorkingAndThen, hideWorking: mocks.hideWorking } };
  return require(indentDisplayPath);
}

//closePopups() (used by both the form submit and Cancel handlers) also calls disableSearchView()
//and focusEditor(), which reach for this fixed set of app-shell elements by id - same shell used in
//convert-substitutions_display.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

function noopMocks(overrides){
  return Object.assign({
    tabIndentParasInAllChaps: function(){},
    showWorkingAndThen: function(status, cb){ cb(); },
    hideWorking: function(){}
  }, overrides);
}

function submit(){
  document.querySelector('form').onsubmit({ preventDefault: function(){} });
}

function skipCheck(id){
  return document.getElementById('do-not-indent-after-' + id);
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[indentDisplayPath];
  delete require.cache[indentControllerPath];
  delete require.cache[workingDisplayPath];
  delete global.window;
  delete global.document;
});

test('the popup explains that it inserts manual tabs', function(){
  var showTabIndentParagraphs = freshIndentDisplay(noopMocks());

  showTabIndentParagraphs({ title: 'My Novel', chapters: [] }, function(){});

  //innerText is a plain property under JSDOM rather than something reflected into the markup, so
  //this reads it back off the paragraphs rather than searching the popup's HTML.
  var explanations = [...document.querySelectorAll('.popup p')].map(function(para){ return para.innerText; });
  assert.ok(explanations.some(function(text){ return /manual tab/.test(text); }),
    'expected the popup to say it inserts manual tabs: ' + explanations.join(' | '));
});

//Every other project-wide tool that rewrites chapter content carries this warning, and this one
//deletes lines as well as adding tabs.
test('the popup carries the same cannot-be-undone warning as Renumber Chapters', function(){
  var showTabIndentParagraphs = freshIndentDisplay(noopMocks());

  showTabIndentParagraphs({ title: 'My Novel', chapters: [] }, function(){});

  var warning = document.querySelector('.popup .warning-text');
  assert.ok(warning, 'expected a warning-text paragraph');
  assert.strictEqual(warning.innerText, 'WARNING: This action cannot be undone. Be sure to save first.');
});

test('every Do Not Indent After rule gets a checkbox, and they all start checked', function(){
  var showTabIndentParagraphs = freshIndentDisplay(noopMocks());

  showTabIndentParagraphs({ title: 'My Novel', chapters: [] }, function(){});

  getDoNotIndentAfterDefs().forEach(function(def){
    var check = skipCheck(def.id);
    assert.ok(check, 'expected a checkbox for ' + def.id);
    assert.strictEqual(check.checked, true, def.id + ' should start checked');
  });
});

test('the Do Not Indent After boxes are the five the tool offers, under that heading', function(){
  var showTabIndentParagraphs = freshIndentDisplay(noopMocks());

  showTabIndentParagraphs({ title: 'My Novel', chapters: [] }, function(){});

  assert.strictEqual(document.querySelector('fieldset legend').innerText, 'Do Not Indent After');
  assert.deepStrictEqual(
    getDoNotIndentAfterDefs().map(function(def){ return def.label; }),
    ['New Chapter', 'Headings', 'Blank Lines', 'Blockquotes', 'Lists']
  );
});

test('Correct Current Tabs starts checked and Remove Blank Lines starts unchecked', function(){
  var showTabIndentParagraphs = freshIndentDisplay(noopMocks());

  showTabIndentParagraphs({ title: 'My Novel', chapters: [] }, function(){});

  assert.strictEqual(document.getElementById('correct-current-tabs-check').checked, true);
  assert.strictEqual(document.getElementById('remove-blank-lines-check').checked, false);
});

test('the submit button is labelled Add Indents, beside a Cancel button', function(){
  var showTabIndentParagraphs = freshIndentDisplay(noopMocks());

  showTabIndentParagraphs({ title: 'My Novel', chapters: [] }, function(){});

  assert.strictEqual(document.querySelector('input[type="submit"]').value, 'Add Indents');
  assert.ok([...document.querySelectorAll('.popup button')].some(function(btn){ return btn.textContent == 'Cancel'; }),
    'expected a Cancel button');
});

test('Add Indents with everything at its defaults indents with every rule on', function(){
  var calls = [];
  var showTabIndentParagraphs = freshIndentDisplay(noopMocks({
    tabIndentParasInAllChaps: function(project, options){ calls.push(options); }
  }));

  showTabIndentParagraphs({ title: 'My Novel', chapters: [] }, function(){});
  submit();

  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0], {
    doNotIndentAfter: { newChapter: true, headings: true, blankLines: true, blockquotes: true, lists: true },
    correctCurrentTabs: true,
    removeBlankLinesBetweenParagraphs: false
  });
});

test('an unticked box is passed through as false', function(){
  var calls = [];
  var showTabIndentParagraphs = freshIndentDisplay(noopMocks({
    tabIndentParasInAllChaps: function(project, options){ calls.push(options); }
  }));

  showTabIndentParagraphs({ title: 'My Novel', chapters: [] }, function(){});
  skipCheck('blankLines').checked = false;
  document.getElementById('correct-current-tabs-check').checked = false;
  document.getElementById('remove-blank-lines-check').checked = true;
  submit();

  assert.strictEqual(calls[0].doNotIndentAfter.blankLines, false);
  assert.strictEqual(calls[0].doNotIndentAfter.headings, true);
  assert.strictEqual(calls[0].correctCurrentTabs, false);
  assert.strictEqual(calls[0].removeBlankLinesBetweenParagraphs, true);
});

//Indenting a whole project can be slow, so the popup hands off to the working indicator rather than
//freezing with no feedback - and onFinish, which redraws the open chapter, only runs once the pass
//has actually finished.
test('Add Indents shows the working indicator and redraws only when the pass is done', async function(){
  var order = [];
  var showTabIndentParagraphs = freshIndentDisplay({
    tabIndentParasInAllChaps: async function(){ order.push('indent'); },
    showWorkingAndThen: function(status, cb){ order.push('working: ' + status); return cb(); },
    hideWorking: function(){ order.push('hideWorking'); }
  });

  showTabIndentParagraphs({ title: 'My Novel', chapters: [] }, function(){ order.push('onFinish'); });
  await submit();

  assert.deepStrictEqual(order, ['working: Indenting paragraphs...', 'indent', 'hideWorking', 'onFinish']);
});

test('Add Indents closes the popup', function(){
  var showTabIndentParagraphs = freshIndentDisplay(noopMocks());

  showTabIndentParagraphs({ title: 'My Novel', chapters: [] }, function(){});
  submit();

  assert.strictEqual(document.querySelector('.popup'), null);
});

test('Cancel closes the popup without indenting anything', function(){
  var calls = [];
  var showTabIndentParagraphs = freshIndentDisplay(noopMocks({
    tabIndentParasInAllChaps: function(){ calls.push(true); }
  }));

  showTabIndentParagraphs({ title: 'My Novel', chapters: [] }, function(){});
  [...document.querySelectorAll('.popup button')].find(function(btn){ return btn.textContent == 'Cancel'; }).onclick();

  assert.strictEqual(document.querySelector('.popup'), null);
  assert.strictEqual(calls.length, 0);
});
