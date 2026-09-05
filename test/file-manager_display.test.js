const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const fileManagerDisplayPath = require.resolve('../src/components/views/file-manager_display');
const fileManagerControllerPath = require.resolve('../src/components/controllers/file-manager');

//file-manager_display.js destructures createNewDirectory/renameFiles/moveFiles/copyFiles/getFileList/
//deleteFile/getParentDirectory from the file-manager controller at require-time (and separately
//re-requires it for unzipProject inside the Unzip button's onclick), so mocking them only takes
//effect if the cache is primed before file-manager_display.js is (re-)required - same pattern as
//file-dialog_display.test.js's freshFileDialogDisplay().
function freshFileManagerDisplay(mocks){
  delete require.cache[fileManagerDisplayPath];
  require.cache[fileManagerControllerPath] = {
    id: fileManagerControllerPath,
    filename: fileManagerControllerPath,
    loaded: true,
    exports: {
      createNewDirectory: mocks.createNewDirectory || function(){},
      renameFiles: mocks.renameFiles || function(){},
      moveFiles: mocks.moveFiles || function(){},
      copyFiles: mocks.copyFiles || function(){},
      getFileList: mocks.getFileList || function(){ return []; },
      deleteFile: mocks.deleteFile || function(){},
      getParentDirectory: mocks.getParentDirectory || function(p){ return p.slice(0, p.lastIndexOf('/')) || '/'; },
      unzipProject: mocks.unzipProject || function(path, callback){ callback(); }
    }
  };
  return require(fileManagerDisplayPath);
}

//closePopups() falls back to focusEditor(), and enableSearchView/disableSearchView (pulled in via
//the same utils module) reach for this fixed set of app-shell elements by id - same shell used in
//corkboard_display.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

function dirent(name, isDir){
  return { name: name, isDirectory: function(){ return isDir; } };
}

function keydown(target, key, modifiers){
  target.dispatchEvent(new window.KeyboardEvent('keydown', Object.assign({
    key: key,
    bubbles: true,
    cancelable: true
  }, modifiers)));
}

//fileListSelect is a multi-select, and populateFMFileList() leaves "< Parent Directory" selected -
//selecting another option on top of that (without clearing it first) leaves both selected, and
//.selectedIndex/.value then resolve to the earlier "uplevel" option instead of the one intended.
function selectOnly(selectEl, value){
  Array.from(selectEl.options).forEach(function(o){ o.selected = (o.value === value); });
}

function selectMultiple(selectEl, values){
  Array.from(selectEl.options).forEach(function(o){ o.selected = values.includes(o.value); });
}

function findButton(text){
  return Array.from(document.querySelectorAll('button')).find(function(b){ return b.innerHTML === text; });
}

//New Folder/Rename/Unzip carry an access-key <span> in their innerHTML, and jsdom re-serializes
//attribute quoting (') to (") on the way back out, so comparing against the original markup string
//never matches - look these up by their accessKey attribute instead.
function findButtonByAccessKey(key){
  return Array.from(document.querySelectorAll('button')).find(function(b){ return b.accessKey === key; });
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[fileManagerDisplayPath];
  delete require.cache[fileManagerControllerPath];
  delete global.window;
  delete global.document;
});

test('on open: lists deduped shortcuts, lists parent-dir plus directories-before-files, and focuses the file list', function(t){
  var showFileManager = freshFileManagerDisplay({
    getFileList: function(dirPath){
      if(dirPath === '/proj/docs')
        return [dirent('notes.docx', false), dirent('chapters', true)];
      return [];
    }
  });

  showFileManager({ docs: '/proj/docs', home: '/proj/docs' }, '/proj/');

  var shortcutValues = Array.from(document.querySelector('.file-dir-shortcuts').options).map(function(o){ return o.value; });
  //sysDir.home === sysDir.docs, so home is not listed a second time; the trailing slash on
  //projDir is stripped before the dedupe check against '/proj'.
  assert.deepStrictEqual(shortcutValues, ['/proj/docs', '/proj']);

  var fileListSelect = document.querySelector('.file-manager-list');
  var listed = Array.from(fileListSelect.options).map(function(o){ return o.value; });
  assert.deepStrictEqual(listed, ['uplevel', 'chapters', 'notes.docx']);
  assert.strictEqual(fileListSelect.options[1].dataset.filetype, 'dir');
  assert.strictEqual(fileListSelect.options[2].dataset.filetype, 'file');
  assert.strictEqual(document.querySelector('p').innerText, '/proj/docs');
  assert.strictEqual(document.activeElement, fileListSelect);
});

test('dir shortcut list: Enter navigates to the selected shortcut, ArrowRight moves focus to the file list', function(t){
  var getFileListCalls = [];
  var showFileManager = freshFileManagerDisplay({
    getFileList: function(dirPath){ getFileListCalls.push(dirPath); return []; }
  });

  showFileManager({ docs: '/proj/docs', home: '/home/user' }, '/proj');

  var dirShortcutSelect = document.querySelector('.file-dir-shortcuts');
  var fileListSelect = document.querySelector('.file-manager-list');
  selectOnly(dirShortcutSelect, '/home/user');
  keydown(dirShortcutSelect, 'Enter');

  assert.deepStrictEqual(getFileListCalls, ['/proj/docs', '/home/user']);
  assert.strictEqual(document.querySelector('p').innerText, '/home/user');

  keydown(dirShortcutSelect, 'ArrowRight');
  assert.strictEqual(document.activeElement, fileListSelect);
});

test('file list: Enter on a directory entry navigates into it; Enter on a file entry does nothing', function(t){
  var getFileListCalls = [];
  var showFileManager = freshFileManagerDisplay({
    getFileList: function(dirPath){
      getFileListCalls.push(dirPath);
      if(dirPath === '/proj/docs')
        return [dirent('chapters', true), dirent('notes.docx', false)];
      return [];
    }
  });

  showFileManager({ docs: '/proj/docs', home: '/proj/docs' }, '/proj');
  var fileListSelect = document.querySelector('.file-manager-list');

  selectOnly(fileListSelect, 'notes.docx');
  keydown(fileListSelect, 'Enter');
  assert.deepStrictEqual(getFileListCalls, ['/proj/docs']);
  assert.strictEqual(document.querySelector('p').innerText, '/proj/docs');

  selectOnly(fileListSelect, 'chapters');
  keydown(fileListSelect, 'Enter');
  assert.deepStrictEqual(getFileListCalls, ['/proj/docs', '/proj/docs/chapters']);
  assert.strictEqual(document.querySelector('p').innerText, '/proj/docs/chapters');
});

test('file list: Enter on "< Parent Directory" navigates up via getParentDirectory, and ArrowLeft moves focus back to shortcuts', function(t){
  var showFileManager = freshFileManagerDisplay({
    getFileList: function(){ return []; },
    getParentDirectory: function(p){ return '/proj'; }
  });

  showFileManager({ docs: '/proj/docs', home: '/proj/docs' }, '/proj');
  var dirShortcutSelect = document.querySelector('.file-dir-shortcuts');
  var fileListSelect = document.querySelector('.file-manager-list');

  keydown(fileListSelect, 'Enter');
  assert.strictEqual(document.querySelector('p').innerText, '/proj');

  keydown(fileListSelect, 'ArrowLeft');
  assert.strictEqual(document.activeElement, dirShortcutSelect);
});

test('new folder: Enter creates the directory, refreshes the list, hides the panel and does not throw (regression: missing stopDefaultPropagation crashed this handler)', function(t){
  var createNewDirectoryCalls = [];
  var getFileListCallCount = 0;
  var showFileManager = freshFileManagerDisplay({
    createNewDirectory: function(name, loc){ createNewDirectoryCalls.push([name, loc]); },
    getFileList: function(){ getFileListCallCount++; return []; }
  });

  showFileManager({ docs: '/proj/docs', home: '/proj/docs' }, '/proj');
  findButtonByAccessKey('f').onclick();

  var newDirInput = document.querySelector('input[type="text"]');
  newDirInput.value = 'New Chapter';
  assert.doesNotThrow(function(){ keydown(newDirInput, 'Enter'); });

  assert.deepStrictEqual(createNewDirectoryCalls, [['New Chapter', '/proj/docs']]);
  assert.strictEqual(getFileListCallCount, 2);
  assert.strictEqual(newDirInput.value, '');
  assert.strictEqual(newDirInput.parentElement.style.display, 'none');
});

test('new folder: Escape clears the input and hides the panel without creating anything', function(t){
  var createNewDirectoryCalls = [];
  var showFileManager = freshFileManagerDisplay({
    createNewDirectory: function(){ createNewDirectoryCalls.push(1); }
  });

  showFileManager({ docs: '/proj/docs', home: '/proj/docs' }, '/proj');
  findButtonByAccessKey('f').onclick();

  var newDirInput = document.querySelector('input[type="text"]');
  newDirInput.value = 'abandoned';
  keydown(newDirInput, 'Escape');

  assert.strictEqual(createNewDirectoryCalls.length, 0);
  assert.strictEqual(newDirInput.value, '');
  assert.strictEqual(newDirInput.parentElement.style.display, 'none');
});

test('delete: Delete key and Ctrl+D both open the confirm panel listing only the non-"uplevel" selection', function(t){
  var showFileManager = freshFileManagerDisplay({
    getFileList: function(){ return [dirent('a.txt', false), dirent('b.txt', false)]; }
  });

  showFileManager({ docs: '/proj/docs', home: '/proj/docs' }, '/proj');
  var fileListSelect = document.querySelector('.file-manager-list');

  selectMultiple(fileListSelect, ['uplevel', 'a.txt', 'b.txt']);
  assert.doesNotThrow(function(){ keydown(fileListSelect, 'Delete'); });

  var listedNames = Array.from(document.querySelectorAll('ul li')).map(function(li){ return li.innerText; });
  assert.deepStrictEqual(listedNames, ['a.txt', 'b.txt']);
});

test('delete: confirming permanently deletes each selected file (skipping "uplevel"), refreshes, and hides the panel', function(t){
  var deleteFileCalls = [];
  var getFileListCallCount = 0;
  var showFileManager = freshFileManagerDisplay({
    getFileList: function(){ getFileListCallCount++; return [dirent('a.txt', false), dirent('b.txt', false)]; },
    deleteFile: function(fpth){ deleteFileCalls.push(fpth); }
  });

  showFileManager({ docs: '/proj/docs', home: '/proj/docs' }, '/proj');
  var fileListSelect = document.querySelector('.file-manager-list');
  selectMultiple(fileListSelect, ['uplevel', 'a.txt', 'b.txt']);
  keydown(fileListSelect, 'd', { ctrlKey: true });

  findButton('Permanently Delete').onclick();

  assert.deepStrictEqual(deleteFileCalls, ['/proj/docs/a.txt', '/proj/docs/b.txt']);
  assert.strictEqual(getFileListCallCount, 2);
});

test('delete: Cancel hides the panel without deleting anything', function(t){
  var deleteFileCalls = [];
  var showFileManager = freshFileManagerDisplay({
    getFileList: function(){ return [dirent('a.txt', false)]; },
    deleteFile: function(fpth){ deleteFileCalls.push(fpth); }
  });

  showFileManager({ docs: '/proj/docs', home: '/proj/docs' }, '/proj');
  var fileListSelect = document.querySelector('.file-manager-list');
  selectOnly(fileListSelect, 'a.txt');
  keydown(fileListSelect, 'Delete');
  findButton('Cancel').onclick();

  assert.strictEqual(deleteFileCalls.length, 0);
});

test('rename: clicking Rename with nothing selected does nothing (regression: used to throw reading selectedOptions[0] of an empty list)', function(t){
  var showFileManager = freshFileManagerDisplay({
    getFileList: function(){ return [dirent('a.txt', false)]; }
  });

  showFileManager({ docs: '/proj/docs', home: '/proj/docs' }, '/proj');
  //populateFMFileList() leaves "< Parent Directory" selected by default, so the empty-selection
  //case has to be produced explicitly by deselecting it.
  selectMultiple(document.querySelector('.file-manager-list'), []);
  var renameBtn = findButtonByAccessKey('r');

  assert.doesNotThrow(function(){ renameBtn.onclick(); });
  var renameInput = document.querySelectorAll('input[type="text"]')[1];
  assert.strictEqual(renameInput.parentElement.style.display, 'none');
});

test('rename: clicking Rename with a selection prefills the name, and Enter applies the rename and refreshes', function(t){
  var renameFilesCalls = [];
  var getFileListCallCount = 0;
  var showFileManager = freshFileManagerDisplay({
    getFileList: function(){ getFileListCallCount++; return [dirent('a.txt', false)]; },
    renameFiles: function(files, newName, loc){ renameFilesCalls.push([files, newName, loc]); }
  });

  showFileManager({ docs: '/proj/docs', home: '/proj/docs' }, '/proj');
  var fileListSelect = document.querySelector('.file-manager-list');
  selectOnly(fileListSelect, 'a.txt');

  var renameBtn = findButtonByAccessKey('r');
  renameBtn.onclick();

  var renameInput = document.querySelectorAll('input[type="text"]')[1];
  assert.strictEqual(renameInput.value, 'a.txt');

  renameInput.value = 'b.txt';
  keydown(renameInput, 'Enter');

  assert.deepStrictEqual(renameFilesCalls, [[['a.txt'], 'b.txt', '/proj/docs']]);
  assert.strictEqual(getFileListCallCount, 2);
  assert.strictEqual(renameInput.parentElement.style.display, 'none');
});

test('unzip: clicking Unzip with nothing selected does nothing (regression: used to throw reading selectedOptions[0] of an empty list)', function(t){
  var unzipProjectCalls = [];
  var showFileManager = freshFileManagerDisplay({
    getFileList: function(){ return [dirent('archive.zip', false)]; },
    unzipProject: function(path, cb){ unzipProjectCalls.push(path); cb(); }
  });

  showFileManager({ docs: '/proj/docs', home: '/proj/docs' }, '/proj');
  //populateFMFileList() leaves "< Parent Directory" selected by default, so the empty-selection
  //case has to be produced explicitly by deselecting it.
  selectMultiple(document.querySelector('.file-manager-list'), []);
  var unzipBtn = findButtonByAccessKey('u');

  assert.doesNotThrow(function(){ unzipBtn.onclick(); });
  assert.strictEqual(unzipProjectCalls.length, 0);
});

test('unzip: clicking Unzip with a zip selected extracts it and refreshes the list', function(t){
  var unzipProjectCalls = [];
  var getFileListCallCount = 0;
  var showFileManager = freshFileManagerDisplay({
    getFileList: function(){ getFileListCallCount++; return [dirent('archive.zip', false)]; },
    unzipProject: function(path, cb){ unzipProjectCalls.push(path); cb(); }
  });

  showFileManager({ docs: '/proj/docs', home: '/proj/docs' }, '/proj');
  var fileListSelect = document.querySelector('.file-manager-list');
  selectOnly(fileListSelect, 'archive.zip');
  findButtonByAccessKey('u').onclick();

  assert.deepStrictEqual(unzipProjectCalls, ['/proj/docs/archive.zip']);
  assert.strictEqual(getFileListCallCount, 2);
});

test('cut/paste: Ctrl+X marks the selection for cut, a second Ctrl+X on a different item clears the earlier mark (regression: stale "to-be-cut" styling), and Ctrl+V moves the current selection', function(t){
  var moveFilesCalls = [];
  var showFileManager = freshFileManagerDisplay({
    getFileList: function(){ return [dirent('a.txt', false), dirent('b.txt', false)]; },
    moveFiles: function(files, loc){ moveFilesCalls.push([files, loc]); }
  });

  showFileManager({ docs: '/proj/docs', home: '/proj/docs' }, '/proj');
  var fileListSelect = document.querySelector('.file-manager-list');
  var optionA = Array.from(fileListSelect.options).find(function(o){ return o.value === 'a.txt'; });
  var optionB = Array.from(fileListSelect.options).find(function(o){ return o.value === 'b.txt'; });

  selectOnly(fileListSelect, 'a.txt');
  keydown(fileListSelect, 'x', { ctrlKey: true });
  assert.ok(optionA.classList.contains('to-be-cut'));

  selectOnly(fileListSelect, 'b.txt');
  keydown(fileListSelect, 'x', { ctrlKey: true });
  assert.ok(!optionA.classList.contains('to-be-cut'), 'previous cut mark should be cleared');
  assert.ok(optionB.classList.contains('to-be-cut'));

  keydown(fileListSelect, 'v', { ctrlKey: true });
  assert.deepStrictEqual(moveFilesCalls, [[['/proj/docs/b.txt'], '/proj/docs']]);
});

test('copy/paste: Ctrl+C after a Ctrl+X clears the cut marks and copies the current selection on Ctrl+V (regression: copyFiles was never imported and threw on paste)', function(t){
  var copyFilesCalls = [];
  var showFileManager = freshFileManagerDisplay({
    getFileList: function(){ return [dirent('a.txt', false), dirent('b.txt', false)]; },
    copyFiles: function(files, loc){ copyFilesCalls.push([files, loc]); }
  });

  showFileManager({ docs: '/proj/docs', home: '/proj/docs' }, '/proj');
  var fileListSelect = document.querySelector('.file-manager-list');
  var optionA = Array.from(fileListSelect.options).find(function(o){ return o.value === 'a.txt'; });

  selectOnly(fileListSelect, 'a.txt');
  keydown(fileListSelect, 'x', { ctrlKey: true });
  assert.ok(optionA.classList.contains('to-be-cut'));

  selectOnly(fileListSelect, 'b.txt');
  assert.doesNotThrow(function(){ keydown(fileListSelect, 'c', { ctrlKey: true }); });
  assert.ok(!optionA.classList.contains('to-be-cut'), 'switching to copy should clear cut marks');

  assert.doesNotThrow(function(){ keydown(fileListSelect, 'v', { ctrlKey: true }); });
  assert.deepStrictEqual(copyFilesCalls, [[['/proj/docs/b.txt'], '/proj/docs']]);
});

test('"uplevel" is never included in a cut or copy selection', function(t){
  var showFileManager = freshFileManagerDisplay({
    getFileList: function(){ return [dirent('a.txt', false)]; }
  });

  showFileManager({ docs: '/proj/docs', home: '/proj/docs' }, '/proj');
  var fileListSelect = document.querySelector('.file-manager-list');

  selectMultiple(fileListSelect, ['uplevel', 'a.txt']);
  keydown(fileListSelect, 'x', { ctrlKey: true });
  var uplevelOption = Array.from(fileListSelect.options).find(function(o){ return o.value === 'uplevel'; });
  assert.ok(!uplevelOption.classList.contains('to-be-cut'));
});

test('Close removes the popup', function(t){
  var showFileManager = freshFileManagerDisplay({
    getFileList: function(){ return []; }
  });

  showFileManager({ docs: '/proj/docs', home: '/proj/docs' }, '/proj');
  assert.strictEqual(document.getElementsByClassName('popup').length, 1);

  findButton('Close').onclick();
  assert.strictEqual(document.getElementsByClassName('popup').length, 0);
});
