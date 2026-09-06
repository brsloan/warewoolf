const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const corkboardDisplayPath = require.resolve('../src/components/views/corkboard_display');
const corkboardControllerPath = require.resolve('../src/components/controllers/corkboard');

//corkboard_display.js destructures getCardsFromFile/saveCards from the corkboard controller at
//require-time, so mocking them only takes effect if the cache is primed before corkboard_display.js
//is (re-)required - same pattern as compile_display.test.js's freshCompileDisplay().
function freshCorkboardDisplay(mocks){
  delete require.cache[corkboardDisplayPath];
  require.cache[corkboardControllerPath] = {
    id: corkboardControllerPath,
    filename: corkboardControllerPath,
    loaded: true,
    exports: { getCardsFromFile: mocks.getCardsFromFile, saveCards: mocks.saveCards }
  };
  return require(corkboardDisplayPath);
}

//closePopups() (run on a plain Escape) also calls disableSearchView() and focusEditor(), which reach
//for this fixed set of app-shell elements by id - same shell used in convert-tabs-display.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

//showCorkboard() holds on to the project it is given, so every later keyboard handler acts on the
//same object these tests pass in - no global involved.
function makeProject(overrides){
  return Object.assign({
    directory: '/proj/',
    chapsDirectory: 'chaps/',
    corkboardColumns: 2,
    saveFile: function(){}
  }, overrides);
}

function platformInfo(overrides){
  return Object.assign({ platform: 'linux', arch: 'x64' }, overrides);
}

function keydown(target, key, modifiers){
  target.dispatchEvent(new window.KeyboardEvent('keydown', Object.assign({
    key: key,
    bubbles: true,
    cancelable: true
  }, modifiers)));
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[corkboardDisplayPath];
  delete require.cache[corkboardControllerPath];
  delete global.window;
  delete global.document;
});

test('renders loaded cards into the requested number of columns with their label/description/color/checkmark', function(t){
  var cards = [
    { label: 'One', descr: 'First', color: 0, checked: false },
    { label: 'Two', descr: 'Second', color: '2', checked: true },
    { label: 'Three', descr: 'Third', color: 0, checked: false }
  ];
  var getCardsFromFileCalls = [];
  var showCorkboard = freshCorkboardDisplay({
    getCardsFromFile: function(path){ getCardsFromFileCalls.push(path); return cards; },
    saveCards: function(){}
  });
  var project = makeProject({ corkboardColumns: 2 });

  showCorkboard(project, platformInfo());

  assert.strictEqual(getCardsFromFileCalls[0], '/proj/chaps/');
  assert.strictEqual(document.getElementsByClassName('corkboard-column').length, 2);
  assert.strictEqual(document.getElementById('card-label1').value, 'One');
  assert.strictEqual(document.getElementById('card-descr1').value, 'First');
  assert.strictEqual(document.getElementById('card-label1').disabled, false);
  assert.ok(document.getElementById('card2').classList.contains('corkboard-color2'));
  assert.ok(document.getElementById('card-checkmark2').classList.contains('card-checkmark-checked'));
});

test('shows a single blank starter card when no cards exist yet', function(t){
  var showCorkboard = freshCorkboardDisplay({
    getCardsFromFile: function(){ return undefined; },
    saveCards: function(){}
  });
  var project = makeProject({ corkboardColumns: 1 });

  showCorkboard(project, platformInfo());

  assert.strictEqual(document.getElementById('card-label1').value, '');
  assert.strictEqual(document.getElementById('card-label1').disabled, false);
  assert.strictEqual(document.getElementById('card2'), null, 'a single starter card should only need one slot');
});

test('focuses the last checked card on open, when it is not the final card', function(t){
  var cards = [
    { label: 'A', descr: '', checked: false },
    { label: 'B', descr: '', checked: true },
    { label: 'C', descr: '', checked: false }
  ];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  var project = makeProject({ corkboardColumns: 1 });

  showCorkboard(project, platformInfo());

  assert.strictEqual(document.activeElement.id, 'card-label2');
});

test('focuses the first card when the last card is the last one checked', function(t){
  var cards = [
    { label: 'A', descr: '', checked: false },
    { label: 'B', descr: '', checked: true }
  ];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  var project = makeProject({ corkboardColumns: 1 });

  showCorkboard(project, platformInfo());

  assert.strictEqual(document.activeElement.id, 'card-label1');
});

//Regression: markUnsavedChanges was only wired to the label/description fields' `change` event,
//which fires on blur. Typing then pressing Escape before ever blurring left unsavedChanges false,
//so the corkboard closed immediately and silently discarded the edit instead of prompting to save.
test('typing in a card marks unsaved changes immediately, so Escape prompts to save without needing to blur first', function(t){
  var cards = [{ label: 'A', descr: 'a', color: 0, checked: false }];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  var project = makeProject({ corkboardColumns: 1 });
  showCorkboard(project, platformInfo());

  var label = document.getElementById('card-label1');
  label.value = 'Changed';
  label.dispatchEvent(new window.Event('keyup', { bubbles: true }));

  keydown(label, 'Escape', {});

  assert.ok(document.querySelector('.popup-dialog'), 'the unsaved-changes prompt should appear');
  assert.ok(document.querySelector('.popup-corkboard'), 'the corkboard itself should stay open behind the prompt');
});

test('Escape with no unsaved changes closes the corkboard immediately, without prompting', function(t){
  var cards = [{ label: 'A', descr: 'a', color: 0, checked: false }];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  var project = makeProject({ corkboardColumns: 1 });
  showCorkboard(project, platformInfo());

  keydown(document.querySelector('.popup-corkboard'), 'Escape', {});

  assert.strictEqual(document.querySelector('.popup-dialog'), null);
  assert.strictEqual(document.querySelector('.popup-corkboard'), null);
});

test('Ctrl+S saves the cards and the project, then clears the unsaved-changes flag', function(t){
  var cards = [{ label: 'A', descr: 'a', color: 0, checked: false }];
  var saveCardsCalls = [];
  var saveFileCalls = 0;
  var showCorkboard = freshCorkboardDisplay({
    getCardsFromFile: function(){ return cards; },
    saveCards: function(cardsArg, path){ saveCardsCalls.push({ cardsArg: cardsArg, path: path }); }
  });
  var project = makeProject({ corkboardColumns: 1, saveFile: function(){ saveFileCalls++; } });
  showCorkboard(project, platformInfo());

  var label = document.getElementById('card-label1');
  label.value = 'Changed';
  label.dispatchEvent(new window.Event('keyup', { bubbles: true }));

  var popup = document.querySelector('.popup-corkboard');
  keydown(popup, 's', { ctrlKey: true });

  assert.strictEqual(saveCardsCalls.length, 1);
  assert.strictEqual(saveCardsCalls[0].path, '/proj/chaps/');
  assert.strictEqual(saveFileCalls, 1);

  //With changes just saved, Escape should close immediately instead of prompting again.
  keydown(popup, 'Escape', {});
  assert.strictEqual(document.querySelector('.popup-dialog'), null);
  assert.strictEqual(document.querySelector('.popup-corkboard'), null);
});

//Regression: "Continue Without Saving" never reset unsavedChanges, so it stayed true forever - the
//very next time the corkboard was opened (with no new edits at all), Escape would still show a
//stale "you have unsaved changes" prompt.
test('Continue Without Saving clears the unsaved flag instead of leaving it stuck for next time', function(t){
  var cards = [{ label: 'A', descr: 'a', color: 0, checked: false }];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  var project = makeProject({ corkboardColumns: 1 });
  showCorkboard(project, platformInfo());

  var label = document.getElementById('card-label1');
  label.value = 'Changed';
  label.dispatchEvent(new window.Event('keyup', { bubbles: true }));

  keydown(document.querySelector('.popup-corkboard'), 'Escape', {});

  var quitBtn = Array.from(document.querySelectorAll('.popup-dialog button'))
    .find(function(b){ return b.innerHTML === 'Continue Without Saving'; });
  assert.ok(quitBtn, 'expected the Continue Without Saving button');
  quitBtn.onclick();

  assert.strictEqual(document.querySelector('.popup-corkboard'), null, 'corkboard should be closed');

  //Reopen fresh with no new edits and press Escape right away - it must not show a stale prompt.
  showCorkboard(project, platformInfo());
  keydown(document.querySelector('.popup-corkboard'), 'Escape', {});

  assert.strictEqual(document.querySelector('.popup-dialog'), null, 'should not show a stale unsaved-changes prompt');
  assert.strictEqual(document.querySelector('.popup-corkboard'), null);
});

test('Ctrl+I inserts a full-schema blank card after the current one and focuses it', function(t){
  var cards = [{ label: 'A', descr: 'a', color: 0, checked: false }];
  var savedCardsArg = null;
  var showCorkboard = freshCorkboardDisplay({
    getCardsFromFile: function(){ return cards; },
    saveCards: function(cardsArg){ savedCardsArg = cardsArg; }
  });
  var project = makeProject({ corkboardColumns: 1 });
  showCorkboard(project, platformInfo());

  keydown(document.getElementById('card1'), 'i', { ctrlKey: true });

  assert.strictEqual(document.getElementById('card-label2').value, '');
  assert.strictEqual(document.activeElement.id, 'card-label2');

  //Regression: insertBlankCard used to omit color/checked, unlike every other card's schema.
  var popup = document.querySelector('.popup-corkboard');
  keydown(popup, 's', { ctrlKey: true });
  assert.strictEqual(savedCardsArg.length, 2);
  assert.strictEqual(savedCardsArg[1].color, 0);
  assert.strictEqual(savedCardsArg[1].checked, false);
});

test('Ctrl+Backspace deletes a card but refuses to delete the last remaining one', function(t){
  var cards = [
    { label: 'A', descr: '', color: 0, checked: false },
    { label: 'B', descr: '', color: 0, checked: false }
  ];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  var project = makeProject({ corkboardColumns: 1 });
  showCorkboard(project, platformInfo());

  keydown(document.getElementById('card1'), 'Backspace', { ctrlKey: true });

  assert.strictEqual(document.getElementById('card-label1').value, 'B');
  assert.strictEqual(document.getElementById('card2'), null);

  keydown(document.getElementById('card1'), 'Backspace', { ctrlKey: true });

  assert.strictEqual(document.getElementById('card-label1').value, 'B', 'the last remaining card must not be deletable');
});

test('Ctrl+Enter toggles a card checked/unchecked', function(t){
  var cards = [{ label: 'A', descr: '', color: 0, checked: false }];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  var project = makeProject({ corkboardColumns: 1 });
  showCorkboard(project, platformInfo());

  keydown(document.getElementById('card1'), 'Enter', { ctrlKey: true });
  assert.ok(document.getElementById('card-checkmark1').classList.contains('card-checkmark-checked'));

  keydown(document.getElementById('card1'), 'Enter', { ctrlKey: true });
  assert.strictEqual(document.getElementById('card-checkmark1').classList.contains('card-checkmark-checked'), false);
});

test('Ctrl+<digit> sets the card color class and Ctrl+0 clears it', function(t){
  var cards = [{ label: 'A', descr: '', color: 0, checked: false }];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  var project = makeProject({ corkboardColumns: 1 });
  showCorkboard(project, platformInfo());

  var card1 = document.getElementById('card1');
  keydown(card1, '3', { ctrlKey: true });
  assert.ok(card1.classList.contains('corkboard-color3'));

  keydown(card1, '0', { ctrlKey: true });
  for(var i = 1; i < 10; i++){
    assert.strictEqual(card1.classList.contains('corkboard-color' + i), false);
  }
});

test('Ctrl+, and Ctrl+. adjust the number of board columns, never going below 1', function(t){
  var cards = [{ label: 'A', descr: '' }, { label: 'B', descr: '' }];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  var project = makeProject({ corkboardColumns: 1 });
  showCorkboard(project, platformInfo());

  assert.strictEqual(document.getElementsByClassName('corkboard-column').length, 1);

  keydown(document.getElementById('card1'), '.', { ctrlKey: true });
  assert.strictEqual(project.corkboardColumns, 2);
  assert.strictEqual(document.getElementsByClassName('corkboard-column').length, 2);

  keydown(document.getElementById('card1'), ',', { ctrlKey: true });
  keydown(document.getElementById('card1'), ',', { ctrlKey: true });
  assert.strictEqual(project.corkboardColumns, 1, 'column count should not go below 1');
});

test('Ctrl+Shift+ArrowRight reorders cards, and moving the last card right inserts a blank card instead', function(t){
  var cards = [
    { label: 'A', descr: '', color: 0, checked: false },
    { label: 'B', descr: '', color: 0, checked: false }
  ];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  var project = makeProject({ corkboardColumns: 1 });
  showCorkboard(project, platformInfo());

  keydown(document.getElementById('card1'), 'ArrowRight', { ctrlKey: true, shiftKey: true });

  assert.strictEqual(document.getElementById('card-label1').value, 'B');
  assert.strictEqual(document.getElementById('card-label2').value, 'A');

  //'A' is now last, so moving it right again has nothing to swap with - it should insert a blank
  //card ahead of it rather than doing nothing or throwing.
  keydown(document.getElementById('card2'), 'ArrowRight', { ctrlKey: true, shiftKey: true });

  assert.strictEqual(document.getElementById('card-label2').value, '');
  assert.strictEqual(document.getElementById('card-label3').value, 'A');
});

test('Ctrl+ArrowRight/ArrowLeft move focus between cards without reordering them', function(t){
  var cards = [{ label: 'A', descr: '' }, { label: 'B', descr: '' }];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  var project = makeProject({ corkboardColumns: 1 });
  showCorkboard(project, platformInfo());

  keydown(document.getElementById('card1'), 'ArrowRight', { ctrlKey: true });
  assert.strictEqual(document.activeElement.id, 'card-label2');
  assert.strictEqual(document.getElementById('card-label1').value, 'A', 'order should be unchanged');

  keydown(document.getElementById('card2'), 'ArrowLeft', { ctrlKey: true });
  assert.strictEqual(document.activeElement.id, 'card-label1');
});
