const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const findReplaceDisplayPath = require.resolve('../src/components/views/findreplace_display');
const findReplaceControllerPath = require.resolve('../src/components/controllers/findreplace');

//findreplace_display.js destructures find/replace/replaceAllInChapter/replaceAllInAllChapters from
//the findreplace controller at require-time, so mocking them only takes effect if the cache is
//primed before findreplace_display.js is (re-)required - same pattern as corkboard_display.test.js's
//freshCorkboardDisplay().
function freshFindReplaceDisplay(mocks){
  delete require.cache[findReplaceDisplayPath];
  require.cache[findReplaceControllerPath] = {
    id: findReplaceControllerPath,
    filename: findReplaceControllerPath,
    loaded: true,
    exports: {
      find: mocks.find || function(){ return 0; },
      replace: mocks.replace || function(){},
      replaceAllInChapter: mocks.replaceAllInChapter || function(){ return 0; },
      replaceAllInAllChapters: mocks.replaceAllInAllChapters || function(){ return 0; }
    }
  };
  return require(findReplaceDisplayPath);
}

//enableSearchView()/closePopups() reach for this fixed set of app-shell elements by id - same
//shell used in exit-confirmation_display.test.js / corkboard_display.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

//Find/Replace/Replace All carry an access-key <span> in their innerHTML, and jsdom re-serializes
//attribute quoting (') to (") on the way back out, so comparing against the original markup string
//never matches - look these up by their accessKey attribute instead, same as file-manager_display.test.js.
function getButtonByAccessKey(key){
  return Array.from(document.querySelectorAll('button')).find(function(b){ return b.accessKey === key; });
}

//Minimal stand-in for the Quill instance findreplace_display.js talks to directly: getSelection()
//(to know what's currently selected) and getText() (to read the selected text back for the
//Replace-matches-Find check).
function makeEditorQuill(selectedText){
  return {
    _selectedText: selectedText,
    getSelection: function(){ return { index: 0, length: this._selectedText.length }; },
    getText: function(index, length){ return this._selectedText.slice(index, index + length); }
  };
}

function keyup(target, key){
  target.dispatchEvent(new window.KeyboardEvent('keyup', { key: key, bubbles: true, cancelable: true }));
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[findReplaceDisplayPath];
  delete require.cache[findReplaceControllerPath];
  delete global.window;
  delete global.document;
});

test('Case Sensitive checkbox is toggled by clicking its label', function(){
  var showFindReplace = freshFindReplaceDisplay({});
  showFindReplace({}, makeEditorQuill(''), function(){});

  var checkbox = document.getElementById('case-sensitive-check');
  var label = document.querySelector('label[for="case-sensitive-check"]');

  assert.strictEqual(label.innerText, 'Case Sensitive');
  assert.strictEqual(checkbox.checked, false);
  label.click();
  assert.strictEqual(checkbox.checked, true, 'clicking the label should toggle the checkbox, like Whole Word Only already does');
});

test('In All Chapters checkbox is toggled by clicking its label', function(){
  var showFindReplace = freshFindReplaceDisplay({});
  showFindReplace({}, makeEditorQuill(''), function(){});

  var checkbox = document.getElementById('in-all-chapters-check');
  var label = document.querySelector('label[for="in-all-chapters-check"]');

  assert.strictEqual(label.innerText, 'In All Chapters');
  assert.strictEqual(checkbox.checked, false);
  label.click();
  assert.strictEqual(checkbox.checked, true);
});

//Regression: Replace used to unconditionally replace whatever was currently selected in the
//editor, even if the user had clicked/selected something else in the (still-interactive) editor
//since the last Find. It must now only replace when the current selection still matches the
//search term.
test('Replace does nothing when the current selection no longer matches the search term', function(){
  var replaceCalls = 0;
  var findCalls = 0;
  var editorQuill = makeEditorQuill('dog');
  var showFindReplace = freshFindReplaceDisplay({
    replace: function(){ replaceCalls++; },
    find: function(){ findCalls++; return 0; }
  });

  showFindReplace({}, editorQuill, function(){});
  document.getElementById('find-input').value = 'cat';

  getButtonByAccessKey('r').onclick();

  assert.strictEqual(replaceCalls, 0, 'replace() must not run against a selection that is not the found match');
  assert.strictEqual(findCalls, 1, 'Replace should still fall through to a fresh Find');
});

test('Replace runs when the current selection matches the search term', function(){
  var replaceCalls = 0;
  var editorQuill = makeEditorQuill('cat');
  var showFindReplace = freshFindReplaceDisplay({
    replace: function(){ replaceCalls++; },
    find: function(){ return 0; }
  });

  showFindReplace({}, editorQuill, function(){});
  document.getElementById('find-input').value = 'cat';

  getButtonByAccessKey('r').onclick();

  assert.strictEqual(replaceCalls, 1);
});

test('Replace matching is case-insensitive when Case Sensitive is unchecked', function(){
  var replaceCalls = 0;
  var editorQuill = makeEditorQuill('CAT');
  var showFindReplace = freshFindReplaceDisplay({
    replace: function(){ replaceCalls++; },
    find: function(){ return 0; }
  });

  showFindReplace({}, editorQuill, function(){});
  document.getElementById('find-input').value = 'cat';

  getButtonByAccessKey('r').onclick();

  assert.strictEqual(replaceCalls, 1, 'a case-insensitive search should still allow the differently-cased match to be replaced');
});

test('Replace matching respects Case Sensitive when checked', function(){
  var replaceCalls = 0;
  var editorQuill = makeEditorQuill('CAT');
  var showFindReplace = freshFindReplaceDisplay({
    replace: function(){ replaceCalls++; },
    find: function(){ return 0; }
  });

  showFindReplace({}, editorQuill, function(){});
  document.getElementById('find-input').value = 'cat';
  document.getElementById('case-sensitive-check').click();

  getButtonByAccessKey('r').onclick();

  assert.strictEqual(replaceCalls, 0, 'with Case Sensitive on, a differently-cased selection must not be treated as a match');
});

test('pressing Enter in the Find field triggers a find', function(){
  var findCalls = 0;
  var showFindReplace = freshFindReplaceDisplay({
    find: function(){ findCalls++; return 0; }
  });

  showFindReplace({}, makeEditorQuill(''), function(){});
  document.getElementById('find-input').value = 'cat';
  keyup(document.getElementById('find-input'), 'Enter');

  assert.strictEqual(findCalls, 1);
});

test('pressing Enter in the Replace field triggers a replace', function(){
  var replaceCalls = 0;
  var editorQuill = makeEditorQuill('cat');
  var showFindReplace = freshFindReplaceDisplay({
    replace: function(){ replaceCalls++; },
    find: function(){ return 0; }
  });

  showFindReplace({}, editorQuill, function(){});
  document.getElementById('find-input').value = 'cat';
  document.getElementById('replace-input').value = 'dog';
  keyup(document.getElementById('replace-input'), 'Enter');

  assert.strictEqual(replaceCalls, 1);
});

test('displaying find/replace replaces any existing popup and focuses the Find field', function(){
  var stalePopup = document.createElement('div');
  stalePopup.classList.add('popup');
  document.body.appendChild(stalePopup);

  var showFindReplace = freshFindReplaceDisplay({});
  showFindReplace({}, makeEditorQuill(''), function(){});

  var popups = document.querySelectorAll('.popup');
  assert.strictEqual(popups.length, 1, 'the stale popup should be removed');
  assert.strictEqual(document.activeElement, document.getElementById('find-input'));
});
