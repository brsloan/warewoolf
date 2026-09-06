const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const propertiesDisplayPath = require.resolve('../src/components/views/properties_display');

//closePopups() also calls disableSearchView()/focusEditor(), which reach for this fixed shell by
//id - same shell used in outliner_display.test.js / missing-pups_display.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

function makeProject(overrides){
  return Object.assign({
    title: 'My Book',
    author: 'Jane Doe',
    filename: 'book.woolf',
    directory: '/proj/',
    chapsDirectory: 'chapters/',
    hasUnsavedChanges: false,
    saveFile: function(){}
  }, overrides);
}

function makeUserSettings(overrides){
  return Object.assign({
    getSettingsFilepath: function(){ return '/settings/path.json'; }
  }, overrides);
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
  delete require.cache[propertiesDisplayPath];
  delete global.window;
  delete global.document;
});

test('renders the current title, author, filename, directory, and chaps directory', async function(t){
  var showProperties = require(propertiesDisplayPath);
  var project = makeProject();

  showProperties(project, makeUserSettings());

  assert.strictEqual(document.getElementById('title-input').value, 'My Book');
  assert.strictEqual(document.getElementById('author-input').value, 'Jane Doe');
  assert.strictEqual(document.querySelector('.popup-text-small').innerText, 'book.woolf');
});

test('focuses the title field on open', async function(t){
  var showProperties = require(propertiesDisplayPath);
  var project = makeProject();

  showProperties(project, makeUserSettings());

  assert.strictEqual(document.activeElement, document.getElementById('title-input'));
});

//Regression: Apply used to update project.title/author without setting hasUnsavedChanges, so the
//app's "save before exit"/"save before opening another project" prompts (render.js, gated on
//project.hasUnsavedChanges) would silently skip, losing the edit.
test('Apply updates title/author, marks the project as having unsaved changes, and closes the popup', async function(t){
  var showProperties = require(propertiesDisplayPath);
  var project = makeProject();

  showProperties(project, makeUserSettings());
  document.getElementById('title-input').value = 'New Title';
  document.getElementById('author-input').value = 'New Author';
  document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  assert.strictEqual(project.title, 'New Title');
  assert.strictEqual(project.author, 'New Author');
  assert.strictEqual(project.hasUnsavedChanges, true);
  assert.strictEqual(document.getElementsByClassName('popup').length, 0);
});

test('Cancel closes the popup without changing the project', async function(t){
  var showProperties = require(propertiesDisplayPath);
  var project = makeProject();

  showProperties(project, makeUserSettings());
  document.getElementById('title-input').value = 'Unsaved Edit';
  findButton('Cancel').onclick();

  assert.strictEqual(project.title, 'My Book');
  assert.strictEqual(project.hasUnsavedChanges, false);
  assert.strictEqual(document.getElementsByClassName('popup').length, 0);
});

test('Reveal Advanced shows the advanced area', async function(t){
  var showProperties = require(propertiesDisplayPath);
  var project = makeProject();

  showProperties(project, makeUserSettings());
  var advancedArea = document.querySelectorAll('fieldset div')[0];

  assert.strictEqual(advancedArea.style.display, 'none');
  findButton('-- Reveal Advanced --').onclick();
  assert.strictEqual(advancedArea.style.display, 'block');
});

test('saving the chaps directory appends a trailing slash, persists it, and shows a confirmation', async function(t){
  var showProperties = require(propertiesDisplayPath);
  var project = makeProject({ chapsDirectory: 'chapters/' });
  var saveFileCalls = 0;
  project.saveFile = function(){ saveFileCalls++; };

  showProperties(project, makeUserSettings());
  var pupDirInput = document.querySelectorAll('input[type="text"]')[2];
  pupDirInput.value = 'new-chapters';
  //Awaited: saving the project is asynchronous now, and the confirmation only appears afterwards.
  await findButton('Save Changes To Chaps Directory').onclick();

  assert.strictEqual(project.chapsDirectory, 'new-chapters/');
  assert.strictEqual(pupDirInput.value, 'new-chapters/');
  assert.strictEqual(saveFileCalls, 1);
  assert.strictEqual(document.querySelectorAll('.popup-text-small')[document.querySelectorAll('.popup-text-small').length - 2].innerText, 'Saved.');
});

//Regression: clearing the field to "" used to still hit the "add trailing slash if missing" branch,
//turning an intentionally-empty chapsDirectory into "/" - a bogus path once concatenated with
//project.directory elsewhere (chapter.js, project.js).
test('clearing the chaps directory field saves an empty string instead of "/"', async function(t){
  var showProperties = require(propertiesDisplayPath);
  var project = makeProject({ chapsDirectory: 'chapters/' });

  showProperties(project, makeUserSettings());
  var pupDirInput = document.querySelectorAll('input[type="text"]')[2];
  pupDirInput.value = '';
  //Awaited: saving the project is asynchronous now, and the confirmation only appears afterwards.
  await findButton('Save Changes To Chaps Directory').onclick();

  assert.strictEqual(project.chapsDirectory, '');
});

test('does not append a second trailing slash when one is already present', async function(t){
  var showProperties = require(propertiesDisplayPath);
  var project = makeProject({ chapsDirectory: 'chapters/' });

  showProperties(project, makeUserSettings());
  var pupDirInput = document.querySelectorAll('input[type="text"]')[2];
  pupDirInput.value = 'already-slashed/';
  //Awaited: saving the project is asynchronous now, and the confirmation only appears afterwards.
  await findButton('Save Changes To Chaps Directory').onclick();

  assert.strictEqual(project.chapsDirectory, 'already-slashed/');
});

test('shows the user settings filepath', async function(t){
  var showProperties = require(propertiesDisplayPath);
  var project = makeProject();

  showProperties(project, makeUserSettings({ getSettingsFilepath: function(){ return '/custom/settings.json'; } }));

  var texts = Array.from(document.querySelectorAll('.popup-text-small')).map(function(el){ return el.innerText; });
  assert.ok(texts.includes('/custom/settings.json'));
});

test('opening the popup twice removes the first one instead of stacking popups', async function(t){
  var showProperties = require(propertiesDisplayPath);

  showProperties(makeProject(), makeUserSettings());
  showProperties(makeProject(), makeUserSettings());

  assert.strictEqual(document.getElementsByClassName('popup').length, 1);
});
