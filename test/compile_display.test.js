const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const compileDisplayPath = require.resolve('../src/components/views/compile_display');
const fileDialogPath = require.resolve('../src/components/views/file-dialog_display');
const workingDisplayPath = require.resolve('../src/components/views/working_display');
const compilePath = require.resolve('../src/components/controllers/compile');

//compile_display.js destructures/imports showFileDialog, showWorking/hideWorking and compileProject
//from their modules at require-time, so these mocks only take effect if the cache is primed with
//them before compile_display.js is (re-)required - same pattern as battery_display.test.js's
//freshBatteryDisplay(), extended to cover a bare function export (showFileDialog).
function freshCompileDisplay(mocks){
  delete require.cache[compileDisplayPath];
  require.cache[fileDialogPath] = { id: fileDialogPath, filename: fileDialogPath, loaded: true, exports: mocks.showFileDialog };
  require.cache[workingDisplayPath] = { id: workingDisplayPath, filename: workingDisplayPath, loaded: true, exports: { showWorking: mocks.showWorking, hideWorking: mocks.hideWorking } };
  require.cache[compilePath] = { id: compilePath, filename: compilePath, loaded: true, exports: { compileProject: mocks.compileProject } };
  return require(compileDisplayPath);
}

function makeUserSettings(overrides){
  return Object.assign({
    compileType: '.docx',
    compileChapMark: '***',
    compileInsertHeaders: false,
    compileGenTitlePage: true,
    save: function(){}
  }, overrides);
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[compileDisplayPath];
  delete require.cache[fileDialogPath];
  delete require.cache[workingDisplayPath];
  delete require.cache[compilePath];
  delete global.window;
  delete global.document;
});

//Regression: getCompileFilepath used to be declared as a sibling of showCompileOptions rather than
//a nested closure, so the `project`/`userSettings` it passed to compileProject were undeclared free
//variables - compiling always threw a ReferenceError instead of ever calling compileProject.
test('submitting the compile form calls compileProject with the actual project and userSettings', function(t){
  var project = { title: 'My Novel', chapters: [] };
  var userSettings = makeUserSettings();
  var sysDirectories = { docs: '/docs', home: '/home' };

  var showFileDialogCalls = [];
  var showFileDialog = function(dialogOptions, callback){
    showFileDialogCalls.push(dialogOptions);
    callback('/docs/My Novel.docx');
  };

  var compileProjectCalls = [];
  var compileProject = function(project, userSettings, options, filepath, cback){
    compileProjectCalls.push({ project, userSettings, options, filepath });
    cback();
  };

  var showCompileOptions = freshCompileDisplay({
    showFileDialog: showFileDialog,
    showWorking: function(){},
    hideWorking: function(){},
    compileProject: compileProject
  });

  showCompileOptions(project, sysDirectories, userSettings);

  var form = document.querySelector('form');
  form.onsubmit({ preventDefault: function(){} });

  assert.strictEqual(compileProjectCalls.length, 1);
  assert.strictEqual(compileProjectCalls[0].project, project, 'compileProject should receive the real project object');
  assert.strictEqual(compileProjectCalls[0].userSettings, userSettings, 'compileProject should receive the real userSettings object');
  assert.strictEqual(compileProjectCalls[0].filepath, '/docs/My Novel.docx');
  assert.strictEqual(compileProjectCalls[0].options.type, '.docx');
});

//Regression: compile_display.js used to call hideWorking()/close the popup immediately after
//kicking off compileProject, with no regard for whether the compile had actually finished (fine for
//the synchronous formats, but wrong for .epub, which finishes writing asynchronously). It should
//only tear down the working indicator and popup once compileProject's own callback fires.
test('the working indicator and popup are only closed once compileProject finishes, not immediately', function(t){
  var project = { title: 'My Novel', chapters: [] };
  var userSettings = makeUserSettings();
  var sysDirectories = { docs: '/docs', home: '/home' };

  var showFileDialog = function(dialogOptions, callback){
    callback('/docs/My Novel.docx');
  };

  var showWorkingCalls = 0;
  var hideWorkingCalls = 0;
  var capturedCompileCallback = null;

  var compileProject = function(project, userSettings, options, filepath, cback){
    capturedCompileCallback = cback;
    //Deliberately do NOT call cback() yet - simulates an in-flight async compile (e.g. epub).
  };

  var showCompileOptions = freshCompileDisplay({
    showFileDialog: showFileDialog,
    showWorking: function(){ showWorkingCalls++; },
    hideWorking: function(){ hideWorkingCalls++; },
    compileProject: compileProject
  });

  showCompileOptions(project, sysDirectories, userSettings);
  document.querySelector('form').onsubmit({ preventDefault: function(){} });

  assert.strictEqual(showWorkingCalls, 1, 'showWorking should run while the compile is in flight');
  assert.strictEqual(hideWorkingCalls, 0, 'hideWorking must not run before compileProject calls back');
  assert.ok(document.querySelector('.popup'), 'popup must stay open while the compile is in flight');

  capturedCompileCallback();

  assert.strictEqual(hideWorkingCalls, 1, 'hideWorking should run once compileProject calls back');
  assert.strictEqual(document.querySelector('.popup'), null, 'popup should close once compileProject calls back');
});

//Regression: the "Generate Title Page" checkbox had no id and its label had no htmlFor, so unlike
//every other row in the form, clicking the label text did nothing.
test('the title-page checkbox is linked to its label via matching id/htmlFor', function(t){
  var project = { title: 'My Novel', chapters: [] };
  var userSettings = makeUserSettings();

  var showCompileOptions = freshCompileDisplay({
    showFileDialog: function(){},
    showWorking: function(){},
    hideWorking: function(){},
    compileProject: function(){}
  });

  showCompileOptions(project, { docs: '/docs', home: '/home' }, userSettings);

  var labels = Array.from(document.querySelectorAll('label'));
  var titlePageLabel = labels.find(function(l){ return l.innerText.indexOf('Generate Title Page') === 0; });

  assert.ok(titlePageLabel, 'expected to find the Generate Title Page label');
  assert.ok(titlePageLabel.htmlFor, 'label should have htmlFor set');

  var linkedCheckbox = document.getElementById(titlePageLabel.htmlFor);
  assert.ok(linkedCheckbox, 'label htmlFor should point at an existing element');
  assert.strictEqual(linkedCheckbox.type, 'checkbox');
});
