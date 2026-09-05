const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const exportDisplayPath = require.resolve('../src/components/views/export_display');
const fileDialogPath = require.resolve('../src/components/views/file-dialog_display');
const workingDisplayPath = require.resolve('../src/components/views/working_display');
const exportPath = require.resolve('../src/components/controllers/export');

//export_display.js destructures/imports showFileDialog, showWorkingAndThen/showWorking/hideWorking
//and exportProject from their modules at require-time, so these mocks only take effect if the
//cache is primed with them before export_display.js is (re-)required - same pattern as
//compile_display.test.js's freshCompileDisplay(), extended to cover working_display's third export.
function freshExportDisplay(mocks){
  delete require.cache[exportDisplayPath];
  require.cache[fileDialogPath] = { id: fileDialogPath, filename: fileDialogPath, loaded: true, exports: mocks.showFileDialog };
  require.cache[workingDisplayPath] = { id: workingDisplayPath, filename: workingDisplayPath, loaded: true, exports: {
    showWorkingAndThen: mocks.showWorkingAndThen,
    showWorking: mocks.showWorking || function(){},
    hideWorking: mocks.hideWorking
  } };
  require.cache[exportPath] = { id: exportPath, filename: exportPath, loaded: true, exports: { exportProject: mocks.exportProject } };
  return require(exportDisplayPath);
}

//closePopups() (called once the export finishes) also calls disableSearchView() and
//focusEditor(), which reach for this fixed set of app-shell elements by id - same shell used in
//convert-tabs-display.test.js and utils.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

function sysDirectories(){
  return { docs: '/docs', home: '/home' };
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[exportDisplayPath];
  delete require.cache[fileDialogPath];
  delete require.cache[workingDisplayPath];
  delete require.cache[exportPath];
  delete global.window;
  delete global.document;
});

//Regression: exportProject writes .docx/.epub chapters asynchronously, so getExportFilePath used
//to call exportProject then immediately close the popup, before those writes had actually
//finished. It should now show a working indicator (deferred so it can paint before the possibly
//slow export runs) and only close once exportProject's own completion callback fires.
test('the working indicator and popup stay up until exportProject actually finishes', function(t){
  var project = { title: 'My Novel', chapters: [] };
  var userSettings = {};

  var showFileDialog = function(dialogOptions, callback){
    callback('/docs/My Novel');
  };

  var showWorkingAndThenCalls = 0;
  var hideWorkingCalls = 0;
  var capturedExportArgs = null;

  var exportProject = function(project, userSettings, options, filepath, cback){
    capturedExportArgs = { project, userSettings, options, filepath, cback };
    //Deliberately do NOT call cback() yet - simulates an in-flight async write (docx/epub).
  };

  var showExportOptions = freshExportDisplay({
    showFileDialog: showFileDialog,
    showWorkingAndThen: function(status, cb){ showWorkingAndThenCalls++; cb(); },
    hideWorking: function(){ hideWorkingCalls++; },
    exportProject: exportProject
  });

  showExportOptions(project, userSettings, sysDirectories());
  document.querySelector('form').onsubmit({ preventDefault: function(){} });

  assert.strictEqual(showWorkingAndThenCalls, 1, 'the working indicator should show while exporting');
  assert.ok(capturedExportArgs, 'exportProject should have been called');
  assert.strictEqual(capturedExportArgs.project, project);
  assert.strictEqual(capturedExportArgs.userSettings, userSettings);
  assert.strictEqual(capturedExportArgs.filepath, '/docs/My Novel');
  assert.strictEqual(hideWorkingCalls, 0, 'hideWorking must not run before exportProject calls back');
  assert.ok(document.querySelector('.popup'), 'popup must stay open while the export is in flight');

  capturedExportArgs.cback(0);

  assert.strictEqual(hideWorkingCalls, 1, 'hideWorking should run once exportProject calls back');
  assert.strictEqual(document.querySelector('.popup'), null, 'popup should close once exportProject calls back');
});

//Regression: every error inside exportProject was only ever logged internally - the popup closed
//the same way whether every chapter exported fine or every chapter failed, giving the user no
//sign anything went wrong. When exportProject reports a nonzero error count, the working
//indicator's status should be updated to say so before it (and the popup) close.
test('a nonzero error count from exportProject updates the working status before closing', function(t){
  var showFileDialog = function(dialogOptions, callback){ callback('/docs/My Novel'); };

  var statusMessages = [];
  var hideWorkingCalls = 0;
  var capturedExportCback = null;

  var showExportOptions = freshExportDisplay({
    showFileDialog: showFileDialog,
    showWorkingAndThen: function(status, cb){ cb(); },
    showWorking: function(status){ statusMessages.push(status); },
    hideWorking: function(){ hideWorkingCalls++; },
    exportProject: function(project, userSettings, options, filepath, cback){ capturedExportCback = cback; }
  });

  showExportOptions({ title: 'My Novel', chapters: [] }, {}, sysDirectories());
  document.querySelector('form').onsubmit({ preventDefault: function(){} });

  //Mock timers must be enabled before the code under test schedules its setTimeout, or that call
  //captures the real timer and the mock's tick() below has nothing to advance.
  t.mock.timers.enable({ apis: ['setTimeout'] });

  capturedExportCback(2);

  assert.strictEqual(statusMessages.length, 1, 'expected the working status to be updated with an error summary');
  assert.match(statusMessages[0], /2 files failed to export/);
  assert.strictEqual(hideWorkingCalls, 0, 'hideWorking should not fire immediately so the user has a chance to read the status');

  t.mock.timers.tick(2500);

  assert.strictEqual(hideWorkingCalls, 1, 'hideWorking should fire after the error summary has been shown');
  assert.strictEqual(document.querySelector('.popup'), null, 'popup should close after the error summary has been shown');
});

//Singular/plural wording: one failed file should read "1 file failed", not "1 files failed".
test('a single export failure is reported in the singular', function(t){
  var showFileDialog = function(dialogOptions, callback){ callback('/docs/My Novel'); };
  var statusMessages = [];
  var capturedExportCback = null;

  var showExportOptions = freshExportDisplay({
    showFileDialog: showFileDialog,
    showWorkingAndThen: function(status, cb){ cb(); },
    showWorking: function(status){ statusMessages.push(status); },
    hideWorking: function(){},
    exportProject: function(project, userSettings, options, filepath, cback){ capturedExportCback = cback; }
  });

  showExportOptions({ title: 'My Novel', chapters: [] }, {}, sysDirectories());
  document.querySelector('form').onsubmit({ preventDefault: function(){} });

  //Enabled before scheduling (see the previous test) and ticked forward so the real setTimeout
  //this triggers can't fire later, after the DOM globals this test's afterEach tears down are gone.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  capturedExportCback(1);
  t.mock.timers.tick(2500);

  assert.match(statusMessages[0], /1 file failed to export/);
});

//Cancelling the "choose a directory" dialog (dirpath is falsy) should never call exportProject,
//and should still close the export options popup.
test('cancelling the directory chooser closes the popup without exporting', function(t){
  var exportProjectCalls = 0;

  var showExportOptions = freshExportDisplay({
    showFileDialog: function(dialogOptions, callback){ callback(undefined); },
    showWorkingAndThen: function(status, cb){ cb(); },
    hideWorking: function(){},
    exportProject: function(){ exportProjectCalls++; }
  });

  showExportOptions({ title: 'My Novel', chapters: [] }, {}, sysDirectories());
  document.querySelector('form').onsubmit({ preventDefault: function(){} });

  assert.strictEqual(exportProjectCalls, 0);
  assert.strictEqual(document.querySelector('.popup'), null);
});
