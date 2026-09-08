const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const dictionariesDisplayPath = require.resolve('../src/components/views/dictionaries_display');
const fileDialogPath = require.resolve('../src/components/views/file-dialog_display');
const blockedActionPath = require.resolve('../src/components/views/blocked-action_display');
const { installBridge, uninstallBridge } = require('./fake-bridge');

function tempDir(prefix){
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeDictFixture(dir, id, words){
  var dictDir = path.join(dir, 'dictionaries');
  fs.mkdirSync(dictDir, { recursive: true });
  fs.writeFileSync(path.join(dictDir, id + '.aff'), 'SET UTF-8\n', 'utf8');
  fs.writeFileSync(path.join(dictDir, id + '.dic'), words.length + '\n' + words.join('\n') + '\n', 'utf8');
}

//dictionaries_display.js requires showFileDialog and showBlockedActionAlert at require-time, so
//these mocks only take effect if the cache is primed before the module is (re-)required - same
//pattern as settings_display.test.js's freshSettingsDisplay().
function freshDictionariesDisplay(mocks){
  delete require.cache[dictionariesDisplayPath];
  require.cache[fileDialogPath] = {
    id: fileDialogPath, filename: fileDialogPath, loaded: true,
    exports: mocks.showFileDialog || function(){}
  };
  require.cache[blockedActionPath] = {
    id: blockedActionPath, filename: blockedActionPath, loaded: true,
    exports: mocks.showBlockedActionAlert || function(){}
  };
  return require(dictionariesDisplayPath);
}

function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

function makeUserSettings(overrides){
  var saved = [];
  var settings = Object.assign({
    spellcheckDictionaries: [],
    save: function(){ saved.push(true); return Promise.resolve(); }
  }, overrides);
  settings._saveCalls = saved;
  return settings;
}

function makeProject(overrides){
  return Object.assign({ projectDictionary: [], hasUnsavedChanges: false }, overrides);
}

function fieldsetByLegend(text){
  return Array.from(document.querySelectorAll('fieldset')).find(function(fs){
    var legend = fs.querySelector('legend');
    return legend != null && legend.innerText === text;
  });
}

function buttonIn(container, text){
  return Array.from(container.querySelectorAll('button')).find(function(b){
    return b.textContent === text;
  });
}

function optionValues(select){
  return Array.from(select.options).map(function(o){ return o.value; });
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[dictionariesDisplayPath];
  delete require.cache[fileDialogPath];
  delete require.cache[blockedActionPath];
  delete global.window;
  delete global.document;
  uninstallBridge();
});

test('list renders with source tags and ticks the saved selection', async function(t){
  const appDir = tempDir('warewoolf-dict-app-');
  const userDataDir = tempDir('warewoolf-dict-userdata-');
  writeDictFixture(appDir, 'en_US-large', ['hello']);
  writeDictFixture(appDir, 'en_us', ['hi']);
  writeDictFixture(userDataDir, 'fr_FR', ['bonjour']);
  installBridge({ paths: { app: appDir, userData: userDataDir, docs: '/docs', home: '/home' } });

  const showDictionaries = freshDictionariesDisplay({});
  const userSettings = makeUserSettings({ spellcheckDictionaries: ['en_us', 'fr_FR'] });
  await showDictionaries(userSettings, makeProject(), function(){});

  const rows = Array.from(document.querySelectorAll('.dictionary-row'));
  assert.strictEqual(rows.length, 3);

  function rowFor(id){
    return rows.find(function(r){ return r.querySelector('label').innerText.indexOf(id) === 0; });
  }

  assert.strictEqual(rowFor('en_US-large').querySelector('label').innerText, 'en_US-large (bundled)');
  assert.strictEqual(rowFor('en_us').querySelector('label').innerText, 'en_us (bundled)');
  assert.strictEqual(rowFor('fr_FR').querySelector('label').innerText, 'fr_FR (imported)');

  assert.strictEqual(rowFor('en_US-large').querySelector('input').checked, false);
  assert.strictEqual(rowFor('en_us').querySelector('input').checked, true);
  assert.strictEqual(rowFor('fr_FR').querySelector('input').checked, true);
});

test('ticking and saving writes the array', async function(t){
  const appDir = tempDir('warewoolf-dict-app-');
  const userDataDir = tempDir('warewoolf-dict-userdata-');
  writeDictFixture(appDir, 'en_US-large', ['hello']);
  writeDictFixture(appDir, 'en_us', ['hi']);
  installBridge({ paths: { app: appDir, userData: userDataDir, docs: '/docs', home: '/home' } });

  const showDictionaries = freshDictionariesDisplay({});
  const userSettings = makeUserSettings({ spellcheckDictionaries: ['en_US-large'] });
  await showDictionaries(userSettings, makeProject(), function(){});

  var rows = Array.from(document.querySelectorAll('.dictionary-row'));
  var enUsRow = rows.find(function(r){ return r.querySelector('label').innerText.indexOf('en_us (') === 0; });
  enUsRow.querySelector('input').checked = true;

  await buttonIn(document, 'Save').onclick();

  assert.deepStrictEqual(userSettings.spellcheckDictionaries.slice().sort(), ['en_US-large', 'en_us']);
  assert.strictEqual(userSettings._saveCalls.length, 1);
});

test('the filter narrows the word list and updates its count', async function(t){
  const appDir = tempDir('warewoolf-dict-app-');
  const userDataDir = tempDir('warewoolf-dict-userdata-');
  fs.mkdirSync(path.join(userDataDir, 'dictionaries'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'dictionaries', 'personal.dic'), 'Dorrigo\nDorset\nAurelion\n', 'utf8');
  installBridge({ paths: { app: appDir, userData: userDataDir, docs: '/docs', home: '/home' } });

  const showDictionaries = freshDictionariesDisplay({});
  await showDictionaries(makeUserSettings(), makeProject(), function(){});

  var personalFieldset = fieldsetByLegend('Personal Dictionary');
  var filterInput = personalFieldset.querySelector('input[type=text]');
  var listbox = personalFieldset.querySelector('select');
  var countLine = personalFieldset.querySelector('p.sublabel');

  assert.strictEqual(optionValues(listbox).length, 3);
  assert.strictEqual(countLine.innerText, '(3 of 3)');

  filterInput.value = 'dor';
  filterInput.oninput();

  assert.deepStrictEqual(optionValues(listbox).sort(), ['Dorrigo', 'Dorset']);
  assert.strictEqual(countLine.innerText, '(2 of 3)');
});

test('Add, Edit and Delete mutate the pending word list', async function(t){
  const appDir = tempDir('warewoolf-dict-app-');
  const userDataDir = tempDir('warewoolf-dict-userdata-');
  fs.mkdirSync(path.join(userDataDir, 'dictionaries'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'dictionaries', 'personal.dic'), 'WareWoolf\n', 'utf8');
  installBridge({ paths: { app: appDir, userData: userDataDir, docs: '/docs', home: '/home' } });

  const showDictionaries = freshDictionariesDisplay({});
  await showDictionaries(makeUserSettings(), makeProject(), function(){});

  var personalFieldset = fieldsetByLegend('Personal Dictionary');
  var filterInput = personalFieldset.querySelector('input[type=text]');
  var listbox = personalFieldset.querySelector('select');

  //Add
  filterInput.value = 'Nebula';
  filterInput.oninput();
  buttonIn(personalFieldset, 'Add').onclick();
  assert.deepStrictEqual(optionValues(listbox).sort(), ['Nebula', 'WareWoolf']);

  //Edit
  Array.from(listbox.options).find(function(o){ return o.value === 'Nebula'; }).selected = true;
  listbox.onchange();
  buttonIn(personalFieldset, 'Edit').onclick();
  assert.strictEqual(filterInput.value, 'Nebula');
  filterInput.value = 'Nebulon';
  buttonIn(personalFieldset, 'Save Word').onclick();
  assert.deepStrictEqual(optionValues(listbox).sort(), ['Nebulon', 'WareWoolf']);

  //Delete
  Array.from(listbox.options).find(function(o){ return o.value === 'Nebulon'; }).selected = true;
  listbox.onchange();
  buttonIn(personalFieldset, 'Delete').onclick();
  assert.deepStrictEqual(optionValues(listbox), ['WareWoolf']);
});

test('Save calls savePersonalDictionary with exactly the resulting words and assigns the project list', async function(t){
  const appDir = tempDir('warewoolf-dict-app-');
  const userDataDir = tempDir('warewoolf-dict-userdata-');
  fs.mkdirSync(path.join(userDataDir, 'dictionaries'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'dictionaries', 'personal.dic'), 'WareWoolf\n', 'utf8');
  installBridge({ paths: { app: appDir, userData: userDataDir, docs: '/docs', home: '/home' } });

  const showDictionaries = freshDictionariesDisplay({});
  var project = makeProject({ projectDictionary: ['Aurelion'] });
  await showDictionaries(makeUserSettings(), project, function(){});

  var personalFieldset = fieldsetByLegend('Personal Dictionary');
  var filterInput = personalFieldset.querySelector('input[type=text]');
  filterInput.value = 'Nebula';
  filterInput.oninput();
  buttonIn(personalFieldset, 'Add').onclick();

  var projectFieldset = fieldsetByLegend('Project Dictionary');
  var projFilterInput = projectFieldset.querySelector('input[type=text]');
  projFilterInput.value = 'Dorrigo';
  projFilterInput.oninput();
  buttonIn(projectFieldset, 'Add').onclick();

  await buttonIn(document, 'Save').onclick();

  var personalOnDisk = fs.readFileSync(path.join(userDataDir, 'dictionaries', 'personal.dic'), 'utf8')
    .split('\n').filter(function(w){ return w.trim() !== ''; });
  assert.deepStrictEqual(personalOnDisk.sort(), ['Nebula', 'WareWoolf']);

  assert.deepStrictEqual(project.projectDictionary.slice().sort(), ['Aurelion', 'Dorrigo']);
  assert.strictEqual(project.hasUnsavedChanges, true);
});

test('Close calls nothing and leaves the project clean', async function(t){
  const appDir = tempDir('warewoolf-dict-app-');
  const userDataDir = tempDir('warewoolf-dict-userdata-');
  fs.mkdirSync(path.join(userDataDir, 'dictionaries'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'dictionaries', 'personal.dic'), 'WareWoolf\n', 'utf8');
  installBridge({ paths: { app: appDir, userData: userDataDir, docs: '/docs', home: '/home' } });

  const showDictionaries = freshDictionariesDisplay({});
  var project = makeProject({ projectDictionary: ['Aurelion'] });
  var callbackCalls = 0;
  await showDictionaries(makeUserSettings(), project, function(){ callbackCalls++; });

  var personalFieldset = fieldsetByLegend('Personal Dictionary');
  var filterInput = personalFieldset.querySelector('input[type=text]');
  filterInput.value = 'Nebula';
  filterInput.oninput();
  buttonIn(personalFieldset, 'Add').onclick();

  buttonIn(document, 'Close').onclick();

  var personalOnDisk = fs.readFileSync(path.join(userDataDir, 'dictionaries', 'personal.dic'), 'utf8')
    .split('\n').filter(function(w){ return w.trim() !== ''; });
  assert.deepStrictEqual(personalOnDisk, ['WareWoolf']);
  assert.deepStrictEqual(project.projectDictionary, ['Aurelion']);
  assert.strictEqual(project.hasUnsavedChanges, false);
  assert.strictEqual(callbackCalls, 0);
  assert.strictEqual(document.querySelector('.popup'), null);
});

test('the project fieldset is replaced by a note with no project open', async function(t){
  const appDir = tempDir('warewoolf-dict-app-');
  const userDataDir = tempDir('warewoolf-dict-userdata-');
  installBridge({ paths: { app: appDir, userData: userDataDir, docs: '/docs', home: '/home' } });

  const showDictionaries = freshDictionariesDisplay({});
  await showDictionaries(makeUserSettings(), null, function(){});

  var projectFieldset = fieldsetByLegend('Project Dictionary');
  assert.ok(projectFieldset, 'expected the project fieldset to still exist');
  assert.strictEqual(projectFieldset.querySelector('select'), null);
  assert.strictEqual(projectFieldset.querySelector('button'), null,
    'no Add/Edit/Delete/Import Word List buttons without a project open');
  assert.ok(projectFieldset.querySelector('p').innerText.length > 0);
});

//---------------------------------------------------------------------------
// import failure - writes nothing at any of the three steps
//---------------------------------------------------------------------------

function fakeFileDialog(paths){
  return function(options, callback){ callback(paths); };
}

test('import failure: a missing .dic is reported and nothing is written', async function(t){
  const appDir = tempDir('warewoolf-dict-app-');
  const userDataDir = tempDir('warewoolf-dict-userdata-');
  installBridge({ paths: { app: appDir, userData: userDataDir, docs: '/docs', home: '/home' } });

  var pickedDir = tempDir('warewoolf-dict-picked-');
  var affPath = path.join(pickedDir, 'orphan.aff').replaceAll('\\', '/');
  fs.writeFileSync(affPath, 'SET UTF-8\n', 'utf8');

  var alerts = [];
  const showDictionaries = freshDictionariesDisplay({
    showFileDialog: fakeFileDialog([affPath]),
    showBlockedActionAlert: function(message){ alerts.push(message); }
  });

  await showDictionaries(makeUserSettings(), makeProject(), function(){});
  await buttonIn(fieldsetByLegend('Spellcheck Dictionaries'), 'Import...').onclick();

  assert.strictEqual(alerts.length, 1);
  assert.match(alerts[0], /No matching \.dic file/);
  assert.strictEqual(fs.existsSync(path.join(userDataDir, 'dictionaries', 'orphan.aff')), false);
});

test('import failure: a .dic with no usable words is reported and nothing is written', async function(t){
  const appDir = tempDir('warewoolf-dict-app-');
  const userDataDir = tempDir('warewoolf-dict-userdata-');
  installBridge({ paths: { app: appDir, userData: userDataDir, docs: '/docs', home: '/home' } });

  var pickedDir = tempDir('warewoolf-dict-picked-');
  var dicPath = path.join(pickedDir, 'empty.dic').replaceAll('\\', '/');
  fs.writeFileSync(dicPath, '0\n', 'utf8');

  var alerts = [];
  const showDictionaries = freshDictionariesDisplay({
    showFileDialog: fakeFileDialog([dicPath]),
    showBlockedActionAlert: function(message){ alerts.push(message); }
  });

  await showDictionaries(makeUserSettings(), makeProject(), function(){});
  await buttonIn(fieldsetByLegend('Spellcheck Dictionaries'), 'Import...').onclick();

  assert.strictEqual(alerts.length, 1);
  assert.match(alerts[0], /does not look like a usable dictionary/);
  assert.strictEqual(fs.existsSync(path.join(userDataDir, 'dictionaries', 'empty.aff')), false);
  assert.strictEqual(fs.existsSync(path.join(userDataDir, 'dictionaries', 'empty.dic')), false);
});

test('import failure: a colliding id is refused and nothing is overwritten', async function(t){
  const appDir = tempDir('warewoolf-dict-app-');
  const userDataDir = tempDir('warewoolf-dict-userdata-');
  writeDictFixture(appDir, 'en_US-large', ['hello']);
  installBridge({ paths: { app: appDir, userData: userDataDir, docs: '/docs', home: '/home' } });

  var pickedDir = tempDir('warewoolf-dict-picked-');
  var dicPath = path.join(pickedDir, 'en_US-large.dic').replaceAll('\\', '/');
  fs.writeFileSync(dicPath, '1\nhowdy\n', 'utf8');

  var alerts = [];
  const showDictionaries = freshDictionariesDisplay({
    showFileDialog: fakeFileDialog([dicPath]),
    showBlockedActionAlert: function(message){ alerts.push(message); }
  });

  await showDictionaries(makeUserSettings(), makeProject(), function(){});
  await buttonIn(fieldsetByLegend('Spellcheck Dictionaries'), 'Import...').onclick();

  assert.strictEqual(alerts.length, 1);
  assert.match(alerts[0], /already exists/);
  assert.strictEqual(
    fs.readFileSync(path.join(appDir, 'dictionaries', 'en_US-large.dic'), 'utf8'),
    '1\nhello\n');
});
