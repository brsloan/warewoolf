const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const fileDialogDisplayPath = require.resolve('../src/components/views/file-dialog_display');
const fileManagerPath = require.resolve('../src/components/controllers/file-manager');

//file-dialog_display.js destructures getFileList/getParentDirectory from the file-manager
//controller at require-time, so mocking them only takes effect if the cache is primed before
//file-dialog_display.js is (re-)required - same pattern as corkboard_display.test.js.
function freshFileDialogDisplay(mocks){
  delete require.cache[fileDialogDisplayPath];
  require.cache[fileManagerPath] = {
    id: fileManagerPath,
    filename: fileManagerPath,
    loaded: true,
    exports: {
      getFileList: mocks.getFileList,
      getParentDirectory: mocks.getParentDirectory || function(p){ return p.slice(0, p.lastIndexOf('/')) || '/'; }
    }
  };
  return require(fileDialogDisplayPath);
}

//closePopupDialogs() falls back to focusEditor(), which reaches for this fixed shell by id -
//same shell used in corkboard_display.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>';
}

function dirent(name, isDir){
  return { name: name, isDirectory: function(){ return isDir; } };
}

function keydown(target, key){
  target.dispatchEvent(new window.KeyboardEvent('keydown', { key: key, bubbles: true, cancelable: true }));
}

//fileListSelect is a multi-select, and populateFileList() leaves "< Parent Directory" selected -
//selecting another option on top of that (without clearing it first) leaves both selected, and
//.selectedIndex/.value then resolve to the earlier "uplevel" option instead of the one intended.
function selectOnly(selectEl, value){
  Array.from(selectEl.options).forEach(function(o){ o.selected = (o.value === value); });
}

function baseOptions(overrides){
  return Object.assign({
    title: 'Test dialog',
    defaultPath: '/proj/docs',
    filters: [{ name: 'Documents', extensions: ['docx'] }],
    bookmarkedPaths: [],
    dialogType: 'save'
  }, overrides);
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
  global.project = { directory: '/proj' };
  //render.js defines this as a bare function declaration in a <script> tag, so in the real app it
  //ends up on the shared renderer global/window - reproduce that the same way corkboard_display.js's
  //own local copy does, so keydown handlers that call it don't throw ReferenceError under test.
  global.stopDefaultPropagation = function(keyEvent){
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
  };
});

test.afterEach(function(){
  delete require.cache[fileDialogDisplayPath];
  delete require.cache[fileManagerPath];
  delete global.window;
  delete global.document;
  delete global.project;
  delete global.stopDefaultPropagation;
});

test('save dialog: pressing Enter in the filename field sanitizes the name and fixes the extension, same as clicking Save', function(t){
  var showFileDialog = freshFileDialogDisplay({
    getFileList: function(){ return []; }
  });
  var callbackArgs = [];

  showFileDialog(baseOptions(), function(result){ callbackArgs.push(result); });

  var filenameIn = document.querySelector('.save-input[type="text"]');
  //Multiple dots and an illegal Windows filename character, with the wrong extension -
  //regression coverage for both the join('.') fix and the Enter handler now routing through
  //saveSelectedFile()'s sanitize/extension-check instead of using the raw value.
  filenameIn.value = 'my:notes.v2.pdf';
  keydown(filenameIn, 'Enter');

  assert.strictEqual(callbackArgs.length, 1);
  assert.strictEqual(callbackArgs[0], '/proj/docs/mynotes.v2.docx');
});

test('save dialog: clicking Save applies the same normalization as Enter', function(t){
  var showFileDialog = freshFileDialogDisplay({
    getFileList: function(){ return []; }
  });
  var callbackArgs = [];

  showFileDialog(baseOptions(), function(result){ callbackArgs.push(result); });

  var filenameIn = document.querySelector('.save-input[type="text"]');
  filenameIn.value = 'my:notes.v2.pdf';
  var saveBtn = Array.from(document.querySelectorAll('button')).find(function(b){ return b.innerHTML === 'Save'; });
  saveBtn.onclick();

  assert.strictEqual(callbackArgs.length, 1);
  assert.strictEqual(callbackArgs[0], '/proj/docs/mynotes.v2.docx');
});

test('save dialog: an empty filters list does not throw and defaults the filename field to empty', function(t){
  var showFileDialog = freshFileDialogDisplay({
    getFileList: function(){ return []; }
  });

  assert.doesNotThrow(function(){
    showFileDialog(baseOptions({ filters: [] }), function(){});
  });

  var filenameIn = document.querySelector('.save-input[type="text"]');
  assert.strictEqual(filenameIn.value, '');
});

test('open dialog: pressing Enter on a directory entry navigates into it', function(t){
  var getFileListCalls = [];
  var showFileDialog = freshFileDialogDisplay({
    getFileList: function(dirPath){
      getFileListCalls.push(dirPath);
      if(dirPath === '/proj/docs')
        return [dirent('sub', true), dirent('notes.docx', false)];
      return [];
    }
  });

  showFileDialog(baseOptions({ dialogType: 'open' }), function(){});

  var fileListSelect = document.querySelector('.file-manager-list');
  selectOnly(fileListSelect, 'sub');
  keydown(fileListSelect, 'Enter');

  assert.deepStrictEqual(getFileListCalls, ['/proj/docs', '/proj/docs/sub']);
  assert.strictEqual(document.querySelector('p').innerText, '/proj/docs/sub');
});

test('open dialog: pressing Enter on a file entry calls back with its full path', function(t){
  var showFileDialog = freshFileDialogDisplay({
    getFileList: function(){ return [dirent('sub', true), dirent('notes.docx', false)]; }
  });
  var callbackArgs = [];

  showFileDialog(baseOptions({ dialogType: 'open' }), function(result){ callbackArgs.push(result); });

  var fileListSelect = document.querySelector('.file-manager-list');
  selectOnly(fileListSelect, 'notes.docx');
  keydown(fileListSelect, 'Enter');

  assert.strictEqual(callbackArgs.length, 1);
  assert.deepStrictEqual(callbackArgs[0], ['/proj/docs/notes.docx']);
});
