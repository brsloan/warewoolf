const test = require('node:test');
const assert = require('node:assert');

const { DEFAULT_FONT_ID, getFontDefs, getFontDef, resolveFontStack, sanitizeFontId } = require('../src/components/models/fonts');

test('every font definition has an id, a label and a stack', function(){
  const defs = getFontDefs();

  assert.ok(defs.length > 1, 'a picker needs something to pick between');

  defs.forEach(function(def){
    assert.strictEqual(typeof def.id, 'string');
    assert.notStrictEqual(def.id, '');
    assert.strictEqual(typeof def.label, 'string');
    assert.notStrictEqual(def.label, '');
    assert.strictEqual(typeof def.stack, 'string');
    assert.notStrictEqual(def.stack, '');
  });
});

test('font ids are unique, since an id is what gets stored', function(){
  const ids = getFontDefs().map(function(def){ return def.id; });

  assert.strictEqual(new Set(ids).size, ids.length);
});

//WareWoolf bundles no font files, so every stack is a list of faces a writer may or may not have.
//Ending in a generic family is what keeps a writer who has none of them from getting whatever the
//browser picks by default instead of something in the right shape.
test('every stack ends in a generic font family', function(){
  const generics = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy'];

  getFontDefs().forEach(function(def){
    const last = def.stack.split(',').pop().trim();

    assert.ok(generics.includes(last), def.id + ' should end in a generic family, ends in ' + last);
  });
});

//The stacks go straight into a css font-family declaration, where a stray quote or semicolon would
//break the rule rather than being escaped.
test('no stack can break out of a font-family declaration', function(){
  getFontDefs().forEach(function(def){
    assert.ok(def.stack.indexOf(';') === -1, def.id + ' should not contain a semicolon');
    assert.ok(def.stack.indexOf('}') === -1, def.id + ' should not contain a brace');
    assert.ok(def.stack.indexOf("'") === -1, def.id + ' should quote family names with double quotes only');
  });
});

test('the default font id names a real definition', function(){
  assert.notStrictEqual(getFontDef(DEFAULT_FONT_ID), null);
});

test('getFontDefs hands back a copy, so a caller cannot reorder the table', function(){
  const defs = getFontDefs();
  defs.length = 0;

  assert.ok(getFontDefs().length > 1);
});

test('resolveFontStack answers with the named font stack', function(){
  const def = getFontDefs()[1];

  assert.strictEqual(resolveFontStack(def.id), def.stack);
});

//There is no id for which "no font at all" is the right answer, so callers may set the css property
//with whatever this returns without checking it first.
test('resolveFontStack falls back to the default stack for anything it does not recognize', function(){
  const defaultStack = resolveFontStack(DEFAULT_FONT_ID);

  assert.strictEqual(resolveFontStack('no-such-font'), defaultStack);
  assert.strictEqual(resolveFontStack(undefined), defaultStack);
  assert.strictEqual(resolveFontStack(null), defaultStack);
  assert.strictEqual(resolveFontStack(42), defaultStack);
});

test('sanitizeFontId keeps an id it knows', function(){
  assert.strictEqual(sanitizeFontId('sans'), 'sans');
});

//user-settings.json is a plain file anything could have written to.
test('sanitizeFontId turns anything else into the default', function(){
  assert.strictEqual(sanitizeFontId('comic-sans-forever'), DEFAULT_FONT_ID);
  assert.strictEqual(sanitizeFontId(''), DEFAULT_FONT_ID);
  assert.strictEqual(sanitizeFontId(null), DEFAULT_FONT_ID);
  assert.strictEqual(sanitizeFontId(undefined), DEFAULT_FONT_ID);
  assert.strictEqual(sanitizeFontId(12), DEFAULT_FONT_ID);
  assert.strictEqual(sanitizeFontId({ id: 'sans' }), DEFAULT_FONT_ID);
  assert.strictEqual(sanitizeFontId(['sans']), DEFAULT_FONT_ID);
});

//Object.prototype keys reach a plain {} lookup, so 'constructor' or 'toString' would resolve to a
//function rather than to null if the table were consulted with a bare `[id]` and no own-key check.
test('sanitizeFontId is not fooled by inherited object keys', function(){
  assert.strictEqual(sanitizeFontId('constructor'), DEFAULT_FONT_ID);
  assert.strictEqual(sanitizeFontId('toString'), DEFAULT_FONT_ID);
  assert.strictEqual(getFontDef('hasOwnProperty'), null);
});
