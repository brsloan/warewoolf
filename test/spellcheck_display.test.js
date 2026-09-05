const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const spellcheckDisplayPath = require.resolve('../src/components/views/spellcheck_display');
const spellcheckControllerPath = require.resolve('../src/components/controllers/spellcheck');
const findReplaceControllerPath = require.resolve('../src/components/controllers/findreplace');

//spellcheck_display.js destructures runSpellcheck/addWordToPersonalDictFile and replace/
//replaceAllInAllChapters from these controllers at require-time, so mocking them only takes effect
//if the cache is primed before spellcheck_display.js is (re-)required - same pattern as
//findreplace_display.test.js's freshFindReplaceDisplay().
function freshSpellcheckDisplay(mocks){
  delete require.cache[spellcheckDisplayPath];
  require.cache[spellcheckControllerPath] = {
    id: spellcheckControllerPath,
    filename: spellcheckControllerPath,
    loaded: true,
    exports: {
      runSpellcheck: mocks.runSpellcheck || function(){ return null; },
      addWordToPersonalDictFile: mocks.addWordToPersonalDictFile || function(){}
    }
  };
  require.cache[findReplaceControllerPath] = {
    id: findReplaceControllerPath,
    filename: findReplaceControllerPath,
    loaded: true,
    exports: {
      replace: mocks.replace || function(){},
      replaceAllInAllChapters: mocks.replaceAllInAllChapters || function(){ return 0; }
    }
  };
  return require(spellcheckDisplayPath);
}

//enableSearchView()/closePopups() reach for this fixed set of app-shell elements by id - same
//shell used in findreplace_display.test.js / corkboard_display.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

function makeEditorQuill(){
  return { setSelection: function(){} };
}

//Ignore/Change/Cancel carry no accessKey and no access-key <span>, so plain text lookup works;
//Ignore All/Change All/Add To Dictionary do carry one, so look those up by accessKey like
//findreplace_display.test.js's getButtonByAccessKey().
function getButtonByText(text){
  return Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent === text; });
}

function getButtonByAccessKey(key){
  return Array.from(document.querySelectorAll('button')).find(function(b){ return b.accessKey === key; });
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[spellcheckDisplayPath];
  delete require.cache[spellcheckControllerPath];
  delete require.cache[findReplaceControllerPath];
  delete global.window;
  delete global.document;
});

//Regression: Add To Dictionary unconditionally read invalidWord.word, unlike Ignore All/Change/
//Change All which all guard on invalidWord first. Once spellcheck finishes (invalidWord is null),
//the button stayed enabled and clicking it (or its Alt+A access key) threw a TypeError instead of
//being a no-op.
test('Add To Dictionary does nothing when spellcheck has already finished', function(){
  var addCalls = 0;
  var showSpellcheck = freshSpellcheckDisplay({
    runSpellcheck: function(){ return null; },
    addWordToPersonalDictFile: function(){ addCalls++; }
  });

  assert.doesNotThrow(function(){
    showSpellcheck(makeEditorQuill(), {}, {}, function(){});
    getButtonByAccessKey('a').click();
  });

  assert.strictEqual(addCalls, 0);
  assert.strictEqual(document.getElementsByClassName('popup').length, 1, 'the finished popup should stay open, not crash closed');
  assert.strictEqual(document.querySelector('h2').innerText, '*spellcheck finished*');
});

test('Add To Dictionary adds the current word and advances to the next one', function(){
  var addedWords = [];
  var callCount = 0;
  var showSpellcheck = freshSpellcheckDisplay({
    runSpellcheck: function(){
      callCount++;
      return callCount === 1 ? { word: 'zxqzxq', index: 5, suggestions: [] } : null;
    },
    addWordToPersonalDictFile: function(word){ addedWords.push(word); }
  });

  showSpellcheck(makeEditorQuill(), {}, {}, function(){});
  getButtonByAccessKey('a').click();

  assert.deepStrictEqual(addedWords, ['zxqzxq']);
  assert.strictEqual(callCount, 2, 'adding the word should re-run spellcheck from the next index');
  assert.strictEqual(document.querySelector('h2').innerText, '*spellcheck finished*');
});

//Regression: suggestion <label>s had no htmlFor/id pairing, so clicking the label text (rather
//than the tiny radio button itself) did nothing - unlike the Custom Replacement label right below
//it, which was already wired up correctly.
test('clicking a suggestion label selects its radio button', function(){
  var showSpellcheck = freshSpellcheckDisplay({
    runSpellcheck: function(){
      return { word: 'zxqzxq', index: 0, suggestions: ['cat', 'hat'] };
    }
  });

  showSpellcheck(makeEditorQuill(), {}, {}, function(){});

  var secondRadio = document.querySelectorAll('input[name="suggestions"]')[1];
  var secondLabel = document.querySelector('label[for="' + secondRadio.id + '"]');

  assert.strictEqual(secondLabel.innerText, '2: hat');
  assert.strictEqual(secondRadio.checked, false);
  secondLabel.click();
  assert.strictEqual(secondRadio.checked, true);
});

test('displaying spellcheck replaces any existing popup and selects the first suggestion', function(){
  var stalePopup = document.createElement('div');
  stalePopup.classList.add('popup');
  document.body.appendChild(stalePopup);

  var showSpellcheck = freshSpellcheckDisplay({
    runSpellcheck: function(){
      return { word: 'zxqzxq', index: 0, suggestions: ['cat', 'hat'] };
    }
  });

  showSpellcheck(makeEditorQuill(), {}, {}, function(){});

  var popups = document.querySelectorAll('.popup');
  assert.strictEqual(popups.length, 1, 'the stale popup should be removed');
  var firstRadio = document.querySelectorAll('input[name="suggestions"]')[0];
  assert.strictEqual(document.activeElement, firstRadio);
});
