const test = require('node:test');
const assert = require('node:assert');

const { DEFAULT_LINE_HEIGHT_ID, getLineHeightDefs, getLineHeightDef, resolveLineHeight, sanitizeLineHeightId } = require('../src/components/models/line-heights');

test('every line height definition has an id, a label and a multiplier', function(){
  const defs = getLineHeightDefs();

  assert.ok(defs.length > 1, 'a picker needs something to pick between');

  defs.forEach(function(def){
    assert.strictEqual(typeof def.id, 'string');
    assert.notStrictEqual(def.id, '');
    assert.strictEqual(typeof def.label, 'string');
    assert.notStrictEqual(def.label, '');
    assert.strictEqual(typeof def.multiplier, 'number');
    assert.ok(Number.isFinite(def.multiplier), def.id + ' should have a real multiplier');
  });
});

test('line height ids are unique, since an id is what gets stored', function(){
  const ids = getLineHeightDefs().map(function(def){ return def.id; });

  assert.strictEqual(new Set(ids).size, ids.length);
});

//A spacing tighter than the text itself would overlap the lines; one much looser than triple is a
//setting nobody can write a chapter in. Both ends are a guard on the table, not on user input,
//which cannot reach a value that is not in it.
test('every multiplier is a spacing a chapter could actually be read at', function(){
  getLineHeightDefs().forEach(function(def){
    assert.ok(def.multiplier >= 1, def.id + ' should not set lines closer than the text is tall');
    assert.ok(def.multiplier <= 3, def.id + ' should not set lines further apart than triple');
  });
});

//The dropdown is read top to bottom as a ladder from tightest to loosest, so the table has to be
//in that order - there is nothing in the picker that sorts it.
test('the spacings are listed tightest first', function(){
  const multipliers = getLineHeightDefs().map(function(def){ return def.multiplier; });

  multipliers.forEach(function(multiplier, i){
    if(i > 0)
      assert.ok(multiplier > multipliers[i - 1], 'spacing ' + i + ' should be looser than the one above it');
  });
});

test('the default line height id names a real definition', function(){
  assert.notStrictEqual(getLineHeightDef(DEFAULT_LINE_HEIGHT_ID), null);
});

//The editor was drawn at line-height: 200% before this setting existed, and a writer who never
//opens the dropdown must not find their manuscript re-spaced by an update.
test('the default is the double spacing the manuscript was already set at', function(){
  assert.strictEqual(resolveLineHeight(DEFAULT_LINE_HEIGHT_ID), '200%');
});

test('getLineHeightDefs hands back a copy, so a caller cannot reorder the table', function(){
  const defs = getLineHeightDefs();
  defs.length = 0;

  assert.ok(getLineHeightDefs().length > 1);
});

test('resolveLineHeight answers with the named spacing as a css value', function(){
  assert.strictEqual(resolveLineHeight('single'), '115%');
  assert.strictEqual(resolveLineHeight('one-and-a-half'), '150%');
});

//There is no id for which "no line-height at all" is the right answer, so callers may set the css
//property with whatever this returns without checking it first.
test('resolveLineHeight falls back to the default for anything it does not recognize', function(){
  const defaultValue = resolveLineHeight(DEFAULT_LINE_HEIGHT_ID);

  assert.strictEqual(resolveLineHeight('no-such-spacing'), defaultValue);
  assert.strictEqual(resolveLineHeight(undefined), defaultValue);
  assert.strictEqual(resolveLineHeight(null), defaultValue);
  assert.strictEqual(resolveLineHeight(2), defaultValue);
});

test('sanitizeLineHeightId keeps an id it knows', function(){
  assert.strictEqual(sanitizeLineHeightId('single'), 'single');
});

//user-settings.json is a plain file anything could have written to.
test('sanitizeLineHeightId turns anything else into the default', function(){
  assert.strictEqual(sanitizeLineHeightId('quadruple'), DEFAULT_LINE_HEIGHT_ID);
  assert.strictEqual(sanitizeLineHeightId(''), DEFAULT_LINE_HEIGHT_ID);
  assert.strictEqual(sanitizeLineHeightId(null), DEFAULT_LINE_HEIGHT_ID);
  assert.strictEqual(sanitizeLineHeightId(undefined), DEFAULT_LINE_HEIGHT_ID);
  //A number is the shape a hand edit is most likely to take, spacing being a number everywhere
  //else it is written down - and 2 is not an id however reasonable it looks.
  assert.strictEqual(sanitizeLineHeightId(2), DEFAULT_LINE_HEIGHT_ID);
  assert.strictEqual(sanitizeLineHeightId({ id: 'single' }), DEFAULT_LINE_HEIGHT_ID);
  assert.strictEqual(sanitizeLineHeightId(['single']), DEFAULT_LINE_HEIGHT_ID);
});

//Object.prototype keys reach a plain {} lookup, so 'constructor' or 'toString' would resolve to a
//function rather than to null if the table were consulted with a bare `[id]` and no own-key check.
test('sanitizeLineHeightId is not fooled by inherited object keys', function(){
  assert.strictEqual(sanitizeLineHeightId('constructor'), DEFAULT_LINE_HEIGHT_ID);
  assert.strictEqual(sanitizeLineHeightId('toString'), DEFAULT_LINE_HEIGHT_ID);
  assert.strictEqual(getLineHeightDef('hasOwnProperty'), null);
});
