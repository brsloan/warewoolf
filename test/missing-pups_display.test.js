const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const missingPupsDisplayPath = require.resolve('../src/components/views/missing-pups_display');
const fileManagerControllerPath = require.resolve('../src/components/controllers/file-manager');

//missing-pups_display.js destructures getFileList from the file-manager controller at require-time,
//so mocking it only takes effect if the cache is primed before missing-pups_display.js is
//(re-)required - same pattern as file-manager_display.test.js's freshFileManagerDisplay().
//fs.existsSync/readdirSync are used as `fs.existsSync(...)` (never destructured), so those can be
//mocked directly on the shared `fs` module object with t.mock.method, as in battery-monitor.test.js.
function freshMissingPupsDisplay(mocks){
  delete require.cache[missingPupsDisplayPath];
  require.cache[fileManagerControllerPath] = {
    id: fileManagerControllerPath,
    filename: fileManagerControllerPath,
    loaded: true,
    exports: {
      getFileList: mocks.getFileList || function(){ return []; }
    }
  };
  return require(missingPupsDisplayPath);
}

//closePopups() also calls disableSearchView()/focusEditor(), which reach for this fixed shell by
//id - same shell used in file-manager_display.test.js / findreplace_display.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

function makeProject(overrides){
  return Object.assign({
    directory: '/proj/',
    chapsDirectory: 'chapters/',
    chapters: [],
    reference: [],
    testChapsDirectory: function(){ return []; },
    saveFile: function(){}
  }, overrides);
}

function makeChap(title, filename){
  return { title: title, filename: filename };
}

function keyup(target, key){
  target.dispatchEvent(new window.KeyboardEvent('keyup', { key: key, bubbles: true, cancelable: true }));
}

//Simulates a real user typing text into a field character-by-character: the browser appends one
//character to .value and fires keyup after each keystroke.
function typeInto(input, text){
  input.value = '';
  for(const ch of text){
    input.value += ch;
    keyup(input, ch);
  }
}

//createButton() sets innerHTML, and jsdom re-serializes "&" back out as "&amp;" when read via
//innerHTML (e.g. for "Save & Reload") - compare against textContent instead, which is decoded.
function findButton(text){
  return Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent === text; });
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[missingPupsDisplayPath];
  delete require.cache[fileManagerControllerPath];
  delete global.window;
  delete global.document;
});

test('renders the project directory, prefills the expected subdirectory, and lists missing chapters', function(t){
  t.mock.method(fs, 'existsSync', function(){ return true; });
  t.mock.method(fs, 'readdirSync', function(){ return []; });
  var chap = makeChap('Chapter One', 'ch1.txt');
  var project = makeProject({
    directory: '/proj/',
    chapsDirectory: 'chapters/',
    chapters: [chap],
    testChapsDirectory: function(){ return [chap]; }
  });
  var promptForMissingPups = freshMissingPupsDisplay({});

  promptForMissingPups(project, function(){});

  assert.strictEqual(document.querySelector('p.popup-text-small').innerText, '/proj/');
  assert.strictEqual(document.querySelector('input[type="text"]').value, 'chapters/');
  assert.ok(findButton('Save & Reload'), 'expected a Save & Reload button');
  assert.ok(findButton('Close'), 'expected a Close button');
  var chapLabels = Array.from(document.querySelectorAll('label')).map(function(l){ return l.innerText; });
  assert.ok(chapLabels.includes('Chapter One: '));
});

test('Close removes the popup and calls back with "cancel"', function(t){
  t.mock.method(fs, 'existsSync', function(){ return true; });
  t.mock.method(fs, 'readdirSync', function(){ return []; });
  var callbackCalls = [];
  var project = makeProject();
  var promptForMissingPups = freshMissingPupsDisplay({});

  promptForMissingPups(project, function(resp){ callbackCalls.push(resp); });
  findButton('Close').onclick();

  assert.strictEqual(document.getElementsByClassName('popup').length, 0);
  assert.deepStrictEqual(callbackCalls, ['cancel']);
});

test('Save & Reload saves the project, removes the popup, and calls back with "save"', function(t){
  t.mock.method(fs, 'existsSync', function(){ return true; });
  t.mock.method(fs, 'readdirSync', function(){ return []; });
  var saveFileCalls = 0;
  var callbackCalls = [];
  var project = makeProject({ saveFile: function(){ saveFileCalls++; } });
  var promptForMissingPups = freshMissingPupsDisplay({});

  promptForMissingPups(project, function(resp){ callbackCalls.push(resp); });
  findButton('Save & Reload').onclick();

  assert.strictEqual(saveFileCalls, 1);
  assert.strictEqual(document.getElementsByClassName('popup').length, 0);
  assert.deepStrictEqual(callbackCalls, ['save']);
});

test('Delete requires a confirming second click before removing the chapter', function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  t.mock.method(fs, 'readdirSync', function(){ return []; });
  var chap = makeChap('Chapter One', 'ch1.txt');
  var project = makeProject({
    chapters: [chap],
    testChapsDirectory: function(){ return project.chapters.includes(chap) ? [chap] : []; }
  });
  var promptForMissingPups = freshMissingPupsDisplay({});

  promptForMissingPups(project, function(){});
  var deleteBtn = findButton('Delete');
  //jsdom's innerText doesn't derive from rendered content set via innerHTML (as createButton()
  //does) - it only tracks values assigned through innerText itself. A real browser's innerText
  //would already read 'Delete' here, so prime jsdom's tracking to match before exercising the
  //source's `deleteBtn.innerText == 'Delete'` check.
  deleteBtn.innerText = 'Delete';

  deleteBtn.onclick();
  assert.strictEqual(deleteBtn.innerText, 'Click Again To DELETE');
  assert.deepStrictEqual(project.chapters, [chap], 'a single click should not delete yet');

  deleteBtn.onclick();
  assert.deepStrictEqual(project.chapters, [], 'a second click should remove the chapter');
});

test('editing a missing chapter\'s filename updates the chapter object and re-checks it against disk', function(t){
  t.mock.method(fs, 'existsSync', function(p){ return p === '/proj/chapters/found.txt'; });
  t.mock.method(fs, 'readdirSync', function(){ return []; });
  var chap = makeChap('Chapter One', 'missing.txt');
  var project = makeProject({ chapters: [chap], testChapsDirectory: function(){ return [chap]; } });
  var promptForMissingPups = freshMissingPupsDisplay({});

  promptForMissingPups(project, function(){});
  var filenameInput = document.querySelectorAll('input[type="text"]')[1];
  assert.strictEqual(filenameInput.value, 'missing.txt');

  filenameInput.value = 'found.txt';
  keyup(filenameInput, 't');

  assert.strictEqual(chap.filename, 'found.txt', 'typing in the filename field should update the chapter');
  assert.strictEqual(filenameInput.nextElementSibling.innerText, ' ✔ Exists');
});

//Regression: the Expected Subdirectory field used to force a trailing '/' onto its own value on
//every keyup. Since setting .value moves the caret to the end, each keystroke landed after that
//forced slash, so typing "NewChapters" produced "N/e/w/C/h/a/p/t/e/r/s/" instead of "NewChapters".
test('typing a multi-character subdirectory name is not fragmented by a forced slash on every keystroke', function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  t.mock.method(fs, 'readdirSync', function(){ return []; });
  var project = makeProject({ chapsDirectory: '' });
  var promptForMissingPups = freshMissingPupsDisplay({});

  promptForMissingPups(project, function(){});
  var chapsDirIn = document.querySelector('input[type="text"]');

  typeInto(chapsDirIn, 'NewChapters');

  assert.strictEqual(chapsDirIn.value, 'NewChapters', 'the field itself should hold exactly what was typed');
  assert.strictEqual(project.chapsDirectory, 'NewChapters/', 'the model should still get a normalized trailing slash');
});

//Regression: because the old handler unconditionally re-appended '/' whenever the value didn't
//already end in one, backspacing over the trailing slash was immediately undone, making it
//impossible to edit down from the end of the field.
test('removing the trailing slash from the subdirectory field is not immediately re-added', function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  t.mock.method(fs, 'readdirSync', function(){ return []; });
  var project = makeProject({ chapsDirectory: 'chapters/' });
  var promptForMissingPups = freshMissingPupsDisplay({});

  promptForMissingPups(project, function(){});
  var chapsDirIn = document.querySelector('input[type="text"]');
  assert.strictEqual(chapsDirIn.value, 'chapters/');

  chapsDirIn.value = 'chapters';
  keyup(chapsDirIn, 'Backspace');

  assert.strictEqual(chapsDirIn.value, 'chapters', 'the backspace should stick instead of being reverted');
  assert.strictEqual(project.chapsDirectory, 'chapters/', 'the model value is still normalized for disk checks');
});

test('the file list looks up files using a normalized trailing slash even if the field lacks one', function(t){
  t.mock.method(fs, 'existsSync', function(){ return true; });
  t.mock.method(fs, 'readdirSync', function(){ return []; });
  var getFileListCalls = [];
  var project = makeProject({ directory: '/proj/', chapsDirectory: 'chapters/' });
  var promptForMissingPups = freshMissingPupsDisplay({
    getFileList: function(dirPath){ getFileListCalls.push(dirPath); return []; }
  });

  promptForMissingPups(project, function(){});
  var chapsDirIn = document.querySelector('input[type="text"]');
  chapsDirIn.value = 'newdir';
  keyup(chapsDirIn, 'r');

  assert.ok(getFileListCalls.includes('/proj/newdir/'), 'expected getFileList to be called with a normalized trailing slash, got: ' + getFileListCalls);
});

//Regression: the per-chapter "already used" check only looked at project.chapters, unlike the
//Files In Subdirectory list which correctly checks chapters *and* reference docs. Retyping a
//missing chapter's filename to match a reference doc's filename used to show a reassuring
//"Exists" instead of flagging the collision.
test('a missing chapter\'s filename is flagged as already used when it collides with a reference document', function(t){
  t.mock.method(fs, 'existsSync', function(p){ return p === '/proj/chapters/shared.txt'; });
  t.mock.method(fs, 'readdirSync', function(){ return []; });
  var chap = makeChap('Chapter One', 'missing.txt');
  var project = makeProject({
    chapters: [chap],
    reference: [makeChap('Notes', 'shared.txt')],
    testChapsDirectory: function(){ return [chap]; }
  });
  var promptForMissingPups = freshMissingPupsDisplay({});

  promptForMissingPups(project, function(){});
  var filenameInput = document.querySelectorAll('input[type="text"]')[1];
  filenameInput.value = 'shared.txt';
  keyup(filenameInput, 't');

  assert.strictEqual(filenameInput.nextElementSibling.innerText, ' !! File Already Used By Another Chapter');
  assert.ok(filenameInput.nextElementSibling.classList.contains('unsure-check'));
});
