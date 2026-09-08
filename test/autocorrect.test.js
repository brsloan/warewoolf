const test = require('node:test');
const assert = require('node:assert');

const autocorrect = require('../src/components/models/autocorrect');

//The model is pure data and pure functions - no DOM, no Quill, nothing to stub - so like
//shortcuts.test.js these need no fixture beyond the module itself.

const ALL_ON = autocorrect.getDefaultRules();

function substitute(prefix, typedChar, rules){
  return autocorrect.substitutionFor(prefix, typedChar, rules || ALL_ON);
}

//What a rule would leave on the line, so a case reads as the text a writer would see rather than as
//a { deleteBack, insert } pair.
function resulting(prefix, typedChar, rules){
  var substitution = substitute(prefix, typedChar, rules);

  if(substitution == null)
    return prefix + typedChar;

  var line = prefix + typedChar;

  return line.slice(0, line.length - substitution.deleteBack) + substitution.insert;
}

//---------------------------------------------------------------------------
// defaults
//---------------------------------------------------------------------------

test('every rule is on by default', function(){
  var defaults = autocorrect.getDefaultRules();

  assert.deepStrictEqual(defaults, {
    smartDoubleQuotes: true,
    smartSingleQuotes: true,
    emDash: true,
    ellipsis: true
  });
});

test('every defined rule has a substitution behind it', function(){
  autocorrect.getAutocorrectDefs().forEach(function(def){
    assert.notStrictEqual(autocorrect.getAutocorrectDef(def.id), null, def.id + ' is not defined');
    assert.ok(def.label, def.id + ' has no label');
    assert.ok(def.example, def.id + ' has no example');
  });
});

test('getAutocorrectDefs hands out copies rather than the definitions themselves', function(){
  autocorrect.getAutocorrectDefs()[0].label = 'changed';

  assert.notStrictEqual(autocorrect.getAutocorrectDefs()[0].label, 'changed');
});

//---------------------------------------------------------------------------
// double quotes
//---------------------------------------------------------------------------

test('a double quote at the start of a line opens', function(){
  assert.strictEqual(resulting('', '"'), '“');
});

test('a double quote after a space opens', function(){
  assert.strictEqual(resulting('He said ', '"'), 'He said “');
});

test('a double quote after a word closes', function(){
  assert.strictEqual(resulting('goodbye', '"'), 'goodbye”');
});

test('a double quote after punctuation inside the sentence closes', function(){
  assert.strictEqual(resulting('goodbye,', '"'), 'goodbye,”');
  assert.strictEqual(resulting('goodbye.', '"'), 'goodbye.”');
  assert.strictEqual(resulting('goodbye!', '"'), 'goodbye!”');
});

test('a double quote after an opening bracket opens', function(){
  assert.strictEqual(resulting('(', '"'), '(“');
  assert.strictEqual(resulting('[', '"'), '[“');
});

//Interrupted dialogue - '"But I—"' - is far commoner in fiction than a dash leading into a quote,
//and this is what Word does too. See the note on OPENING_CONTEXT in the model.
test('a double quote after a dash closes, so interrupted dialogue reads right', function(){
  assert.strictEqual(resulting('“But I—', '"'), '“But I—”');
  assert.strictEqual(resulting('“But I--', '"'), '“But I--”');
});

//---------------------------------------------------------------------------
// single quotes
//---------------------------------------------------------------------------

test('an apostrophe inside a word is a closing single quote', function(){
  assert.strictEqual(resulting('don', "'"), 'don’');
  assert.strictEqual(resulting('it', "'"), 'it’');
});

test('a single quote after a space opens', function(){
  assert.strictEqual(resulting('said ', "'"), 'said ‘');
});

test('a single quote inside a double-quoted line opens', function(){
  assert.strictEqual(resulting('“', "'"), '“‘');
});

test('a single quote closing a quote inside a quote closes', function(){
  assert.strictEqual(resulting('“‘Tis so', "'"), '“‘Tis so’');
});

//A known limitation rather than a preference: a leading elision opens where the writer wanted an
//apostrophe, exactly as it does in Word, and Ctrl+Z is the way back. Pinned so that a later change
//to the rule is a deliberate one.
test('a leading elision opens, which is the known wrong case', function(){
  assert.strictEqual(resulting('and ', "'"), 'and ‘');
});

//---------------------------------------------------------------------------
// em dash
//---------------------------------------------------------------------------

test('two hyphens become an em dash', function(){
  assert.strictEqual(resulting('wait-', '-'), 'wait—');
});

test('a single hyphen is left alone', function(){
  assert.strictEqual(resulting('well', '-'), 'well-');
});

test('a hyphen after a space is left alone', function(){
  assert.strictEqual(resulting('wait ', '-'), 'wait -');
});

test('the em dash replaces both hyphens and nothing before them', function(){
  assert.deepStrictEqual(substitute('wait-', '-'), { deleteBack: 2, insert: '—' });
});

//---------------------------------------------------------------------------
// ellipsis
//---------------------------------------------------------------------------

test('three periods become an ellipsis', function(){
  assert.strictEqual(resulting('well..', '.'), 'well…');
});

test('two periods are left alone', function(){
  assert.strictEqual(resulting('well.', '.'), 'well..');
});

test('a period ending a sentence is left alone', function(){
  assert.strictEqual(resulting('well', '.'), 'well.');
});

test('a fourth period after an ellipsis is left alone', function(){
  assert.strictEqual(resulting('well…', '.'), 'well….');
});

//---------------------------------------------------------------------------
// what does not substitute
//---------------------------------------------------------------------------

test('an ordinary letter substitutes nothing', function(){
  assert.strictEqual(substitute('hell', 'o'), null);
});

test('anything that is not a single character substitutes nothing', function(){
  assert.strictEqual(substitute('said ', '"word"'), null);
  assert.strictEqual(substitute('said ', ''), null);
  assert.strictEqual(substitute('said ', null), null);
});

test('a missing prefix is treated as the start of a line', function(){
  assert.strictEqual(substitute(null, '"').insert, '“');
  assert.strictEqual(substitute(undefined, '"').insert, '“');
});

test('a rule that is off substitutes nothing', function(){
  var quotesOff = Object.assign({}, ALL_ON, { smartDoubleQuotes: false });

  assert.strictEqual(substitute('said ', '"', quotesOff), null);
  //And leaves the others alone.
  assert.notStrictEqual(substitute('wait-', '-', quotesOff), null);
});

test('an empty rule map substitutes nothing at all', function(){
  assert.strictEqual(substitute('said ', '"', {}), null);
  assert.strictEqual(substitute('wait-', '-', {}), null);
  assert.strictEqual(substitute('well..', '.', {}), null);
});

test('a missing rule map substitutes nothing at all', function(){
  assert.strictEqual(autocorrect.substitutionFor('said ', '"', null), null);
  assert.strictEqual(autocorrect.substitutionFor('said ', '"'), null);
});

//The controller hands over a prefix already cut at the start of the line, so no rule may ask to
//delete more characters than there are on it.
test('no rule reaches further back than the line it is given', function(){
  ['"', "'", '-', '.'].forEach(function(typedChar){
    ['', '-', '.', '..', 'a', '“'].forEach(function(prefix){
      var substitution = substitute(prefix, typedChar);

      if(substitution != null)
        assert.ok(substitution.deleteBack <= prefix.length + 1,
          JSON.stringify(prefix) + ' + ' + JSON.stringify(typedChar) + ' reaches past the line');
    });
  });
});

//---------------------------------------------------------------------------
// resolving and storing
//---------------------------------------------------------------------------

test('no overrides resolves to the defaults', function(){
  assert.deepStrictEqual(autocorrect.resolveAutocorrect(null), autocorrect.getDefaultRules());
  assert.deepStrictEqual(autocorrect.resolveAutocorrect({}), autocorrect.getDefaultRules());
});

test('an override wins over the default', function(){
  var resolved = autocorrect.resolveAutocorrect({ emDash: false });

  assert.strictEqual(resolved.emDash, false);
  assert.strictEqual(resolved.smartDoubleQuotes, true);
});

test('only what differs from the defaults is stored', function(){
  var rules = Object.assign(autocorrect.getDefaultRules(), { ellipsis: false });

  assert.deepStrictEqual(autocorrect.diffFromDefaults(rules), { ellipsis: false });
});

test('rules matching the defaults store nothing', function(){
  assert.deepStrictEqual(autocorrect.diffFromDefaults(autocorrect.getDefaultRules()), {});
});

test('diffFromDefaults ignores a rule it does not know', function(){
  var rules = Object.assign(autocorrect.getDefaultRules(), { notARule: false });

  assert.deepStrictEqual(autocorrect.diffFromDefaults(rules), {});
});

test('diffFromDefaults survives being given nothing', function(){
  assert.deepStrictEqual(autocorrect.diffFromDefaults(null), {});
  assert.deepStrictEqual(autocorrect.diffFromDefaults('nonsense'), {});
});

//---------------------------------------------------------------------------
// sanitizing what came off disk
//---------------------------------------------------------------------------

test('a stored override of a known rule survives', function(){
  assert.deepStrictEqual(autocorrect.sanitizeAutocorrect({ emDash: false }), { emDash: false });
  assert.deepStrictEqual(autocorrect.sanitizeAutocorrect({ emDash: true }), { emDash: true });
});

test('an unknown rule id is dropped', function(){
  assert.deepStrictEqual(autocorrect.sanitizeAutocorrect({ notARule: false, emDash: false }), { emDash: false });
});

test('a value that is not a boolean is dropped, leaving that rule on its default', function(){
  assert.deepStrictEqual(autocorrect.sanitizeAutocorrect({ emDash: 'false', ellipsis: 0, smartDoubleQuotes: null }), {});
  assert.strictEqual(autocorrect.resolveAutocorrect({ emDash: 'false' }).emDash, true);
});

test('anything that is not a map of rules sanitizes to no overrides', function(){
  [null, undefined, 'nonsense', 7, [], ['emDash']].forEach(function(raw){
    assert.deepStrictEqual(autocorrect.sanitizeAutocorrect(raw), {}, JSON.stringify(raw) + ' was not rejected');
  });
});
