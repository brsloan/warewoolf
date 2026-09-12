const test = require('node:test');
const assert = require('node:assert');

const { convertSubstitutions, convertSubstitutionsForAllChapters } = require('../src/components/controllers/convert-substitutions');
const { getDefaultRules } = require('../src/components/models/autocorrect');

const ALL_ON = getDefaultRules();

function delta(ops){
  return { ops: ops };
}

function textOf(delt){
  return delt.ops.map(function(op){
    return typeof op.insert === 'string' ? op.insert : '';
  }).join('');
}

function convertedText(ops, rules){
  return textOf(convertSubstitutions(delta(ops), rules || ALL_ON).delta);
}

//A chapter that has been read off disk already; getContentsOrFile() is what the converter asks for.
function makeChap(ops){
  return {
    contents: delta(ops),
    getContentsOrFile: function(){ return Promise.resolve(this.contents); }
  };
}

//---------------------------------------------------------------------------
// the conversion itself
//---------------------------------------------------------------------------

test('a chapter of straight quotes comes out curly', function(){
  assert.strictEqual(convertedText([{ insert: '"Get out," she said.\n' }]), '“Get out,” she said.\n');
});

test('apostrophes inside words curl the right way round', function(){
  assert.strictEqual(convertedText([{ insert: "he don't stop\n" }]), 'he don’t stop\n');
});

test('two hyphens become an em dash and three periods an ellipsis', function(){
  assert.strictEqual(convertedText([{ insert: 'wait--no...\n' }]), 'wait—no…\n');
});

test('the number of substitutions made is reported', function(){
  assert.strictEqual(convertSubstitutions(delta([{ insert: '"Wait--" she said...\n' }]), ALL_ON).changed, 4);
});

//The bulk pass and the editor's own typing have to agree, or a manuscript would read differently
//depending on which one had touched it. See test/autocorrect-controller.test.js, which drives the
//same strings through a real Quill one keystroke at a time.
test('a quote opening a line is judged by that line alone, not the one before it', function(){
  assert.strictEqual(convertedText([{ insert: 'she said\n"Hello"\n' }]), 'she said\n“Hello”\n');
});

test('a quote after a dash closes, as it does when typed', function(){
  assert.strictEqual(convertedText([{ insert: '"But I--"\n' }]), '“But I—”\n');
});

//---------------------------------------------------------------------------
// what it leaves alone
//---------------------------------------------------------------------------

test('a chapter with nothing to convert is handed back untouched', function(){
  var original = delta([{ insert: 'The quick brown fox, well-fed.\n' }]);
  var result = convertSubstitutions(original, ALL_ON);

  assert.strictEqual(result.changed, 0);
  //The very same object, so a caller can tell "nothing to do" from "rewritten identically" and
  //leave the chapter unmarked.
  assert.strictEqual(result.delta, original);
});

test('a rule that is unchecked leaves its character alone and the others still run', function(){
  var rules = Object.assign({}, ALL_ON, { emDash: false });

  assert.strictEqual(convertedText([{ insert: '"wait--"\n' }], rules), '“wait--”\n');
});

test('no rules checked converts nothing', function(){
  var original = delta([{ insert: '"wait--no..."\n' }]);
  var result = convertSubstitutions(original, {});

  assert.strictEqual(result.changed, 0);
  assert.strictEqual(result.delta, original);
});

test('a delta that is not one is handed straight back', function(){
  assert.deepStrictEqual(convertSubstitutions(null, ALL_ON), { changed: 0, delta: null });
  assert.deepStrictEqual(convertSubstitutions({}, ALL_ON), { changed: 0, delta: {} });
});

//---------------------------------------------------------------------------
// formatting
//---------------------------------------------------------------------------

test('a run of formatting survives a substitution inside it', function(){
  var result = convertSubstitutions(delta([
    { insert: 'he said ' },
    { insert: 'wait--no', attributes: { italic: true } },
    { insert: ' loudly\n' }
  ]), ALL_ON);

  assert.deepStrictEqual(result.delta.ops, [
    { insert: 'he said ' },
    { insert: 'wait—no', attributes: { italic: true } },
    { insert: ' loudly\n' }
  ]);
});

test('a line\'s heading and alignment are untouched', function(){
  var result = convertSubstitutions(delta([
    { insert: '"Chapter One"' },
    { insert: '\n', attributes: { header: 1, align: 'center' } }
  ]), ALL_ON);

  assert.deepStrictEqual(result.delta.ops, [
    { insert: '“Chapter One”' },
    { insert: '\n', attributes: { header: 1, align: 'center' } }
  ]);
});

//The two hyphens are in different runs, so the em dash cannot simply replace them in place - the
//first has to come off the op before. It takes the second one's formatting, which is the same
//character the editor would have taken it from had the dash been typed.
test('a substitution spanning two runs of formatting is still made', function(){
  var result = convertSubstitutions(delta([
    { insert: 'he said ' },
    { insert: '-', attributes: { italic: true } },
    { insert: '- no.\n' }
  ]), ALL_ON);

  assert.strictEqual(result.changed, 1);
  assert.deepStrictEqual(result.delta.ops, [
    { insert: 'he said ' },
    { insert: '— no.\n' }
  ]);
});

test('an embed passes through, and the text after it is read as a fresh start', function(){
  var result = convertSubstitutions(delta([
    { insert: 'look: ' },
    { insert: { image: 'moon.png' } },
    { insert: '"oh"\n' }
  ]), ALL_ON);

  assert.deepStrictEqual(result.delta.ops[1], { insert: { image: 'moon.png' } });
  assert.strictEqual(textOf(result.delta), 'look: “oh”\n');
});

test('the converted delta does not share attribute objects with the one it came from', function(){
  var attributes = { italic: true };
  var result = convertSubstitutions(delta([{ insert: '"hi"\n', attributes: attributes }]), ALL_ON);

  assert.notStrictEqual(result.delta.ops[0].attributes, attributes);
  assert.deepStrictEqual(result.delta.ops[0].attributes, attributes);
});

//---------------------------------------------------------------------------
// across a project
//---------------------------------------------------------------------------

test('every chapter is converted and marked as changed', async function(){
  var project = { chapters: [makeChap([{ insert: '"one"\n' }]), makeChap([{ insert: 'two--three\n' }])] };

  await convertSubstitutionsForAllChapters(project, ALL_ON);

  assert.strictEqual(textOf(project.chapters[0].contents), '“one”\n');
  assert.strictEqual(textOf(project.chapters[1].contents), 'two—three\n');
  assert.strictEqual(project.chapters[0].hasUnsavedChanges, true);
  assert.strictEqual(project.hasUnsavedChanges, true);
});

test('a chapter with nothing to convert is not marked as changed', async function(){
  var project = { chapters: [makeChap([{ insert: 'nothing to do here\n' }])] };

  await convertSubstitutionsForAllChapters(project, ALL_ON);

  assert.strictEqual(project.chapters[0].hasUnsavedChanges, undefined);
  assert.strictEqual(project.hasUnsavedChanges, undefined);
});

test('a project where no chapter changed is left unmarked, even beside one that did', async function(){
  var untouched = makeChap([{ insert: 'nothing to do here\n' }]);
  var project = { chapters: [untouched, makeChap([{ insert: '"one"\n' }])] };

  await convertSubstitutionsForAllChapters(project, ALL_ON);

  assert.strictEqual(untouched.hasUnsavedChanges, undefined);
  assert.strictEqual(project.hasUnsavedChanges, true);
});

test('a chapter not already in memory is read off disk first', async function(){
  var reads = 0;
  var chap = {
    contents: null,
    getContentsOrFile: function(){
      reads++;
      return Promise.resolve(delta([{ insert: '"from disk"\n' }]));
    }
  };

  await convertSubstitutionsForAllChapters({ chapters: [chap] }, ALL_ON);

  assert.strictEqual(reads, 1);
  assert.strictEqual(textOf(chap.contents), '“from disk”\n');
});

test('a project with no chapters is not marked as changed', async function(){
  var project = { chapters: [] };

  await convertSubstitutionsForAllChapters(project, ALL_ON);

  assert.strictEqual(project.hasUnsavedChanges, undefined);
});
