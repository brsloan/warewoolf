const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const { assertDialogDescribed, assertControlsNamed } = require('./helpers');

//What assistive technology is told about the app's popups and page regions.
//
//Every popup is a hand-built <div class="popup">. Until describeDialog() (controllers/utils.js)
//existed none of them carried a role or a name, so a screen reader announced a dialog opening as
//nothing at all, and read whatever was behind it as if the dialog were not there. This file
//covers the helper itself, the popups whose constructors need nothing but a callback, and - the
//part that keeps the rest honest - a source-level guard: any view that builds a popup has to
//call describeDialog(), or this fails naming the file. The views with heavier constructors are
//checked in their own test files with the same two helpers.

const VIEWS_DIR = path.join(__dirname, '..', 'src', 'components', 'views');

//The ids closePopups()/focusEditor() reach for, so a view that tidies up on open does not throw.
function bodyShell(){
  return '<div id="chapter-list-sidebar">' +
      '<h1 id="chapters-header">Chapters</h1><ul id="chapter-list"></ul>' +
      '<h1 id="reference-header">Reference</h1><ul id="reference-list"></ul>' +
      '<h1 id="trash-header">Trash</h1><ul id="trash-list"></ul>' +
    '</div>' +
    '<div id="writing-field"><div id="editor-container"><div class="ql-editor"></div></div></div>' +
    '<div id="project-notes"></div>';
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete global.window;
  delete global.document;
});

// -------------------------------------------------------------------------------------------
// describeDialog itself
// -------------------------------------------------------------------------------------------

test('describeDialog names a popup by its heading, giving the heading an id when it has none', function(){
  const { describeDialog } = require('../src/components/controllers/utils');
  var popup = document.createElement('div');
  var heading = document.createElement('h1');
  heading.textContent = 'Word Count';
  popup.appendChild(heading);
  document.body.appendChild(popup);

  describeDialog(popup, heading);

  assert.strictEqual(popup.getAttribute('role'), 'dialog');
  assert.strictEqual(popup.getAttribute('aria-modal'), 'true');
  assert.ok(heading.id, 'the heading needs an id for aria-labelledby to point at');
  assert.strictEqual(popup.getAttribute('aria-labelledby'), heading.id);
  assertDialogDescribed(popup, 'dialog');
});

test('describeDialog keeps a heading id the view already chose', function(){
  const { describeDialog } = require('../src/components/controllers/utils');
  var popup = document.createElement('div');
  var heading = document.createElement('p');
  heading.id = 'backup-alert-text';
  heading.textContent = 'Backing up...';
  popup.appendChild(heading);
  document.body.appendChild(popup);

  describeDialog(popup, heading);

  assert.strictEqual(heading.id, 'backup-alert-text');
  assert.strictEqual(popup.getAttribute('aria-labelledby'), 'backup-alert-text');
});

test('describeDialog gives two unnamed headings two different ids', function(){
  const { describeDialog } = require('../src/components/controllers/utils');
  var ids = [1, 2].map(function(){
    var popup = document.createElement('div');
    var heading = document.createElement('h1');
    heading.textContent = 'Settings';
    popup.appendChild(heading);
    document.body.appendChild(popup);
    describeDialog(popup, heading);
    return heading.id;
  });

  assert.notStrictEqual(ids[0], ids[1]);
});

test('describeDialog takes a string for a popup with no heading, and a role for the ones that interrupt', function(){
  const { describeDialog } = require('../src/components/controllers/utils');
  var popup = document.createElement('div');
  document.body.appendChild(popup);

  describeDialog(popup, 'Corkboard', 'alertdialog');

  assert.strictEqual(popup.getAttribute('role'), 'alertdialog');
  assert.strictEqual(popup.getAttribute('aria-label'), 'Corkboard');
  assert.strictEqual(popup.getAttribute('aria-labelledby'), null);
  assertDialogDescribed(popup, 'alertdialog');
});

// -------------------------------------------------------------------------------------------
// The guard: no popup without a description
// -------------------------------------------------------------------------------------------

test('every view that builds a popup describes it', function(){
  var offenders = fs.readdirSync(VIEWS_DIR).filter(function(name){
    if(!name.endsWith('.js'))
      return false;
    var source = fs.readFileSync(path.join(VIEWS_DIR, name), 'utf8');
    var buildsPopup = /classList\.add\((['"])popup(-dialog)?\1/.test(source)
      || /classList\.add\("popup",/.test(source)
      || /classList\.add\("popup-dialog",/.test(source);
    return buildsPopup && source.indexOf('describeDialog(') === -1;
  });

  assert.deepStrictEqual(offenders, [], 'these views build a popup and never call describeDialog()');
});

// -------------------------------------------------------------------------------------------
// The popups that need only a callback
// -------------------------------------------------------------------------------------------

test('the delete confirmation is an alert dialog named by its warning', function(){
  require('../src/components/views/delete-confirmation_display')(function(){});

  var popup = document.querySelector('.delete-confirm-popup');
  assertDialogDescribed(popup, 'alertdialog');
  assertControlsNamed(popup);
});

test('the exit confirmation is an alert dialog named by its warning', function(){
  require('../src/components/views/exit-confirmation_display')(function(){}, function(){});

  var popup = document.querySelector('.popup');
  assertDialogDescribed(popup, 'alertdialog');
  assertControlsNamed(popup);
});

test('the new project prompt is a dialog and its title field is labelled', function(){
  require('../src/components/views/new-project_display')(function(){});

  var popup = document.querySelector('.popup');
  assertDialogDescribed(popup, 'dialog');
  assert.ok(assertControlsNamed(popup) >= 1, 'the prompt should have a title field to check');
});

test('the blocked-action alert is named by the message it shows', function(){
  require('../src/components/views/blocked-action_display')('The Help document is read-only.');

  var popup = document.getElementById('blocked-action-alert');
  assertDialogDescribed(popup, 'alertdialog');
  assert.strictEqual(document.getElementById(popup.getAttribute('aria-labelledby')).innerText, 'The Help document is read-only.');
});

test('the project load failure report is an alert dialog', function(){
  require('../src/components/views/project-load-error_display')('/proj/book.woolf', new Error('Unexpected end of JSON input'));

  var popup = document.querySelector('.popup');
  assertDialogDescribed(popup, 'alertdialog');
});

test('the startup failure report is an alert dialog', function(){
  require('../src/components/views/startup-error_display')(new Error('boom'));

  var popup = document.querySelector('.popup');
  assertDialogDescribed(popup, 'alertdialog');
});

test('the working popup is a polite status region, and its picture is decorative', function(){
  const { showWorking } = require('../src/components/views/working_display');
  showWorking('Exporting...');

  var popup = document.querySelector('.working-popup');
  assert.strictEqual(popup.getAttribute('role'), 'status');
  assert.strictEqual(popup.getAttribute('aria-live'), 'polite');
  assert.strictEqual(popup.querySelector('img').getAttribute('alt'), '');
});

// -------------------------------------------------------------------------------------------
// The chapter list
// -------------------------------------------------------------------------------------------

function makeListProject(){
  return {
    chapters: [{ title: 'One', hasUnsavedChanges: false }, { title: 'Two', hasUnsavedChanges: false }],
    reference: [],
    trash: [],
    activeChapterIndex: 1
  };
}

test('the active chapter row is marked aria-current and the others are not', function(){
  const { renderChapterList } = require('../src/components/views/chapter-list_display');
  renderChapterList(makeListProject(), { onSelect: function(){}, onRename: function(){} });

  var rows = Array.from(document.querySelectorAll('#chapter-list li'));
  assert.deepStrictEqual(rows.map(function(r){ return r.getAttribute('aria-current'); }), [null, 'true']);
});

test('the rename box has a name, since its label is the row it replaces', function(){
  const { renderChapterList, renameChapterInList } = require('../src/components/views/chapter-list_display');
  var handlers = { onSelect: function(){}, onRename: function(){} };
  renderChapterList(makeListProject(), handlers);

  renameChapterInList(0, handlers);

  var box = document.querySelector('.name-box');
  assert.ok(box, 'renaming should put a text box in the row');
  assert.strictEqual(box.getAttribute('aria-label'), 'Chapter title');
});
