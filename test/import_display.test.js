const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const importDisplayPath = require.resolve('../src/components/views/import_display');
const importControllerPath = require.resolve('../src/components/controllers/import');

//import_display.js destructures initiateImport from the import controller at require-time, so
//mocking it only takes effect if the cache is primed before import_display.js is (re-)required -
//same pattern as file-dialog_display.test.js.
function freshImportDisplay(mocks){
  delete require.cache[importDisplayPath];
  require.cache[importControllerPath] = {
    id: importControllerPath,
    filename: importControllerPath,
    loaded: true,
    exports: {
      initiateImport: mocks.initiateImport
    }
  };
  return require(importDisplayPath);
}

//closePopups() (run on submit/cancel) also calls disableSearchView()/focusEditor(), which reach
//for this fixed shell by id - same shell used in file-dialog_display.test.js /
//corkboard_display.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div><div id="project-notes"></div><div id="writing-field"></div>';
}

function checkAndFireChange(radio){
  radio.checked = true;
  radio.dispatchEvent(new window.Event('change', { bubbles: true }));
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[importDisplayPath];
  delete require.cache[importControllerPath];
  delete global.window;
  delete global.document;
});

test('initial state: Docx is selected, its options are enabled, and the plaintext options are disabled', function(t){
  var showImportOptions = freshImportDisplay({ initiateImport: function(){} });

  showImportOptions({}, function(){}, function(){});

  assert.strictEqual(document.getElementById('docxSelect').checked, true);
  var docxOptionsSet = document.getElementById('docx-split-chaps-check').closest('fieldset');
  var plainTextOptionsSet = document.getElementById('convert-italics-check').closest('fieldset');
  assert.strictEqual(docxOptionsSet.disabled, false);
  assert.strictEqual(plainTextOptionsSet.disabled, true);
});

test('the italics marker input is placed exactly once, inside the plaintext options table', function(t){
  //Regression test: the field used to be appended directly to the fieldset and then immediately
  //moved into the options table by generateRow(), which was harmless only because appendChild()
  //moves rather than clones nodes. Guard against that dead append coming back (or the row-move
  //ever being dropped and leaving the field duplicated or mis-placed outside the table).
  var showImportOptions = freshImportDisplay({ initiateImport: function(){} });

  showImportOptions({}, function(){}, function(){});

  var matches = document.querySelectorAll('#italics-str-input');
  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].closest('table') !== null, true);
  assert.strictEqual(matches[0].parentNode.tagName, 'TD');
});

test('switching the file type toggles which options fieldset is enabled', function(t){
  var showImportOptions = freshImportDisplay({ initiateImport: function(){} });

  showImportOptions({}, function(){}, function(){});

  var docxOptionsSet = document.getElementById('docx-split-chaps-check').closest('fieldset');
  var plainTextOptionsSet = document.getElementById('convert-italics-check').closest('fieldset');

  checkAndFireChange(document.getElementById('txtSelect'));
  assert.strictEqual(plainTextOptionsSet.disabled, false);
  assert.strictEqual(docxOptionsSet.disabled, true);

  checkAndFireChange(document.getElementById('mdfcSelect'));
  assert.strictEqual(plainTextOptionsSet.disabled, true);
  assert.strictEqual(docxOptionsSet.disabled, true);

  checkAndFireChange(document.getElementById('docxSelect'));
  assert.strictEqual(plainTextOptionsSet.disabled, true);
  assert.strictEqual(docxOptionsSet.disabled, false);
});

test('submitting builds an options object matching the selected file type and passes it to initiateImport', function(t){
  var capturedOptions;
  var showImportOptions = freshImportDisplay({
    initiateImport: function(sysDirectories, options, addImportedChapter, onFinish){
      capturedOptions = options;
    }
  });

  showImportOptions({ docs: '/proj/docs' }, function(){}, function(){});

  checkAndFireChange(document.getElementById('txtSelect'));
  document.getElementById('italics-str-input').value = '_';
  document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  assert.strictEqual(capturedOptions.fileType.id, 'txtSelect');
  assert.strictEqual(capturedOptions.txtOptions.convertItalics.marker, '_');
  assert.strictEqual(capturedOptions.txtOptions.chapLabels, 'firstLine');
});
