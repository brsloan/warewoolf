const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { assertDialogDescribed, assertControlsNamed } = require('./helpers');
const { DEFAULT_FONT_ID, getFontDefs, resolveFontStack } = require('../src/components/models/fonts');

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
    autocorrectEnabled: true,
    autocorrect: {},
    editorFont: DEFAULT_FONT_ID,
    sidebarFont: DEFAULT_FONT_ID,
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

//---------------------------------------------------------------------------
// automatic substitutions
//---------------------------------------------------------------------------

function openSettings(userSettings){
  var showSettings = freshSettingsDisplay({});
  showSettings(userSettings, { updateAutosave: function(){} }, sysDirectories(), function(){}, function(){}, platformInfo());
  return userSettings;
}

test('every substitution rule gets a checkbox, showing what is actually in force', function(t){
  openSettings(makeUserSettings({ autocorrect: { emDash: false } }));

  //Shown as the defaults with the writer's one change over them, not as the stored override alone.
  assert.strictEqual(document.getElementById('autocorrect-smartDoubleQuotes').checked, true);
  assert.strictEqual(document.getElementById('autocorrect-smartSingleQuotes').checked, true);
  assert.strictEqual(document.getElementById('autocorrect-ellipsis').checked, true);
  assert.strictEqual(document.getElementById('autocorrect-emDash').checked, false);
});

test('the master switch reflects the stored setting and greys the rules out while it is off', function(t){
  openSettings(makeUserSettings({ autocorrectEnabled: false }));

  assert.strictEqual(document.getElementById('autocorrect-check').checked, false);
  assert.strictEqual(document.getElementById('autocorrect-emDash').disabled, true);
  assert.strictEqual(document.getElementById('autocorrect-ellipsis').disabled, true);
});

test('turning the master switch on releases the individual rules', function(t){
  openSettings(makeUserSettings({ autocorrectEnabled: false }));

  var master = document.getElementById('autocorrect-check');
  master.checked = true;
  master.onchange();

  assert.strictEqual(document.getElementById('autocorrect-emDash').disabled, false);
});

//Greyed out, not cleared: a writer who switches substitutions off and on again gets back the rules
//they had chosen rather than the defaults.
test('the rules a writer chose survive the master switch being turned off and saved', function(t){
  var userSettings = openSettings(makeUserSettings({ autocorrect: { emDash: false } }));

  document.getElementById('autocorrect-check').checked = false;
  findButton('Save').onclick();

  assert.strictEqual(userSettings.autocorrectEnabled, false);
  assert.deepStrictEqual(userSettings.autocorrect, { emDash: false });
});

test('Save stores only the rules that differ from their defaults', function(t){
  var userSettings = openSettings(makeUserSettings());

  document.getElementById('autocorrect-ellipsis').checked = false;
  findButton('Save').onclick();

  assert.strictEqual(userSettings.autocorrectEnabled, true);
  assert.deepStrictEqual(userSettings.autocorrect, { ellipsis: false });
});

test('Save stores nothing at all when every rule is left on its default', function(t){
  var userSettings = openSettings(makeUserSettings({ autocorrect: { emDash: false } }));

  document.getElementById('autocorrect-emDash').checked = true;
  findButton('Save').onclick();

  assert.deepStrictEqual(userSettings.autocorrect, {});
});

//What a screen reader is told: the popup is a dialog named "Settings", and every field has a
//label it can read out - the Default Author, Auto Backup, backups-to-keep and autosave fields
//used to sit beside label text that pointed at nothing.
test('the Settings popup is a dialog and every field is labelled', function(){
  var showSettings = freshSettingsDisplay({});
  showSettings(makeUserSettings(), { updateAutosave: function(){} }, sysDirectories(), function(){}, function(){}, platformInfo());

  var popup = document.querySelector('.popup');
  assertDialogDescribed(popup, 'dialog');
  assert.ok(assertControlsNamed(popup) > 5, 'the settings form should have fields to check');
});

//---------------------------------------------------------------------------
// editor and sidebar fonts
//---------------------------------------------------------------------------

test('both font pickers offer every font WareWoolf knows about', function(){
  openSettings(makeUserSettings());

  var expected = getFontDefs().map(function(def){ return def.id; });

  ['editor-font-select', 'sidebar-font-select'].forEach(function(id){
    var options = Array.from(document.getElementById(id).options);

    assert.deepStrictEqual(options.map(function(o){ return o.value; }), expected);
    //innerText rather than textContent: the app sets it that way throughout, and jsdom keeps
    //innerText as a plain property without reflecting it into the node's text.
    assert.ok(options.every(function(o){ return o.innerText !== ''; }), 'every option should be named');
  });
});

//The list is its own specimen sheet: WareWoolf ships no font files, so drawing each option in the
//face it names is the only honest way to show a writer what they actually have installed.
test('each option is drawn in the face it names', function(){
  openSettings(makeUserSettings());

  var options = Array.from(document.getElementById('editor-font-select').options);

  getFontDefs().forEach(function(def, i){
    assert.strictEqual(options[i].style.fontFamily, def.stack);
  });
});

test('the pickers open on the fonts already in user settings', function(){
  openSettings(makeUserSettings({ editorFont: 'typewriter', sidebarFont: 'sans' }));

  assert.strictEqual(document.getElementById('editor-font-select').value, 'typewriter');
  assert.strictEqual(document.getElementById('sidebar-font-select').value, 'sans');
});

//A picker left showing its first option while the app is drawn in something else would be lying
//about the current state, and Save would then quietly change a setting the writer never touched.
test('a font id this version does not know falls back to the default rather than to the first option', function(){
  openSettings(makeUserSettings({ editorFont: 'some-font-from-the-future', sidebarFont: null }));

  assert.strictEqual(document.getElementById('editor-font-select').value, DEFAULT_FONT_ID);
  assert.strictEqual(document.getElementById('sidebar-font-select').value, DEFAULT_FONT_ID);
});

test('Save writes both font choices back to user settings', function(){
  var userSettings = openSettings(makeUserSettings());

  document.getElementById('editor-font-select').value = 'garamond';
  document.getElementById('sidebar-font-select').value = 'sans';
  findButton('Save').onclick();

  assert.strictEqual(userSettings.editorFont, 'garamond');
  assert.strictEqual(userSettings.sidebarFont, 'sans');
});

//The saved value goes straight into a css font-family declaration, so it is sanitized on the way
//out of the dialog as well as on the way in off disk.
test('Save sanitizes a font value that is not one of ours', function(){
  var userSettings = openSettings(makeUserSettings());

  var select = document.getElementById('editor-font-select');
  var smuggled = document.createElement('option');
  smuggled.value = 'nonsense; color: red';
  select.appendChild(smuggled);
  select.value = 'nonsense; color: red';

  findButton('Save').onclick();

  assert.strictEqual(userSettings.editorFont, DEFAULT_FONT_ID);
});

//Both samples collecting at the bottom of the fieldset would leave a writer to work out which of
//them answered which dropdown.
test('each sample sits in the row directly under its own picker', function(){
  openSettings(makeUserSettings());

  [['editor-font-select', 'editor-font-sample'], ['sidebar-font-select', 'sidebar-font-sample']].forEach(function(pair){
    var pickerRow = document.getElementById(pair[0]).closest('tr');
    var sampleRow = document.getElementById(pair[1]).closest('tr');

    assert.strictEqual(pickerRow.nextElementSibling, sampleRow);
    //Spanning the label column too, so the specimen gets the full width of the dialog to show in.
    assert.strictEqual(sampleRow.cells.length, 1);
    assert.strictEqual(sampleRow.cells[0].colSpan, 2);
  });
});

test('each picker has a sample line, drawn in the font that is selected', function(){
  openSettings(makeUserSettings({ editorFont: 'monospace', sidebarFont: 'times' }));

  var editorSample = document.getElementById('editor-font-sample');
  var sidebarSample = document.getElementById('sidebar-font-sample');

  assert.strictEqual(editorSample.style.fontFamily, resolveFontStack('monospace'));
  assert.strictEqual(sidebarSample.style.fontFamily, resolveFontStack('times'));
  //Said twice over by the selected option's own name; read aloud it is just a sentence about a fox.
  assert.strictEqual(editorSample.getAttribute('aria-hidden'), 'true');
});

test('the sample follows the picker before anything is saved', function(){
  openSettings(makeUserSettings());

  var select = document.getElementById('sidebar-font-select');
  select.value = 'dyslexic';
  select.dispatchEvent(new window.Event('change'));

  assert.strictEqual(document.getElementById('sidebar-font-sample').style.fontFamily, resolveFontStack('dyslexic'));
  //Only its own sample: the two settings are independent.
  assert.strictEqual(document.getElementById('editor-font-sample').style.fontFamily, resolveFontStack(DEFAULT_FONT_ID));
});
