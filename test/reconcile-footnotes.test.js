const test = require('node:test');
const assert = require('node:assert');

const {
  reconcileFootnotes,
  applyStructuralFootnoteChanges,
  renumberFootnotes,
  namespaceFootnotes,
  redistributeFootnotes
} = require('../src/components/controllers/reconcile-footnotes');

function marker(n){
  return { insert: { footnote: { n: n } } };
}

function body(text, id){
  return [ { insert: text }, { insert: '\n', attributes: { footnoteBody: id } } ];
}

test('a single marker and body are numbered and left in place', function(){
  var delta = { ops: [
    { insert: 'See note' }, marker('1'), { insert: ' here.' }, { insert: '\n' },
    ...body('The note.', '1')
  ]};

  assert.deepStrictEqual(reconcileFootnotes(delta), delta);
});

test('markers are numbered in document order, not in the order their bodies appear', function(){
  var delta = { ops: [
    { insert: 'a' }, marker('9'), { insert: 'b' }, marker('3'), { insert: '\n' },
    ...body('third originally', '3'),
    ...body('ninth originally', '9')
  ]};

  var result = reconcileFootnotes(delta);

  assert.deepStrictEqual(result, { ops: [
    { insert: 'a' }, marker('1'), { insert: 'b' }, marker('2'), { insert: '\n' },
    ...body('ninth originally', '1'),
    ...body('third originally', '2')
  ]});
});

test('body groups are reordered to follow marker order, multi-paragraph notes moving as one unit', function(){
  var delta = { ops: [
    { insert: 'x' }, marker('2'), { insert: 'y' }, marker('1'), { insert: '\n' },
    { insert: 'one, para one' }, { insert: '\n', attributes: { footnoteBody: '1' } },
    { insert: 'one, para two' }, { insert: '\n', attributes: { footnoteBody: '1' } },
    { insert: 'two' }, { insert: '\n', attributes: { footnoteBody: '2' } }
  ]};

  var result = reconcileFootnotes(delta);

  assert.deepStrictEqual(result, { ops: [
    { insert: 'x' }, marker('1'), { insert: 'y' }, marker('2'), { insert: '\n' },
    { insert: 'two' }, { insert: '\n', attributes: { footnoteBody: '1' } },
    { insert: 'one, para one' }, { insert: '\n', attributes: { footnoteBody: '2' } },
    { insert: 'one, para two' }, { insert: '\n', attributes: { footnoteBody: '2' } }
  ]});
});

test('a body whose marker is gone is deleted, as a structural change', function(){
  var delta = { ops: [
    { insert: 'no more reference here' }, { insert: '\n' },
    ...body('orphaned note', '1')
  ]};

  assert.deepStrictEqual(applyStructuralFootnoteChanges(delta), { ops: [
    { insert: 'no more reference here' }, { insert: '\n' }
  ]});
});

test('renumberFootnotes alone leaves an orphaned body exactly where it is', function(){
  var delta = { ops: [
    { insert: 'no more reference here' }, { insert: '\n' },
    ...body('orphaned note', '1')
  ]};

  assert.deepStrictEqual(renumberFootnotes(delta), delta);
});

test('a marker with no body is left as a literal orphan, not invented a body', function(){
  var delta = { ops: [
    { insert: 'unanswered' }, marker('5'), { insert: '\n' }
  ]};

  assert.deepStrictEqual(reconcileFootnotes(delta), { ops: [
    { insert: 'unanswered' }, marker('1'), { insert: '\n' }
  ]});
});

test('a pasted marker materializes its payload into a real, numbered body', function(){
  var delta = { ops: [
    { insert: 'pasted' },
    { insert: { footnote: { n: '7', payload: [ { insert: 'carried body' }, { insert: '\n' } ] } } },
    { insert: '\n' }
  ]};

  var result = reconcileFootnotes(delta);

  assert.deepStrictEqual(result, { ops: [
    { insert: 'pasted' }, marker('1'), { insert: '\n' },
    ...body('carried body', '1')
  ]});
});

test('the pass is idempotent - reconciling an already-clean delta changes nothing', function(){
  var delta = { ops: [
    { insert: 'a' }, marker('1'), { insert: 'b' }, marker('2'), { insert: '\n' },
    ...body('first', '1'),
    ...body('second', '2')
  ]};

  assert.deepStrictEqual(reconcileFootnotes(delta), delta);
});

test('splitting a chapter sends each body to the fragment that kept its marker', function(){
  var before = { ops: [
    { insert: 'before' }, marker('1'), { insert: '\n' }
  ]};
  var after = { ops: [
    { insert: 'after' }, marker('2'), { insert: '\n' },
    ...body('first note', '1'),
    ...body('second note', '2')
  ]};

  var result = redistributeFootnotes([ before, after ]);

  assert.deepStrictEqual(result[0], { ops: [
    { insert: 'before' }, marker('1'), { insert: '\n' },
    ...body('first note', '1')
  ]});
  assert.deepStrictEqual(result[1], { ops: [
    { insert: 'after' }, marker('1'), { insert: '\n' },
    ...body('second note', '1')
  ]});
});

test('a footnote referenced from both sides of a split needs no special case', function(){
  var before = { ops: [
    { insert: 'before' }, marker('1'), { insert: '\n' }
  ]};
  var after = { ops: [
    { insert: 'after' }, marker('1'), { insert: '\n' },
    ...body('shared note becomes two independent ones', '1')
  ]};

  //Not a realistic input (markers are one-to-one with bodies), but redistributeFootnotes should
  //not throw or drop either fragment's own content when it happens anyway.
  var result = redistributeFootnotes([ before, after ]);

  assert.strictEqual(result.length, 2);
});

test('import splitting several chapters out of one file numbers each chapter from one', function(){
  var chapterOne = { ops: [
    { insert: 'chapter one' }, marker('4'), { insert: '\n' },
    ...body('note in chapter one', '4')
  ]};
  var chapterTwo = { ops: [
    { insert: 'chapter two' }, marker('9'), { insert: '\n' },
    ...body('note in chapter two', '9')
  ]};
  var chapterThree = { ops: [
    { insert: 'chapter three, no footnotes' }, { insert: '\n' }
  ]};

  var result = redistributeFootnotes([ chapterOne, chapterTwo, chapterThree ]);

  assert.deepStrictEqual(result[0], { ops: [
    { insert: 'chapter one' }, marker('1'), { insert: '\n' },
    ...body('note in chapter one', '1')
  ]});
  assert.deepStrictEqual(result[1], { ops: [
    { insert: 'chapter two' }, marker('1'), { insert: '\n' },
    ...body('note in chapter two', '1')
  ]});
  assert.deepStrictEqual(result[2], chapterThree);
});

test('an empty delta reconciles to a bare document rather than an empty ops array', function(){
  assert.deepStrictEqual(reconcileFootnotes({ ops: [] }), { ops: [ { insert: '\n' } ] });
});

test('namespaceFootnotes prefixes every marker and body id, leaving the marker/body pairing intact', function(){
  var delta = { ops: [
    { insert: 'x' }, marker('1'), { insert: '\n' },
    ...body('note', '1')
  ]};

  assert.deepStrictEqual(namespaceFootnotes(delta, 'c0'), { ops: [
    { insert: 'x' }, marker('c0_1'), { insert: '\n' },
    ...body('note', 'c0_1')
  ]});
});

//Regression: two chapters concatenated as-is for a whole-project compile each contribute a "note 1"
//that reconcileFootnotes cannot tell apart from one marker genuinely referenced twice - namespacing
//each chapter before concatenation is what compile.js does to avoid that collision.
test('namespacing before concatenation keeps two chapters\' identically-numbered footnotes distinct', function(){
  var chapterOne = namespaceFootnotes({ ops: [
    { insert: 'first' }, marker('1'), { insert: '\n' },
    ...body('note in chapter one', '1')
  ]}, 'c0');

  var chapterTwo = namespaceFootnotes({ ops: [
    { insert: 'second' }, marker('1'), { insert: '\n' },
    ...body('note in chapter two', '1')
  ]}, 'c1');

  var concatenated = { ops: chapterOne.ops.concat(chapterTwo.ops) };
  var result = reconcileFootnotes(concatenated);

  assert.deepStrictEqual(result, { ops: [
    { insert: 'first' }, marker('1'), { insert: '\n' },
    { insert: 'second' }, marker('2'), { insert: '\n' },
    ...body('note in chapter one', '1'),
    ...body('note in chapter two', '2')
  ]});
});

//Regression: every pass here rewrites a marker by assigning straight to `op.insert`, and
//flattenInserts hands back the caller's own op object untouched for any insert that is not a
//string - so before toLines() started copying, all four of these reached back into the delta they
//were given. That matters because every caller diffs the result against that same delta to decide
//what to apply (render.js's two live-editor passes, chapter.js's save, compile.js's per-chapter
//namespacing): a mutated base makes the marker half of the diff cancel out, so marker numbers
//never reach the editor at all. Asserted here rather than only through those callers because the
//contract this module claims for itself - pure delta in, pure delta out - is what they all rely on.
function assertLeavesInputAlone(name, run){
  test(name + ' does not mutate the delta it is given', function(){
    //Carries a payload-bearing marker alongside the plain ones, so this covers
    //materializePayloads' own assignment to op.insert as well as the renumbering passes'.
    var delta = { ops: [
      { insert: 'a' }, marker('9'), { insert: 'b' }, marker('3'),
      { insert: 'c' }, { insert: { footnote: { n: '4', payload: body('pasted note', '4') } } },
      { insert: '\n' },
      ...body('third originally', '3'),
      ...body('ninth originally', '9')
    ]};
    var before = JSON.stringify(delta);

    run(delta);

    assert.strictEqual(JSON.stringify(delta), before);
  });
}

assertLeavesInputAlone('reconcileFootnotes', function(d){ reconcileFootnotes(d); });
assertLeavesInputAlone('applyStructuralFootnoteChanges', function(d){ applyStructuralFootnoteChanges(d); });
assertLeavesInputAlone('renumberFootnotes', function(d){ renumberFootnotes(d); });
assertLeavesInputAlone('namespaceFootnotes', function(d){ namespaceFootnotes(d, 'c0'); });
assertLeavesInputAlone('redistributeFootnotes', function(d){ redistributeFootnotes([d]); });

//Regression: the payload arrives on the marker itself (see footnote-navigation.js's copy/cut
//handling) and has to be gone from the result, not just represented twice - a marker that keeps
//its payload is materialized again by the next run of this pass, which is what turned a single
//pasted footnote into one extra copy of its body per keystroke.
test('a pasted marker\'s payload becomes a real body and is stripped from the marker', function(){
  var delta = { ops: [
    { insert: 'See note' },
    { insert: { footnote: { n: '1', payload: body('The note.', '1') } } },
    { insert: ' here.' }, { insert: '\n' }
  ]};

  var result = applyStructuralFootnoteChanges(delta);

  assert.deepStrictEqual(result, { ops: [
    { insert: 'See note' }, marker('__pasted_0'), { insert: ' here.' }, { insert: '\n' },
    ...body('The note.', '__pasted_0')
  ]});
});

test('materializing a pasted payload is idempotent - a second pass adds no further body', function(){
  var delta = { ops: [
    { insert: 'See note' },
    { insert: { footnote: { n: '1', payload: body('The note.', '1') } } },
    { insert: ' here.' }, { insert: '\n' }
  ]};

  var once = applyStructuralFootnoteChanges(delta);
  var twice = applyStructuralFootnoteChanges(once);

  assert.deepStrictEqual(twice, once);
});
