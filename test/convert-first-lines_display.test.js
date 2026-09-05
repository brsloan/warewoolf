const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const convertFirstLinesDisplayPath = require.resolve('../src/components/views/convert-first-lines_display');
const convertFirstLinesControllerPath = require.resolve('../src/components/controllers/convert-first-lines');

//convert-first-lines_display.js destructures convertFirstLinesToTitles from the controller at
//require-time, so mocking it only takes effect if the cache is primed before
//convert-first-lines_display.js is (re-)required - same pattern as renumber-chapters_display.test.js.
function freshConvertFirstLinesDisplay(mocks){
  delete require.cache[convertFirstLinesDisplayPath];
  require.cache[convertFirstLinesControllerPath] = {
    id: convertFirstLinesControllerPath,
    filename: convertFirstLinesControllerPath,
    loaded: true,
    exports: {
      convertFirstLinesToTitles: mocks.convertFirstLinesToTitles
    }
  };
  return require(convertFirstLinesDisplayPath);
}

//closePopups() also calls disableSearchView()/focusEditor(), which reach for this fixed shell by
//id - same shell used in renumber-chapters_display.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

function getConvertBtn(){
  return Array.from(document.querySelectorAll('button')).find(function(b){ return b.innerHTML === 'Convert'; });
}

function getCloseBtn(){
  return Array.from(document.querySelectorAll('button')).find(function(b){ return b.innerHTML === 'Close'; });
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[convertFirstLinesDisplayPath];
  delete require.cache[convertFirstLinesControllerPath];
  delete global.window;
  delete global.document;
});

test('renders a warning and focuses the Convert button', function(t){
  var showConvertFirstLines = freshConvertFirstLinesDisplay({ convertFirstLinesToTitles: function(){} });

  showConvertFirstLines({ chapters: [] }, function(){});

  assert.strictEqual(document.querySelector('.popup h1').innerText, 'Convert First Lines To Titles');
  assert.match(document.querySelector('.warning-text').innerText, /cannot be undone/);
  assert.strictEqual(document.activeElement, getConvertBtn());
});

test('clicking Convert converts the project, closes the popup, and calls the callback', function(t){
  var convertCalls = [];
  var project = { chapters: [] };
  var showConvertFirstLines = freshConvertFirstLinesDisplay({
    convertFirstLinesToTitles: function(p){ convertCalls.push(p); }
  });

  var cbackCalls = 0;
  showConvertFirstLines(project, function(){ cbackCalls++; });

  getConvertBtn().onclick();

  assert.strictEqual(convertCalls.length, 1);
  assert.strictEqual(convertCalls[0], project);
  assert.strictEqual(document.getElementsByClassName('popup').length, 0);
  assert.strictEqual(cbackCalls, 1);
});

test('clicking Close does not convert and just closes the popup', function(t){
  var convertCalls = [];
  var showConvertFirstLines = freshConvertFirstLinesDisplay({
    convertFirstLinesToTitles: function(){ convertCalls.push(true); }
  });

  var cbackCalls = 0;
  showConvertFirstLines({ chapters: [] }, function(){ cbackCalls++; });

  getCloseBtn().onclick();

  assert.strictEqual(convertCalls.length, 0);
  assert.strictEqual(cbackCalls, 0);
  assert.strictEqual(document.getElementsByClassName('popup').length, 0);
});
