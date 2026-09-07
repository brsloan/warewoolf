require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const errorLog = require('../src/components/controllers/error-log');
const { createPlatform } = require('../src/components/controllers/platform');
const { createNodeBacking } = require('../src/components/controllers/platform-node');
const utilsPath = require.resolve('../src/components/controllers/utils');
const {
  closePopups,
  closePopupDialogs,
  removeElementsByClass,
  convertFilepath,
  createButton,
  generateRow,
  removeOptions,
  enableSearchView,
  disableSearchView,
  sanitizeFilename,
  sanitizeFilenameWithExt
} = require(utilsPath);

//utils.js destructures `logError` from error-log.js at require-time, so any test that mocks it
//must re-require this module afterward for the fresh destructure to see the mock - same reasoning
//as updates.test.js/battery-monitor.test.js.
function freshUtils(){
  delete require.cache[utilsPath];
  return require(utilsPath);
}

//Keep any incidental real logError call out of the repo's cwd instead of the default bare
//"error_log.txt".
test.before(function(){
  errorLog.setPlatform(createPlatform(createNodeBacking({
    paths: { userData: fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-utils-')) }
  })));
});

function buildEditorFixture(){
  document.body.innerHTML =
    '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
  return document.querySelector('#editor-container .ql-editor');
}

//---------------------------------------------------------------------------
// convertFilepath
//---------------------------------------------------------------------------

test('convertFilepath converts backslashes to forward slashes', function(){
  assert.strictEqual(convertFilepath('C:\\Users\\test\\file.txt'), 'C:/Users/test/file.txt');
});

test('convertFilepath leaves an already-forward-slash path unchanged', function(){
  assert.strictEqual(convertFilepath('/home/user/file.txt'), '/home/user/file.txt');
});

test('convertFilepath regression: falls back to the original value and logs instead of returning undefined', function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  const { convertFilepath: freshConvertFilepath } = freshUtils();

  const result = freshConvertFilepath(null);

  assert.strictEqual(result, null);
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

//---------------------------------------------------------------------------
// sanitizeFilename
//---------------------------------------------------------------------------

test('sanitizeFilename strips illegal filesystem characters', function(){
  assert.strictEqual(sanitizeFilename('a/b?c<d>e\\f:g*h|i"j'), 'abcdefghij');
});

test('sanitizeFilename strips control characters', function(){
  assert.strictEqual(sanitizeFilename('foo\x01bar\x1fbaz'), 'foobarbaz');
});

test('sanitizeFilename strips a name consisting only of dots', function(){
  assert.strictEqual(sanitizeFilename('...'), '');
});

test('sanitizeFilename strips Windows reserved device names case-insensitively', function(){
  assert.strictEqual(sanitizeFilename('con'), '');
  assert.strictEqual(sanitizeFilename('COM1'), '');
  assert.strictEqual(sanitizeFilename('lpt9'), '');
});

test('sanitizeFilename leaves a name that merely contains a reserved word as a substring alone', function(){
  assert.strictEqual(sanitizeFilename('console'), 'console');
  assert.strictEqual(sanitizeFilename('constitution'), 'constitution');
});

test('sanitizeFilename truncates names longer than 100 characters', function(){
  const result = sanitizeFilename('a'.repeat(150));
  assert.strictEqual(result.length, 100);
});

test('sanitizeFilename regression: falls back to the original value and logs instead of throwing on invalid input', function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  const { sanitizeFilename: freshSanitizeFilename } = freshUtils();

  const result = freshSanitizeFilename(null);

  assert.strictEqual(result, null);
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

//---------------------------------------------------------------------------
// sanitizeFilenameWithExt
//---------------------------------------------------------------------------

test('sanitizeFilenameWithExt regression: keeps dots that belong to the base filename', function(){
  assert.strictEqual(sanitizeFilenameWithExt('notes.v2.txt'), 'notes.v2.txt');
});

test('sanitizeFilenameWithExt regression: does not add a stray leading dot when there is no extension', function(){
  assert.strictEqual(sanitizeFilenameWithExt('myfile'), 'myfile');
});

test('sanitizeFilenameWithExt sanitizes the base name while preserving the extension', function(){
  assert.strictEqual(sanitizeFilenameWithExt('my<>file.txt'), 'myfile.txt');
});

test('sanitizeFilenameWithExt regression: falls back to the original value and logs instead of throwing on invalid input', function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  const { sanitizeFilenameWithExt: freshSanitizeFilenameWithExt } = freshUtils();

  const result = freshSanitizeFilenameWithExt(null);

  assert.strictEqual(result, null);
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

//---------------------------------------------------------------------------
// createButton / generateRow
//---------------------------------------------------------------------------

test('createButton creates a button element with the given text and type', function(){
  const btn = createButton('Click me');
  assert.strictEqual(btn.tagName, 'BUTTON');
  assert.strictEqual(btn.textContent, 'Click me');
  assert.strictEqual(btn.type, 'button');
});

test('createButton sets plain text as a real text node rather than parsing it as markup', function(){
  const btn = createButton('<b>not bold</b>');
  assert.strictEqual(btn.textContent, '<b>not bold</b>');
  assert.strictEqual(btn.querySelector('b'), null);
});

test('createButton renders the one recognised markup shape - an access-key letter - as a real span', function(){
  const btn = createButton("Replace <span class='access-key'>A</span>ll");

  assert.strictEqual(btn.textContent, 'Replace All');
  const span = btn.querySelector('span.access-key');
  assert.ok(span);
  assert.strictEqual(span.textContent, 'A');
  //The letter is real text, not markup that happened to parse - confirms this was built with
  //createElement/textContent rather than by pattern-matching into an innerHTML string.
  assert.strictEqual(span.children.length, 0);
});

test('createButton renders the access-key span alone, with no leading or trailing text nodes required', function(){
  const btn = createButton("<span class='access-key'>F</span>ind");
  assert.strictEqual(btn.textContent, 'Find');
  assert.strictEqual(btn.childNodes.length, 2, 'the span, plus the trailing "ind" text node - no empty leading node');
});

test('generateRow wraps the two given elements in their own table cells in order', function(){
  const cellOneContent = document.createElement('span');
  cellOneContent.id = 'one';
  const cellTwoContent = document.createElement('span');
  cellTwoContent.id = 'two';

  const row = generateRow(cellOneContent, cellTwoContent);

  assert.strictEqual(row.tagName, 'TR');
  assert.strictEqual(row.children.length, 2);
  assert.strictEqual(row.children[0].tagName, 'TD');
  assert.strictEqual(row.children[0].firstChild.id, 'one');
  assert.strictEqual(row.children[1].tagName, 'TD');
  assert.strictEqual(row.children[1].firstChild.id, 'two');
});

//---------------------------------------------------------------------------
// removeOptions
//---------------------------------------------------------------------------

test('removeOptions removes every option from a select element', function(){
  document.body.innerHTML = '<select id="sel"><option>a</option><option>b</option><option>c</option></select>';
  const select = document.getElementById('sel');

  removeOptions(select);

  assert.strictEqual(select.options.length, 0);
});

test('removeOptions regression: logs instead of throwing when given something without an options list', function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  const { removeOptions: freshRemoveOptions } = freshUtils();

  assert.doesNotThrow(function(){ freshRemoveOptions(null); });
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

//---------------------------------------------------------------------------
// removeElementsByClass
//---------------------------------------------------------------------------

test('removeElementsByClass removes every element with the given class and clears its onblur handler', function(){
  document.body.innerHTML = '';
  for(let i = 0; i < 3; i++){
    const el = document.createElement('div');
    el.className = 'target';
    el.onblur = function(){};
    document.body.appendChild(el);
  }
  const other = document.createElement('div');
  other.className = 'keep-me';
  document.body.appendChild(other);

  removeElementsByClass('target');

  assert.strictEqual(document.getElementsByClassName('target').length, 0);
  assert.strictEqual(document.getElementsByClassName('keep-me').length, 1);
});

test('removeElementsByClass does nothing and does not throw when no elements match', function(){
  document.body.innerHTML = '';
  assert.doesNotThrow(function(){ removeElementsByClass('does-not-exist'); });
});

test('removeElementsByClass regression: logs instead of throwing when the DOM lookup fails', function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  t.mock.method(document, 'getElementsByClassName', function(){ throw new Error('dom failure'); });
  const { removeElementsByClass: freshRemoveElementsByClass } = freshUtils();

  assert.doesNotThrow(function(){ freshRemoveElementsByClass('anything'); });
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

//---------------------------------------------------------------------------
// enableSearchView / disableSearchView
//---------------------------------------------------------------------------

test('enableSearchView adds the search-view classes to the sidebar, notes, and writing field', function(){
  buildEditorFixture();

  enableSearchView();

  assert.ok(document.getElementById('chapter-list-sidebar').classList.contains('sidebar-search-view'));
  assert.ok(document.getElementById('project-notes').classList.contains('sidebar-search-view'));
  assert.ok(document.getElementById('writing-field').classList.contains('writing-field-search-view'));
});

test('disableSearchView removes the search-view classes added by enableSearchView', function(){
  buildEditorFixture();
  enableSearchView();

  disableSearchView();

  assert.ok(!document.getElementById('chapter-list-sidebar').classList.contains('sidebar-search-view'));
  assert.ok(!document.getElementById('project-notes').classList.contains('sidebar-search-view'));
  assert.ok(!document.getElementById('writing-field').classList.contains('writing-field-search-view'));
});

//---------------------------------------------------------------------------
// closePopups / closePopupDialogs
//---------------------------------------------------------------------------

test('closePopups removes popup elements, exits search view, and focuses the editor', function(){
  const qlEditor = buildEditorFixture();
  let focusCalls = 0;
  qlEditor.focus = function(){ focusCalls++; };
  enableSearchView();

  const popup = document.createElement('div');
  popup.className = 'popup';
  document.body.appendChild(popup);

  closePopups();

  assert.strictEqual(document.getElementsByClassName('popup').length, 0);
  assert.ok(!document.getElementById('chapter-list-sidebar').classList.contains('sidebar-search-view'));
  assert.strictEqual(focusCalls, 1);
});

test('closePopupDialogs focuses the editor when no popup remains after removing popup-dialogs', function(){
  const qlEditor = buildEditorFixture();
  let focusCalls = 0;
  qlEditor.focus = function(){ focusCalls++; };

  const dialog = document.createElement('div');
  dialog.className = 'popup-dialog';
  document.body.appendChild(dialog);

  closePopupDialogs();

  assert.strictEqual(document.getElementsByClassName('popup-dialog').length, 0);
  assert.strictEqual(focusCalls, 1);
});

test('closePopupDialogs focuses the first remaining popup instead of the editor when one exists', function(){
  const qlEditor = buildEditorFixture();
  let editorFocusCalls = 0;
  qlEditor.focus = function(){ editorFocusCalls++; };

  const dialog = document.createElement('div');
  dialog.className = 'popup-dialog';
  document.body.appendChild(dialog);

  const popup = document.createElement('div');
  popup.className = 'popup';
  let popupFocusCalls = 0;
  popup.focus = function(){ popupFocusCalls++; };
  document.body.appendChild(popup);

  closePopupDialogs();

  assert.strictEqual(popupFocusCalls, 1);
  assert.strictEqual(editorFocusCalls, 0);
});
