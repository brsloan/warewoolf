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
  var countLine = personalFieldset.querySelector('.word-list-count');

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
  buttonIn(personalFieldset, 'Save').onclick();
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

//---------------------------------------------------------------------------
// An empty selection must survive being looked at
//---------------------------------------------------------------------------

//An empty spellcheckDictionaries means "whatever this version ships as its default", which is what
//lets a default changed in a later release reach a writer who never opened this dialog. The
//fallback is ticked here as a display convenience, so saving it back as a literal id would quietly
//destroy that for anyone who opened the dialog once and clicked Save.
test('opening with an empty selection and saving untouched leaves it empty', async function(t){
  const appDir = tempDir('warewoolf-dict-app-');
  const userDataDir = tempDir('warewoolf-dict-userdata-');
  writeDictFixture(appDir, 'en_US-large', ['hello']);
  writeDictFixture(appDir, 'en_us', ['hi']);
  installBridge({ paths: { app: appDir, userData: userDataDir, docs: '/docs', home: '/home' } });

  const showDictionaries = freshDictionariesDisplay({});
  const userSettings = makeUserSettings({ spellcheckDictionaries: [] });
  await showDictionaries(userSettings, makeProject(), function(){});

  //Ticked on screen, so the writer can see which dictionary is actually in use...
  var fallbackRow = Array.from(document.querySelectorAll('.dictionary-row')).find(function(r){
    return r.querySelector('label').innerText.indexOf('en_US-large (') === 0;
  });
  assert.strictEqual(fallbackRow.querySelector('input').checked, true);

  await buttonIn(document, 'Save').onclick();

  //...but not written back as a pin.
  assert.deepStrictEqual(userSettings.spellcheckDictionaries, []);
});

test('ticking a box from an empty selection saves the whole visible selection', async function(t){
  const appDir = tempDir('warewoolf-dict-app-');
  const userDataDir = tempDir('warewoolf-dict-userdata-');
  writeDictFixture(appDir, 'en_US-large', ['hello']);
  writeDictFixture(appDir, 'en_us', ['hi']);
  installBridge({ paths: { app: appDir, userData: userDataDir, docs: '/docs', home: '/home' } });

  const showDictionaries = freshDictionariesDisplay({});
  const userSettings = makeUserSettings({ spellcheckDictionaries: [] });
  await showDictionaries(userSettings, makeProject(), function(){});

  //click(), not `.checked = true`: the dialog learns the selection was touched from the change
  //event, which only a real activation fires.
  Array.from(document.querySelectorAll('.dictionary-row')).find(function(r){
    return r.querySelector('label').innerText.indexOf('en_us (') === 0;
  }).querySelector('input').click();

  await buttonIn(document, 'Save').onclick();

  assert.deepStrictEqual(userSettings.spellcheckDictionaries.slice().sort(), ['en_US-large', 'en_us']);
});

//---------------------------------------------------------------------------
// Editing a word onto one already in the list
//---------------------------------------------------------------------------

test('renaming a word onto an existing one collapses the two instead of duplicating', async function(t){
  const appDir = tempDir('warewoolf-dict-app-');
  const userDataDir = tempDir('warewoolf-dict-userdata-');
  fs.mkdirSync(path.join(userDataDir, 'dictionaries'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'dictionaries', 'personal.dic'), 'cat\ndog\n', 'utf8');
  installBridge({ paths: { app: appDir, userData: userDataDir, docs: '/docs', home: '/home' } });

  const showDictionaries = freshDictionariesDisplay({});
  await showDictionaries(makeUserSettings(), makeProject(), function(){});

  var personalFieldset = fieldsetByLegend('Personal Dictionary');
  var filterInput = personalFieldset.querySelector('input[type=text]');
  var listbox = personalFieldset.querySelector('select');

  Array.from(listbox.options).find(function(o){ return o.value === 'cat'; }).selected = true;
  listbox.onchange();
  buttonIn(personalFieldset, 'Edit').onclick();
  filterInput.value = 'dog';
  buttonIn(personalFieldset, 'Save').onclick();

  assert.deepStrictEqual(optionValues(listbox), ['dog']);
});

//The other half of the same guard: a writer who opens Edit and saves the word unchanged finds it
//already in the list at its own index, which is not a duplicate to collapse.
test('opening Edit and saving a word unchanged keeps it', async function(t){
  const appDir = tempDir('warewoolf-dict-app-');
  const userDataDir = tempDir('warewoolf-dict-userdata-');
  fs.mkdirSync(path.join(userDataDir, 'dictionaries'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'dictionaries', 'personal.dic'), 'cat\ndog\n', 'utf8');
  installBridge({ paths: { app: appDir, userData: userDataDir, docs: '/docs', home: '/home' } });

  const showDictionaries = freshDictionariesDisplay({});
  await showDictionaries(makeUserSettings(), makeProject(), function(){});

  var personalFieldset = fieldsetByLegend('Personal Dictionary');
  var listbox = personalFieldset.querySelector('select');

  Array.from(listbox.options).find(function(o){ return o.value === 'cat'; }).selected = true;
  listbox.onchange();
  buttonIn(personalFieldset, 'Edit').onclick();
  buttonIn(personalFieldset, 'Save').onclick();

  assert.deepStrictEqual(optionValues(listbox).sort(), ['cat', 'dog']);
});

//---------------------------------------------------------------------------
// Keyboard handling in the filter/word field
//---------------------------------------------------------------------------

function seedPersonalDict(userDataDir, words){
  fs.mkdirSync(path.join(userDataDir, 'dictionaries'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'dictionaries', 'personal.dic'), words.join('\n') + '\n', 'utf8');
}

function editorParts(legend){
  var fieldset = fieldsetByLegend(legend);
  return {
    fieldset: fieldset,
    input: fieldset.querySelector('input[type=text]'),
    listbox: fieldset.querySelector('select'),
    count: fieldset.querySelector('.word-list-count'),
    primary: fieldset.querySelector('.word-list-buttons button')
  };
}

function keydownOn(el, key){
  var event = new window.KeyboardEvent('keydown', { key: key, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event;
}

function typeInto(input, value){
  input.value = value;
  input.oninput();
}

function selectWord(parts, word){
  Array.from(parts.listbox.options).find(function(o){ return o.value === word; }).selected = true;
  parts.listbox.onchange();
}

async function openPersonalEditor(words){
  const appDir = tempDir('warewoolf-dict-app-');
  const userDataDir = tempDir('warewoolf-dict-userdata-');
  seedPersonalDict(userDataDir, words);
  installBridge({ paths: { app: appDir, userData: userDataDir, docs: '/docs', home: '/home' } });

  const showDictionaries = freshDictionariesDisplay({});
  await showDictionaries(makeUserSettings(), makeProject(), function(){});
  return editorParts('Personal Dictionary');
}

//"No matches" rather than "no exact match" is the line: with "dor" typed and Dorset in the list the
//writer is still narrowing, and Enter adding "dor" there would be an entry nobody asked for.
test('Enter adds the typed word when the filter has matched nothing', async function(t){
  var parts = await openPersonalEditor(['Dorset']);

  typeInto(parts.input, 'Nebula');
  assert.strictEqual(parts.count.innerText, '(0 of 1)');
  keydownOn(parts.input, 'Enter');

  assert.deepStrictEqual(optionValues(parts.listbox).sort(), ['Dorset', 'Nebula']);
  assert.strictEqual(parts.input.value, '');
});

test('Enter does nothing while the filter is still narrowing', async function(t){
  var parts = await openPersonalEditor(['Dorset']);

  typeInto(parts.input, 'dor');
  assert.strictEqual(parts.count.innerText, '(1 of 1)');
  keydownOn(parts.input, 'Enter');

  assert.deepStrictEqual(optionValues(parts.listbox), ['Dorset']);
  assert.strictEqual(parts.input.value, 'dor', 'the filter should be left alone');
});

test('Enter commits the edit in progress', async function(t){
  var parts = await openPersonalEditor(['cat', 'dog']);

  selectWord(parts, 'cat');
  buttonIn(parts.fieldset, 'Edit').onclick();
  parts.input.value = 'cattle';
  keydownOn(parts.input, 'Enter');

  assert.deepStrictEqual(optionValues(parts.listbox).sort(), ['cattle', 'dog']);
});

//---------------------------------------------------------------------------
// Add becomes Save, and cancelling without a Cancel button
//---------------------------------------------------------------------------

test('the Add button becomes Save while editing and goes back afterwards', async function(t){
  var parts = await openPersonalEditor(['cat']);

  assert.strictEqual(parts.primary.textContent, 'Add');

  selectWord(parts, 'cat');
  buttonIn(parts.fieldset, 'Edit').onclick();

  assert.strictEqual(parts.primary.textContent, 'Save');
  assert.strictEqual(buttonIn(parts.fieldset, 'Edit').disabled, true,
    'Edit acts on the list selection, not on the edit in progress');
  assert.strictEqual(buttonIn(parts.fieldset, 'Delete').disabled, true);
  //Neither of the buttons this replaces should exist any more.
  assert.strictEqual(buttonIn(parts.fieldset, 'Save Word'), undefined);
  assert.strictEqual(buttonIn(parts.fieldset, 'Cancel Edit'), undefined);

  parts.primary.onclick();

  assert.strictEqual(parts.primary.textContent, 'Add');
});

//Escape has to cancel the edit and stop there - keybindings.js closes every popup on Escape, so an
//unstopped one would take the whole dialog with the edit.
test('Escape while editing cancels the edit without closing the dialog', async function(t){
  var parts = await openPersonalEditor(['cat', 'dog']);

  selectWord(parts, 'cat');
  buttonIn(parts.fieldset, 'Edit').onclick();
  parts.input.value = 'cattle';

  //Asserted by watching for it at the document, where keybindings.js listens, rather than by
  //reading a flag off the event - what matters is that the global handler never sees it.
  var reachedDocument = 0;
  document.addEventListener('keydown', function(){ reachedDocument++; });

  var event = keydownOn(parts.input, 'Escape');

  assert.strictEqual(event.defaultPrevented, true);
  assert.strictEqual(reachedDocument, 0,
    'Escape must not reach the global handler that closes every popup');
  assert.deepStrictEqual(optionValues(parts.listbox).sort(), ['cat', 'dog'],
    'the edit is abandoned, not applied');
  assert.strictEqual(parts.primary.textContent, 'Add');
  assert.strictEqual(document.querySelectorAll('.popup').length, 1);
});

//An Escape that is not cancelling an edit is the writer closing the dialog, and must travel.
test('Escape outside an edit is left to the global handler', async function(t){
  var parts = await openPersonalEditor(['cat']);

  var event = keydownOn(parts.input, 'Escape');

  assert.strictEqual(event.defaultPrevented, false);
});

test('leaving the field abandons the edit', async function(t){
  var parts = await openPersonalEditor(['cat', 'dog']);

  selectWord(parts, 'cat');
  buttonIn(parts.fieldset, 'Edit').onclick();
  parts.input.value = 'cattle';

  parts.listbox.focus();

  assert.deepStrictEqual(optionValues(parts.listbox).sort(), ['cat', 'dog']);
  assert.strictEqual(parts.primary.textContent, 'Add');
});

//The one departure that is not an abandonment: without this, clicking Save would blur the input and
//throw the edit away before the click that meant to commit it ever ran.
test('moving focus to the Save button does not abandon the edit', async function(t){
  var parts = await openPersonalEditor(['cat', 'dog']);

  selectWord(parts, 'cat');
  buttonIn(parts.fieldset, 'Edit').onclick();
  parts.input.value = 'cattle';

  parts.primary.focus();
  parts.primary.onclick();

  assert.deepStrictEqual(optionValues(parts.listbox).sort(), ['cattle', 'dog']);
});

//---------------------------------------------------------------------------
// Layout and shortcuts
//---------------------------------------------------------------------------

test('the count sits beside the filter, and the buttons beside the list', async function(t){
  var parts = await openPersonalEditor(['cat']);

  assert.strictEqual(parts.count.parentNode, parts.input.parentNode,
    'the count belongs on the filter row, not under the list');
  assert.strictEqual(parts.count.parentNode.classList.contains('word-list-header'), true);

  var buttonColumn = parts.fieldset.querySelector('.word-list-buttons');
  assert.strictEqual(buttonColumn.parentNode, parts.listbox.parentNode);
  assert.strictEqual(buttonColumn.parentNode.classList.contains('word-list-body'), true);
  assert.deepStrictEqual(
    Array.from(buttonColumn.querySelectorAll('button')).map(function(b){ return b.textContent; }),
    ['Add', 'Edit', 'Delete']);
});

test('opening the dialog puts focus on Import', async function(t){
  const appDir = tempDir('warewoolf-dict-app-');
  const userDataDir = tempDir('warewoolf-dict-userdata-');
  writeDictFixture(appDir, 'en_US-large', ['hello']);
  installBridge({ paths: { app: appDir, userData: userDataDir, docs: '/docs', home: '/home' } });

  const showDictionaries = freshDictionariesDisplay({});
  await showDictionaries(makeUserSettings(), makeProject(), function(){});

  assert.strictEqual(document.activeElement, buttonIn(document, 'Import...'));
});

//An accessKey has to be unique across the page to be reachable at all, which is why the two Delete
//buttons do not both answer to Alt+D.
test('Delete, Save and Close carry distinct access keys', async function(t){
  const appDir = tempDir('warewoolf-dict-app-');
  const userDataDir = tempDir('warewoolf-dict-userdata-');
  seedPersonalDict(userDataDir, ['cat']);
  installBridge({ paths: { app: appDir, userData: userDataDir, docs: '/docs', home: '/home' } });

  const showDictionaries = freshDictionariesDisplay({});
  await showDictionaries(makeUserSettings(), makeProject(), function(){});

  assert.strictEqual(buttonIn(fieldsetByLegend('Personal Dictionary'), 'Delete').accessKey, 'd');
  assert.strictEqual(buttonIn(fieldsetByLegend('Project Dictionary'), 'Delete').accessKey, 't');
  assert.strictEqual(buttonIn(document, 'Save').accessKey, 's');
  assert.strictEqual(buttonIn(document, 'Close').accessKey, 'c');

  var keys = Array.from(document.querySelectorAll('button'))
    .map(function(b){ return b.accessKey; })
    .filter(function(k){ return k !== ''; });
  assert.strictEqual(new Set(keys).size, keys.length,
    'every access key in the dialog has to be unique or it is not reachable');

  //The marked letter has to be the one the accessKey answers to, or the underline points at nothing.
  assert.strictEqual(fieldsetByLegend('Project Dictionary')
    .querySelector('.word-list-buttons .access-key').textContent, 't');
});
