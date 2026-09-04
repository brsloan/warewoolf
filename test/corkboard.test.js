const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getCardsFromFile, saveCards } = require('../src/components/controllers/corkboard');

function makeTempChaptersPath(t){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wwcorkboard-'));
  t.after(function(){
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir + path.sep;
}

test('saveCards/getCardsFromFile round-trips label, description, color and checked state', function(t){
  const chaptersPath = makeTempChaptersPath(t);
  const cards = [
    { label: 'Card One', descr: 'Some notes.', color: 0, checked: false },
    { label: 'Card Two', descr: 'Second card text.', color: 2, checked: true }
  ];

  saveCards(cards, chaptersPath);
  const loaded = getCardsFromFile(chaptersPath);

  assert.strictEqual(loaded.length, 2);
  assert.strictEqual(loaded[0].label, 'Card One');
  assert.strictEqual(loaded[0].descr, 'Some notes.');
  assert.strictEqual(loaded[0].color, 0);
  assert.strictEqual(loaded[0].checked, false);
  assert.strictEqual(loaded[1].label, 'Card Two');
  assert.strictEqual(loaded[1].color, '2');
  assert.strictEqual(loaded[1].checked, true);
});

//Regression: a description line starting with "# " looked identical to the next card's heading marker,
//so loading silently split one card into two and reassigned its text between them.
test('a description line starting with "# " does not get mistaken for the next card heading', function(t){
  const chaptersPath = makeTempChaptersPath(t);
  const descr = 'Some notes.\n\n# Not actually a heading\n\nMore notes.';
  const cards = [
    { label: 'Card One', descr: descr, color: 0, checked: false },
    { label: 'Card Two', descr: 'Second card text.', color: 0, checked: false }
  ];

  saveCards(cards, chaptersPath);
  const loaded = getCardsFromFile(chaptersPath);

  assert.strictEqual(loaded.length, 2, 'card count should be unchanged');
  assert.strictEqual(loaded[0].label, 'Card One');
  assert.strictEqual(loaded[0].descr, descr);
  assert.strictEqual(loaded[1].label, 'Card Two');
});

//Regression: a label that itself started with "[x] " or "[<digit>] " was mistaken for the checkmark/color
//marker syntax and silently stripped off on load.
test('a label starting with "[x] " is preserved instead of being read as a checkmark marker', function(t){
  const chaptersPath = makeTempChaptersPath(t);
  const cards = [
    { label: '[x] marks the spot', descr: 'treasure map', color: 0, checked: false }
  ];

  saveCards(cards, chaptersPath);
  const loaded = getCardsFromFile(chaptersPath);

  assert.strictEqual(loaded[0].label, '[x] marks the spot');
  assert.strictEqual(loaded[0].checked, false);
});

test('a label starting with "[2] " is preserved alongside a real color and checked marker', function(t){
  const chaptersPath = makeTempChaptersPath(t);
  const cards = [
    { label: '[2] second place', descr: 'note', color: 5, checked: true }
  ];

  saveCards(cards, chaptersPath);
  const loaded = getCardsFromFile(chaptersPath);

  assert.strictEqual(loaded[0].label, '[2] second place');
  assert.strictEqual(loaded[0].color, '5');
  assert.strictEqual(loaded[0].checked, true);
});

test('getCardsFromFile returns undefined when no corkboard file exists yet', function(t){
  const chaptersPath = makeTempChaptersPath(t);
  assert.strictEqual(getCardsFromFile(chaptersPath), undefined);
});

//Regression: an existing-but-empty corkboard file used to fail JSON.parse and get logged as an error
//before falling back to undefined. It's a legitimate empty state, not an error.
test('getCardsFromFile returns an empty array for an existing empty corkboard file, without erroring', function(t){
  const chaptersPath = makeTempChaptersPath(t);
  fs.writeFileSync(chaptersPath + 'project_corkboard.txt', '', 'utf8');

  assert.deepStrictEqual(getCardsFromFile(chaptersPath), []);
});
