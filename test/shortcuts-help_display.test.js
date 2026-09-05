const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const shortcutsHelpDisplayPath = require.resolve('../src/components/views/shortcuts-help_display');

//closePopups() also calls disableSearchView()/focusEditor(), which reach for this fixed shell by
//id - same shell used in outliner_display.test.js / renumber-chapters_display.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

function keydown(target, key){
  target.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: key,
    bubbles: true,
    cancelable: true
  }));
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[shortcutsHelpDisplayPath];
  delete global.window;
  delete global.document;
});

test('renders a table of shortcuts per section using Cmd on Mac and Ctrl elsewhere', function(t){
  var showShortcutsHelp = require(shortcutsHelpDisplayPath);

  showShortcutsHelp(true);
  assert.match(document.querySelector('.shortcuts-table td').innerText, /^View Previous Chapter$/);
  assert.match(document.querySelectorAll('.shortcuts-table td')[1].innerText, /^Cmd \+ Up$/);

  showShortcutsHelp(false);
  assert.match(document.querySelectorAll('.shortcuts-table td')[1].innerText, /^Ctrl \+ Up$/);
});

test('Close button removes the popup', function(t){
  var showShortcutsHelp = require(shortcutsHelpDisplayPath);
  showShortcutsHelp(false);

  var closeBtn = Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent === 'Close'; });
  closeBtn.onclick();

  assert.strictEqual(document.getElementsByClassName('popup').length, 0);
});

//Regression: the popup's own "Close Tool Dialog: Escape" row documented a shortcut it didn't
//actually implement - it never listened for Escape, so the only way to close it was clicking Close.
test('pressing Escape inside the popup closes it', function(t){
  var showShortcutsHelp = require(shortcutsHelpDisplayPath);
  showShortcutsHelp(false);

  var popup = document.querySelector('.popup');
  keydown(popup, 'Escape');

  assert.strictEqual(document.getElementsByClassName('popup').length, 0);
});

test('other keys pressed inside the popup do not close it', function(t){
  var showShortcutsHelp = require(shortcutsHelpDisplayPath);
  showShortcutsHelp(false);

  var popup = document.querySelector('.popup');
  keydown(popup, 'Tab');

  assert.strictEqual(document.getElementsByClassName('popup').length, 1);
});
