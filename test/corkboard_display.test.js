const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const corkboardDisplayPath = require.resolve('../src/components/views/corkboard_display');
const corkboardControllerPath = require.resolve('../src/components/controllers/corkboard');

//corkboard_display.js destructures getCardsFromFile/saveCards from the corkboard controller at
//require-time, so mocking them only takes effect if the cache is primed before corkboard_display.js
//is (re-)required - same pattern as compile_display.test.js's freshCompileDisplay(). showCorkboard()
//is async now (loading the cards goes through the platform facade), so every test below awaits it
//before asserting on the rendered board.
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

function flushMicrotasks(){
  return new Promise(function(resolve){ setImmediate(resolve); });
}

function keydown(target, key, modifiers){
  target.dispatchEvent(new window.KeyboardEvent('keydown', Object.assign({
    key: key,
    bubbles: true,
    cancelable: true
  }, modifiers)));
}

//A keydown listener's return value is dropped by dispatchEvent, and boardCntrlEvents is async
//(saving now goes through the platform facade) - flush a microtask so awaited work has landed.
async function keydownAndFlush(target, key, modifiers){
  keydown(target, key, modifiers);
  await flushMicrotasks();
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

test('renders loaded cards into the requested number of columns with their label/description/color/checkmark', async function(t){
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

  await showCorkboard(project, platformInfo());

  assert.strictEqual(getCardsFromFileCalls[0], '/proj/chaps/');
  assert.strictEqual(document.getElementsByClassName('corkboard-column').length, 2);
  assert.strictEqual(document.getElementById('card-label1').value, 'One');
  assert.strictEqual(document.getElementById('card-descr1').value, 'First');
  assert.strictEqual(document.getElementById('card-label1').disabled, false);
  assert.ok(document.getElementById('card2').classList.contains('corkboard-color2'));
  assert.ok(document.getElementById('card-checkmark2').classList.contains('card-checkmark-checked'));
});

test('shows a single blank starter card when no cards exist yet', async function(t){
  var showCorkboard = freshCorkboardDisplay({
    getCardsFromFile: function(){ return undefined; },
    saveCards: function(){}
  });
  var project = makeProject({ corkboardColumns: 1 });

  await showCorkboard(project, platformInfo());

  assert.strictEqual(document.getElementById('card-label1').value, '');
  assert.strictEqual(document.getElementById('card-label1').disabled, false);
  assert.strictEqual(document.getElementById('card2'), null, 'a single starter card should only need one slot');
});

test('focuses the last checked card on open, when it is not the final card', async function(t){
  var cards = [
    { label: 'A', descr: '', checked: false },
    { label: 'B', descr: '', checked: true },
    { label: 'C', descr: '', checked: false }
  ];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  var project = makeProject({ corkboardColumns: 1 });

  await showCorkboard(project, platformInfo());

  assert.strictEqual(document.activeElement.id, 'card-label2');
});

test('focuses the first card when the last card is the last one checked', async function(t){
  var cards = [
    { label: 'A', descr: '', checked: false },
    { label: 'B', descr: '', checked: true }
  ];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  var project = makeProject({ corkboardColumns: 1 });

  await showCorkboard(project, platformInfo());

  assert.strictEqual(document.activeElement.id, 'card-label1');
});

//Regression: markUnsavedChanges was only wired to the label/description fields' `change` event,
//which fires on blur. Typing then pressing Escape before ever blurring left unsavedChanges false,
//so the corkboard closed immediately and silently discarded the edit instead of prompting to save.
test('typing in a card marks unsaved changes immediately, so Escape prompts to save without needing to blur first', async function(t){
  var cards = [{ label: 'A', descr: 'a', color: 0, checked: false }];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  var project = makeProject({ corkboardColumns: 1 });
  await showCorkboard(project, platformInfo());

  var label = document.getElementById('card-label1');
  label.value = 'Changed';
  label.dispatchEvent(new window.Event('keyup', { bubbles: true }));

  keydown(label, 'Escape', {});

  assert.ok(document.querySelector('.popup-dialog'), 'the unsaved-changes prompt should appear');
  assert.ok(document.querySelector('.popup-corkboard'), 'the corkboard itself should stay open behind the prompt');
});

test('Escape with no unsaved changes closes the corkboard immediately, without prompting', async function(t){
  var cards = [{ label: 'A', descr: 'a', color: 0, checked: false }];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  var project = makeProject({ corkboardColumns: 1 });
  await showCorkboard(project, platformInfo());

  keydown(document.querySelector('.popup-corkboard'), 'Escape', {});

  assert.strictEqual(document.querySelector('.popup-dialog'), null);
  assert.strictEqual(document.querySelector('.popup-corkboard'), null);
});

test('Ctrl+S saves the cards and the project, then clears the unsaved-changes flag', async function(t){
  var cards = [{ label: 'A', descr: 'a', color: 0, checked: false }];
  var saveCardsCalls = [];
  var saveFileCalls = 0;
  var showCorkboard = freshCorkboardDisplay({
    getCardsFromFile: function(){ return cards; },
    saveCards: function(cardsArg, path){ saveCardsCalls.push({ cardsArg: cardsArg, path: path }); }
  });
  var project = makeProject({ corkboardColumns: 1, saveFile: function(){ saveFileCalls++; } });
  await showCorkboard(project, platformInfo());

  var label = document.getElementById('card-label1');
  label.value = 'Changed';
  label.dispatchEvent(new window.Event('keyup', { bubbles: true }));

  var popup = document.querySelector('.popup-corkboard');
  //A keydown listener's return value is dropped by dispatchEvent, and the handler is async now
  //(saving the project goes through the platform facade), so the flag is only cleared a tick later.
  await keydownAndFlush(popup, 's', { ctrlKey: true });

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
test('Continue Without Saving clears the unsaved flag instead of leaving it stuck for next time', async function(t){
  var cards = [{ label: 'A', descr: 'a', color: 0, checked: false }];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  var project = makeProject({ corkboardColumns: 1 });
  await showCorkboard(project, platformInfo());

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
  await showCorkboard(project, platformInfo());
  keydown(document.querySelector('.popup-corkboard'), 'Escape', {});

  assert.strictEqual(document.querySelector('.popup-dialog'), null, 'should not show a stale unsaved-changes prompt');
  assert.strictEqual(document.querySelector('.popup-corkboard'), null);
});

test('Ctrl+I inserts a full-schema blank card after the current one and focuses it', async function(t){
  var cards = [{ label: 'A', descr: 'a', color: 0, checked: false }];
  var savedCardsArg = null;
  var showCorkboard = freshCorkboardDisplay({
    getCardsFromFile: function(){ return cards; },
    saveCards: function(cardsArg){ savedCardsArg = cardsArg; }
  });
  var project = makeProject({ corkboardColumns: 1 });
  await showCorkboard(project, platformInfo());

  keydown(document.getElementById('card1'), 'i', { ctrlKey: true });

  assert.strictEqual(document.getElementById('card-label2').value, '');
  assert.strictEqual(document.activeElement.id, 'card-label2');

  //Regression: insertBlankCard used to omit color/checked, unlike every other card's schema.
  var popup = document.querySelector('.popup-corkboard');
  await keydownAndFlush(popup, 's', { ctrlKey: true });
  assert.strictEqual(savedCardsArg.length, 2);
  assert.strictEqual(savedCardsArg[1].color, 0);
  assert.strictEqual(savedCardsArg[1].checked, false);
});

test('Ctrl+Backspace deletes a card but refuses to delete the last remaining one', async function(t){
  var cards = [
    { label: 'A', descr: '', color: 0, checked: false },
    { label: 'B', descr: '', color: 0, checked: false }
  ];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  var project = makeProject({ corkboardColumns: 1 });
  await showCorkboard(project, platformInfo());

  keydown(document.getElementById('card1'), 'Backspace', { ctrlKey: true });

  assert.strictEqual(document.getElementById('card-label1').value, 'B');
  assert.strictEqual(document.getElementById('card2'), null);

  keydown(document.getElementById('card1'), 'Backspace', { ctrlKey: true });

  assert.strictEqual(document.getElementById('card-label1').value, 'B', 'the last remaining card must not be deletable');
});

test('Ctrl+Enter toggles a card checked/unchecked', async function(t){
  var cards = [{ label: 'A', descr: '', color: 0, checked: false }];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  var project = makeProject({ corkboardColumns: 1 });
  await showCorkboard(project, platformInfo());

  keydown(document.getElementById('card1'), 'Enter', { ctrlKey: true });
  assert.ok(document.getElementById('card-checkmark1').classList.contains('card-checkmark-checked'));

  keydown(document.getElementById('card1'), 'Enter', { ctrlKey: true });
  assert.strictEqual(document.getElementById('card-checkmark1').classList.contains('card-checkmark-checked'), false);
});

//---------------------------------------------------------------------------
// What a screen reader is told
//---------------------------------------------------------------------------

function announced(){
  //A repeated announcement gets a zero-width space appended so the live region sees a change;
  //it is not part of what is spoken, so it is not part of what is asserted.
  return document.getElementById('corkboard-announcer').textContent.replace(/\u200B/g, '');
}

//The finished mark and the colour are both CSS classes, which a reader landing on a card's
//fields cannot hear. Each field is described by a hidden span carrying the same state as words.
test('each card field is described by its finished and colour state, and unused spots are hidden', async function(t){
  var cards = [
    { label: 'One', descr: '', color: 0, checked: false },
    { label: 'Two', descr: '', color: '2', checked: true },
    { label: 'Three', descr: '', color: '5', checked: false }
  ];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  await showCorkboard(makeProject({ corkboardColumns: 2 }), platformInfo());

  [1, 2, 3].forEach(function(n){
    assert.strictEqual(document.getElementById('card-label' + n).getAttribute('aria-describedby'), 'card-status' + n);
    assert.strictEqual(document.getElementById('card-descr' + n).getAttribute('aria-describedby'), 'card-status' + n);
  });
  assert.strictEqual(document.getElementById('card-status1').textContent, '');
  assert.strictEqual(document.getElementById('card-status2').textContent, 'Finished. Color 2');
  assert.strictEqual(document.getElementById('card-status3').textContent, 'Color 5');

  assert.strictEqual(document.getElementById('card-checkmark2').getAttribute('role'), 'img');
  assert.strictEqual(document.getElementById('card-checkmark2').getAttribute('aria-label'), 'Finished');

  //Three cards over two columns leaves a fourth, empty spot.
  assert.strictEqual(document.getElementById('card1').getAttribute('aria-hidden'), null);
  assert.strictEqual(document.getElementById('card4').getAttribute('aria-hidden'), 'true');
  assert.ok(document.getElementById('card4').classList.contains('corkboard-card-unused'));
});

test('the board has a polite live region that says what each shortcut did', async function(t){
  var cards = [
    { label: 'A', descr: '', color: 0, checked: false },
    { label: 'B', descr: '', color: 0, checked: false }
  ];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  var project = makeProject({ corkboardColumns: 1 });
  await showCorkboard(project, platformInfo());

  var announcer = document.getElementById('corkboard-announcer');
  assert.strictEqual(announcer.getAttribute('aria-live'), 'polite');
  assert.ok(announcer.classList.contains('visually-hidden'));
  assert.ok(document.querySelector('.popup-corkboard').contains(announcer), 'the region lives in the popup, outside the board that is rebuilt');

  keydown(document.getElementById('card1'), 'Enter', { ctrlKey: true });
  assert.strictEqual(announced(), 'Card 1 finished');
  assert.strictEqual(document.getElementById('card-status1').textContent, 'Finished');

  keydown(document.getElementById('card1'), 'Enter', { ctrlKey: true });
  assert.strictEqual(announced(), 'Card 1 not finished');
  assert.strictEqual(document.getElementById('card-status1').textContent, '');

  keydown(document.getElementById('card1'), '3', { ctrlKey: true });
  assert.strictEqual(announced(), 'Card 1 color 3');
  assert.strictEqual(document.getElementById('card-status1').textContent, 'Color 3');

  keydown(document.getElementById('card1'), '0', { ctrlKey: true });
  assert.strictEqual(announced(), 'Card 1 color cleared');
  assert.strictEqual(document.getElementById('card-status1').textContent, '');

  keydown(document.getElementById('card1'), 'i', { ctrlKey: true });
  assert.strictEqual(announced(), 'Card 2 inserted');

  keydown(document.getElementById('card2'), 'Backspace', { ctrlKey: true });
  assert.strictEqual(announced(), 'Card 2 deleted');

  keydown(document.getElementById('card1'), '.', { ctrlKey: true });
  assert.strictEqual(announced(), '2 columns');
  keydown(document.getElementById('card1'), ',', { ctrlKey: true });
  assert.strictEqual(announced(), '1 column');
});

test('a move says where the card went, or that it stayed at the edge of the board', async function(t){
  var cards = [
    { label: 'A', descr: '', color: 0, checked: false },
    { label: 'B', descr: '', color: 0, checked: false }
  ];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  await showCorkboard(makeProject({ corkboardColumns: 1 }), platformInfo());

  keydown(document.getElementById('card1'), 'ArrowRight', { ctrlKey: true, shiftKey: true });
  assert.strictEqual(announced(), 'Moved to card 2');
  assert.strictEqual(document.getElementById('card-label2').value, 'A');

  keydown(document.getElementById('card2'), 'ArrowLeft', { ctrlKey: true, shiftKey: true });
  assert.strictEqual(announced(), 'Moved to card 1');
  assert.strictEqual(document.getElementById('card-label1').value, 'A');

  keydown(document.getElementById('card1'), 'ArrowLeft', { ctrlKey: true, shiftKey: true });
  assert.strictEqual(announced(), 'Card 1 did not move');
});

test('the same announcement twice running still changes the live region', async function(t){
  var cards = [
    { label: 'A', descr: '', color: 0, checked: false },
    { label: 'B', descr: '', color: 0, checked: false },
    { label: 'C', descr: '', color: 0, checked: false }
  ];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  await showCorkboard(makeProject({ corkboardColumns: 1 }), platformInfo());
  var announcer = document.getElementById('corkboard-announcer');

  keydown(document.getElementById('card1'), 'Backspace', { ctrlKey: true });
  var first = announcer.textContent;
  keydown(document.getElementById('card1'), 'Backspace', { ctrlKey: true });
  var second = announcer.textContent;

  assert.strictEqual(announced(), 'Card 1 deleted');
  assert.notStrictEqual(first, second);

  keydown(document.getElementById('card1'), 'Backspace', { ctrlKey: true });
  assert.strictEqual(announced(), 'The last card cannot be deleted');
});

test('Ctrl+<digit> sets the card color class and Ctrl+0 clears it', async function(t){
  var cards = [{ label: 'A', descr: '', color: 0, checked: false }];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  var project = makeProject({ corkboardColumns: 1 });
  await showCorkboard(project, platformInfo());

  var card1 = document.getElementById('card1');
  keydown(card1, '3', { ctrlKey: true });
  assert.ok(card1.classList.contains('corkboard-color3'));

  keydown(card1, '0', { ctrlKey: true });
  for(var i = 1; i < 10; i++){
    assert.strictEqual(card1.classList.contains('corkboard-color' + i), false);
  }
});

test('Ctrl+, and Ctrl+. adjust the number of board columns, never going below 1', async function(t){
  var cards = [{ label: 'A', descr: '' }, { label: 'B', descr: '' }];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  var project = makeProject({ corkboardColumns: 1 });
  await showCorkboard(project, platformInfo());

  assert.strictEqual(document.getElementsByClassName('corkboard-column').length, 1);

  keydown(document.getElementById('card1'), '.', { ctrlKey: true });
  assert.strictEqual(project.corkboardColumns, 2);
  assert.strictEqual(document.getElementsByClassName('corkboard-column').length, 2);

  keydown(document.getElementById('card1'), ',', { ctrlKey: true });
  keydown(document.getElementById('card1'), ',', { ctrlKey: true });
  assert.strictEqual(project.corkboardColumns, 1, 'column count should not go below 1');
});

test('Ctrl+Shift+ArrowRight reorders cards, and moving the last card right inserts a blank card instead', async function(t){
  var cards = [
    { label: 'A', descr: '', color: 0, checked: false },
    { label: 'B', descr: '', color: 0, checked: false }
  ];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  var project = makeProject({ corkboardColumns: 1 });
  await showCorkboard(project, platformInfo());

  keydown(document.getElementById('card1'), 'ArrowRight', { ctrlKey: true, shiftKey: true });

  assert.strictEqual(document.getElementById('card-label1').value, 'B');
  assert.strictEqual(document.getElementById('card-label2').value, 'A');

  //'A' is now last, so moving it right again has nothing to swap with - it should insert a blank
  //card ahead of it rather than doing nothing or throwing.
  keydown(document.getElementById('card2'), 'ArrowRight', { ctrlKey: true, shiftKey: true });

  assert.strictEqual(document.getElementById('card-label2').value, '');
  assert.strictEqual(document.getElementById('card-label3').value, 'A');
});

test('Ctrl+ArrowRight/ArrowLeft move focus between cards without reordering them', async function(t){
  var cards = [{ label: 'A', descr: '' }, { label: 'B', descr: '' }];
  var showCorkboard = freshCorkboardDisplay({ getCardsFromFile: function(){ return cards; }, saveCards: function(){} });
  var project = makeProject({ corkboardColumns: 1 });
  await showCorkboard(project, platformInfo());

  keydown(document.getElementById('card1'), 'ArrowRight', { ctrlKey: true });
  assert.strictEqual(document.activeElement.id, 'card-label2');
  assert.strictEqual(document.getElementById('card-label1').value, 'A', 'order should be unchanged');

  keydown(document.getElementById('card2'), 'ArrowLeft', { ctrlKey: true });
  assert.strictEqual(document.activeElement.id, 'card-label1');
});
