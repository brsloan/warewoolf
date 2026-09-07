const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const settingsDisplayPath = require.resolve('../src/components/views/settings_display');
const fileDialogPath = require.resolve('../src/components/views/file-dialog_display');

//settings_display.js requires showFileDialog from file-dialog_display.js at require-time, so this
//mock only takes effect if the cache is primed with it before settings_display.js is (re-)required -
//same pattern as compile_display.test.js's freshCompileDisplay()/export_display.test.js's
//freshExportDisplay().
function freshSettingsDisplay(mocks){
  delete require.cache[settingsDisplayPath];
  require.cache[fileDialogPath] = { id: fileDialogPath, filename: fileDialogPath, loaded: true, exports: mocks.showFileDialog || function(){} };
  return require(settingsDisplayPath);
}

//closePopups() (called on Save and Close) also calls disableSearchView()/focusEditor(), which reach
//for this fixed shell by id - same shell used in properties_display.test.js/export_display.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

function makeUserSettings(overrides){
  return Object.assign({
    defaultAuthor: 'Jane Doe',
    addressInfo: '',
    backupDirectory: null,
    autoBackup: true,
    backupsToKeep: 10,
    autosaveIntMinutes: 5,
    darkMode: 'system',
    showBattery: false,
    save: function(){}
  }, overrides);
}

function sysDirectories(){
  return { docs: '/docs', home: '/home' };
}

function platformInfo(overrides){
  return Object.assign({ platform: 'linux', arch: 'x64' }, overrides);
}

function findButton(text){
  return Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent === text; });
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[settingsDisplayPath];
  delete require.cache[fileDialogPath];
  delete global.window;
  delete global.document;
});

//Regression: promptToChooseDirectory() called showFileDialog without the module ever requiring
//file-dialog_display.js, so clicking "Change..." threw "showFileDialog is not defined" instead of
//opening the picker.
test('clicking Change... opens the directory picker and applies the chosen path', function(t){
  var showFileDialogCalls = [];
  var showFileDialog = function(options, callback){
    showFileDialogCalls.push(options);
    callback('/chosen/backups');
  };

  var showSettings = freshSettingsDisplay({ showFileDialog: showFileDialog });
  showSettings(makeUserSettings(), { updateAutosave: function(){} }, sysDirectories(), function(){}, function(){}, platformInfo());

  findButton('Change...').onclick();

  assert.strictEqual(showFileDialogCalls.length, 1);
  assert.strictEqual(showFileDialogCalls[0].title, 'Choose Backups Directory...');
  assert.strictEqual(document.getElementById('backup-dir-input').value, '/chosen/backups');
});

//Regression: the Save handler referenced a bare `saveProject` identifier that was never defined,
//imported, or passed into this module (it's a private top-level function in render.js, a different
//module scope), so clicking Save always threw "saveProject is not defined" - after userSettings.save()
//had already run, but before callback()/closePopups() could, leaving the popup stuck open.
test('Save reschedules autosave with the real saveProject callback and closes the popup', function(t){
  var showSettings = freshSettingsDisplay({});
  var userSettings = makeUserSettings({ autosaveIntMinutes: 7 });

  var updateAutosaveCalls = [];
  var autosaver = { updateAutosave: function(minutes, save){ updateAutosaveCalls.push({ minutes, save }); } };

  var saveProject = function(){};
  var callbackCalls = 0;
  var callback = function(){ callbackCalls++; };

  showSettings(userSettings, autosaver, sysDirectories(), saveProject, callback, platformInfo());
  findButton('Save').onclick();

  assert.strictEqual(updateAutosaveCalls.length, 1);
  assert.strictEqual(updateAutosaveCalls[0].minutes, 7);
  assert.strictEqual(updateAutosaveCalls[0].save, saveProject, 'autosaver should be rescheduled with the actual saveProject function');
  assert.strictEqual(callbackCalls, 1);
  assert.strictEqual(document.getElementsByClassName('popup').length, 0);
});

//Regression: backupsToKeep was written back from the raw (string) input.value instead of being
//coerced to a Number, unlike the identical autosaveIntMinutes field right next to it. Since
//user-settings.js's applySettings() only re-applies a loaded value when typeof matches the
//{type: 'number'} schema, a saved string value would silently fail to load back in and revert to
//the default on the next app start.
test('Save coerces backupsToKeep to a Number', function(t){
  var showSettings = freshSettingsDisplay({});
  var userSettings = makeUserSettings();

  showSettings(userSettings, { updateAutosave: function(){} }, sysDirectories(), function(){}, function(){}, platformInfo());
  document.querySelectorAll('.number-ticker')[0].value = '25';
  findButton('Save').onclick();

  assert.strictEqual(userSettings.backupsToKeep, 25);
  assert.strictEqual(typeof userSettings.backupsToKeep, 'number');
});

//Regression: only the radio matching the exact stored darkMode value was ever checked, so an
//unrecognized value (e.g. a hand-edited settings file) left no radio checked at all. Saving then
//called `.value` on the null result of querySelector('...:checked'), throwing instead of saving.
test('an unrecognized darkMode value falls back to System Default instead of leaving no radio checked', function(t){
  var showSettings = freshSettingsDisplay({});
  var userSettings = makeUserSettings({ darkMode: 'some-future-value' });

  showSettings(userSettings, { updateAutosave: function(){} }, sysDirectories(), function(){}, function(){}, platformInfo());

  assert.strictEqual(document.getElementById('dark-mode-sys').checked, true);
  assert.strictEqual(document.getElementById('dark-mode-dark').checked, false);
  assert.strictEqual(document.getElementById('dark-mode-light').checked, false);

  assert.doesNotThrow(function(){
    findButton('Save').onclick();
  });
  assert.strictEqual(userSettings.darkMode, 'system');
});

test('a recognized darkMode value is still checked and round-trips on Save', function(t){
  var showSettings = freshSettingsDisplay({});
  var userSettings = makeUserSettings({ darkMode: 'dark' });

  showSettings(userSettings, { updateAutosave: function(){} }, sysDirectories(), function(){}, function(){}, platformInfo());

  assert.strictEqual(document.getElementById('dark-mode-dark').checked, true);
  assert.strictEqual(document.getElementById('dark-mode-sys').checked, false);

  findButton('Save').onclick();

  assert.strictEqual(userSettings.darkMode, 'dark');
});
