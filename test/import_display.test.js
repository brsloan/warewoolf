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
  var htmlOptionsSet = document.getElementById('html-split-chaps-check').closest('fieldset');
  var epubOptionsSet = document.getElementById('epub-strip-boilerplate-check').closest('fieldset');

  function assertEnabled(enabled){
    assert.deepStrictEqual({
      plaintext: !plainTextOptionsSet.disabled,
      docx: !docxOptionsSet.disabled,
      html: !htmlOptionsSet.disabled,
      epub: !epubOptionsSet.disabled
    }, enabled);
  }

  assertEnabled({ plaintext: false, docx: true, html: false, epub: false });

  checkAndFireChange(document.getElementById('txtSelect'));
  assertEnabled({ plaintext: true, docx: false, html: false, epub: false });

  checkAndFireChange(document.getElementById('mdfcSelect'));
  assertEnabled({ plaintext: false, docx: false, html: false, epub: false });

  checkAndFireChange(document.getElementById('htmlSelect'));
  assertEnabled({ plaintext: false, docx: false, html: true, epub: false });

  checkAndFireChange(document.getElementById('epubSelect'));
  assertEnabled({ plaintext: false, docx: false, html: false, epub: true });

  checkAndFireChange(document.getElementById('docxSelect'));
  assertEnabled({ plaintext: false, docx: true, html: false, epub: false });
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

function captureSubmittedOptions(prepare, fileTypeId){
  var capturedOptions;
  var showImportOptions = freshImportDisplay({
    initiateImport: function(sysDirectories, options){
      capturedOptions = options;
    }
  });

  showImportOptions({ docs: '/proj/docs' }, function(){}, function(){});
  checkAndFireChange(document.getElementById(fileTypeId || 'htmlSelect'));

  if(prepare)
    prepare();

  document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  return capturedOptions;
}

test('the HTML file type offers every extension a book arrives with', function(t){
  var capturedOptions = captureSubmittedOptions();

  assert.strictEqual(capturedOptions.fileType.id, 'htmlSelect');
  assert.deepStrictEqual(capturedOptions.fileType.extensions, ['html', 'htm', 'xhtml']);
});

//Level 2 by default rather than the docx importer's fixed level 1: an HTML book puts its title in
//<h1> and its chapter titles in <h2>, so level 1 would import the whole book as a single chapter.
test('submitting with HTML selected builds htmlOptions, defaulting to a level two heading split', function(t){
  var capturedOptions = captureSubmittedOptions();

  assert.deepStrictEqual(capturedOptions.htmlOptions, {
    splitChapters: { headingLevel: 2, atRules: false },
    stripBoilerplate: false,
    chapLabels: 'firstLine'
  });
});

//The converter reads a null heading level as "do not split at headings", which is what leaves
//splitting at horizontal rules free to be chosen on its own. Sending the selected level regardless
//of the checkbox would make the checkbox do nothing at all.
test('unticking the heading split sends a null level rather than the one still shown in the selector', function(t){
  var capturedOptions = captureSubmittedOptions(function(){
    document.getElementById('html-heading-level-select').value = '3';
    document.getElementById('html-split-chaps-check').checked = false;
    document.getElementById('html-split-rules-check').checked = true;
  });

  assert.deepStrictEqual(capturedOptions.htmlOptions.splitChapters, {
    headingLevel: null,
    atRules: true
  });
});

test('the selected heading level and the boilerplate option reach the controller', function(t){
  var capturedOptions = captureSubmittedOptions(function(){
    document.getElementById('html-heading-level-select').value = '3';
    document.getElementById('html-strip-boilerplate-check').checked = true;
  });

  assert.strictEqual(capturedOptions.htmlOptions.splitChapters.headingLevel, 3);
  assert.strictEqual(capturedOptions.htmlOptions.stripBoilerplate, true);
});

test('the EPUB file type is offered and filters on the epub extension', function(t){
  var capturedOptions = captureSubmittedOptions(null, 'epubSelect');

  assert.strictEqual(capturedOptions.fileType.id, 'epubSelect');
  assert.deepStrictEqual(capturedOptions.fileType.extensions, ['epub']);
});

//An epub needs no split options: its own table of contents says where the chapters are and what they
//are called, which is better than anything this dialog could ask for. So the fieldset carries only
//the two choices that are genuinely the writer's.
test('submitting with EPUB selected builds epubOptions, defaulting to using the book metadata', function(t){
  var capturedOptions = captureSubmittedOptions(null, 'epubSelect');

  assert.deepStrictEqual(capturedOptions.epubOptions, {
    stripBoilerplate: false,
    useMetadata: true,
    chapLabels: 'firstLine'
  });
});

test('the EPUB boilerplate and metadata choices reach the controller', function(t){
  var capturedOptions = captureSubmittedOptions(function(){
    document.getElementById('epub-strip-boilerplate-check').checked = true;
    document.getElementById('epub-use-metadata-check').checked = false;
  }, 'epubSelect');

  assert.strictEqual(capturedOptions.epubOptions.stripBoilerplate, true);
  assert.strictEqual(capturedOptions.epubOptions.useMetadata, false);
});

test('the chapter label choice is shared by every file type, EPUB included', function(t){
  var capturedOptions = captureSubmittedOptions(function(){
    document.getElementById('chapLabelFilename').checked = true;
  }, 'epubSelect');

  assert.strictEqual(capturedOptions.epubOptions.chapLabels, 'filename');
});
