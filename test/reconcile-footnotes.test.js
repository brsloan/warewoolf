const test = require('node:test');
const assert = require('node:assert');

const {
  reconcileFootnotes,
  applyStructuralFootnoteChanges,
  containsFootnotes,
  renumberFootnotes,
  renumberFootnotesInPlace,
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
    //Marked as continuing the paragraph above rather than opening a note of its own, which is what
    //keeps the number off it - and, just as importantly, keeps the number on the note after it.
    { insert: 'one, para two' }, { insert: '\n', attributes: { footnoteBody: '2', footnoteBodyCont: true } }
  ]});
});

//Regression: the stylesheet used to decide this with "[data-footnote] + [data-footnote]", which
//matches the opening paragraph of the next note exactly as readily as the second paragraph of this
//one - so every note after the first lost its number. CSS cannot compare one paragraph's id with
//its neighbour's, so the pass writes the answer into the document.
test('only a note\'s opening paragraph is left unmarked, however the bodies are ordered', function(){
  var delta = { ops: [
    { insert: 'a' }, marker('1'), { insert: 'b' }, marker('2'), { insert: '\n' },
    { insert: 'one' },      { insert: '\n', attributes: { footnoteBody: '1' } },
    { insert: 'one again' },{ insert: '\n', attributes: { footnoteBody: '1' } },
    { insert: 'two' },      { insert: '\n', attributes: { footnoteBody: '2' } }
  ]};

  var continued = reconcileFootnotes(delta).ops
    .filter(function(op){ return op.attributes && op.attributes.footnoteBody; })
    .map(function(op){ return Boolean(op.attributes.footnoteBodyCont); });

  assert.deepStrictEqual(continued, [false, true, false]);
});

//A stale mark left on what is now a note's first paragraph would keep its number off it, so the
//pass has to clear one as readily as it sets one - the paragraphs of a group can be reordered, or
//its opening one deleted, between two runs.
test('a continuation mark is cleared from a paragraph that has become a note\'s first', function(){
  var delta = { ops: [
    { insert: 'a' }, marker('1'), { insert: '\n' },
    { insert: 'now the only paragraph' },
    { insert: '\n', attributes: { footnoteBody: '1', footnoteBodyCont: true } }
  ]};

  assert.deepStrictEqual(reconcileFootnotes(delta), { ops: [
    { insert: 'a' }, marker('1'), { insert: '\n' },
    { insert: 'now the only paragraph' }, { insert: '\n', attributes: { footnoteBody: '1' } }
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
    //2 rather than 1: the marker's own carried number is still an id in the document until this
    //step replaces it, so it counts towards the next free one. renumberFootnotes settles it back
    //at 1 - reconcileFootnotes runs both, and render.js applies both in the same text-change.
    { insert: 'See note' }, marker('2'), { insert: ' here.' }, { insert: '\n' },
    ...body('The note.', '2')
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

//Regression: a materialized note's id is on screen the instant the structural pass is applied -
//the marker and the body both render their number from it with a CSS ::before - so it has to be a
//number a writer can read, not an internal placeholder. It used to be "__pasted_0", which is what
//the writer saw for the full second before the debounced renumber replaced it.
test('a materialized note takes the next free number, never an internal placeholder', function(){
  var delta = { ops: [
    { insert: 'a' }, marker('1'), { insert: 'b' }, marker('2'),
    { insert: 'c' }, { insert: { footnote: { n: '2', payload: body('pasted note', '2') } } },
    { insert: '\n' },
    ...body('note one', '1'),
    ...body('note two', '2')
  ]};

  var result = applyStructuralFootnoteChanges(delta);

  var ids = result.ops
    .filter(function(op){ return op.insert && op.insert.footnote; })
    .map(function(op){ return op.insert.footnote.n; });

  assert.deepStrictEqual(ids, ['1', '2', '3']);
  ids.forEach(function(id){
    assert.match(id, /^\d+$/, 'every id has to read as a footnote number');
  });
});

//The number chosen has to clear the bodies as well as the markers. An orphaned body is pruned
//straight after this step, but if the materialized note were given that body's id first, the prune
//would keep it - and the pasted note would silently gain a stale paragraph.
test('a materialized note does not take the id of an orphaned body still to be pruned', function(){
  var delta = { ops: [
    { insert: 'a' }, { insert: { footnote: { n: '1', payload: body('pasted note', '1') } } },
    { insert: '\n' },
    ...body('body whose marker is gone', '4')
  ]};

  var result = applyStructuralFootnoteChanges(delta);

  assert.deepStrictEqual(result, { ops: [
    { insert: 'a' }, marker('5'), { insert: '\n' },
    ...body('pasted note', '5')
  ]});
});

//---------------------------------------------------------------------------
// containsFootnotes / the structural pass's early-out
//---------------------------------------------------------------------------

//The guard render.js leans on to skip the whole structural pass (and, more expensively, diffing
//its result against the document) on every keystroke in a chapter that has no footnotes in it -
//which is most chapters. These assert the two shapes it has to recognise and the one it must not
//confuse for them, since a false negative silently stops footnotes working at all.
test('containsFootnotes finds a marker embed', function(){
  assert.strictEqual(containsFootnotes({ ops: [ { insert: 'a' }, marker('1'), { insert: '\n' } ] }), true);
});

test('containsFootnotes finds a body line', function(){
  assert.strictEqual(containsFootnotes({ ops: body('orphan', '1') }), true);
});

test('containsFootnotes finds a marker carrying only a pasted payload', function(){
  //A pasted note's body rides on its marker rather than existing as a line of its own, so a
  //document can need the structural pass while containing no body line at all.
  var delta = { ops: [
    { insert: { footnote: { n: '1', payload: body('pasted', '1') } } },
    { insert: '\n' }
  ]};

  assert.strictEqual(containsFootnotes(delta), true);
});

test('containsFootnotes finds a body attribute on a multi-line insert', function(){
  //A line attribute applies to every newline inside the string it sits on, and the guard reads raw
  //ops without flattening them first - so this shape has to be caught where it is.
  var delta = { ops: [ { insert: 'one\ntwo\n', attributes: { footnoteBody: '1' } } ] };

  assert.strictEqual(containsFootnotes(delta), true);
});

test('containsFootnotes says no to ordinary formatted prose', function(){
  var delta = { ops: [
    { insert: 'Chapter One' }, { insert: '\n', attributes: { header: 1 } },
    { insert: 'Some ' }, { insert: 'italic', attributes: { italic: true } }, { insert: ' text.' },
    { insert: '\n', attributes: { align: 'center' } }
  ]};

  assert.strictEqual(containsFootnotes(delta), false);
});

test('containsFootnotes tolerates an absent or empty delta', function(){
  assert.strictEqual(containsFootnotes(null), false);
  assert.strictEqual(containsFootnotes({}), false);
  assert.strictEqual(containsFootnotes({ ops: [] }), false);
});

test('applyStructuralFootnoteChanges returns a footnote-free document unchanged', function(){
  //Not merely equivalent: identical ops, so render.js's diff against the original is empty and
  //nothing is applied to the editor. The rebuilt path splits multi-line inserts apart on the way
  //through, a difference the diff absorbs but there is no reason to pay for.
  var ops = [
    { insert: 'Two lines\nin one op.\n' },
    { insert: 'Then more.' }, { insert: '\n', attributes: { align: 'center' } }
  ];

  var result = applyStructuralFootnoteChanges({ ops: ops });

  assert.deepStrictEqual(result, { ops: ops });
});

test('applyStructuralFootnoteChanges hands back its own array, not the caller\'s', function(){
  var delta = { ops: [ { insert: 'no notes here\n' } ] };

  var result = applyStructuralFootnoteChanges(delta);

  assert.notStrictEqual(result.ops, delta.ops, 'the caller keeps sole ownership of its own array');
  assert.deepStrictEqual(result.ops, delta.ops);
});

test('an empty document still comes back as a single newline', function(){
  //finalizeDelta's floor, which the early-out has to honour the same way the rebuilt path does.
  assert.deepStrictEqual(applyStructuralFootnoteChanges({ ops: [] }), { ops: [ { insert: '\n' } ] });
});

test('the early-out does not change what the structural pass does to a document with footnotes', function(){
  //The guard is a shortcut, never a behaviour change: a document it says yes to takes exactly the
  //path it always did, orphan pruning and payload materializing included.
  var delta = { ops: [
    { insert: 'See' }, marker('1'), { insert: '\n' },
    ...body('kept, its marker is still there', '1'),
    ...body('pruned, nothing points at it', '7')
  ]};

  var result = applyStructuralFootnoteChanges(delta);

  assert.deepStrictEqual(result, { ops: [
    { insert: 'See' }, marker('1'), { insert: '\n' },
    ...body('kept, its marker is still there', '1')
  ]});
});

//The live editor runs this one while the caret is inside a note: the writer is mid-sentence in a
//body, so nothing may move, but the numbers still have to be right - see render.js's
//runFootnoteRenumber.
test('renumberFootnotesInPlace numbers every marker and body without moving a line', function(){
  var delta = { ops: [
    { insert: 'a' }, marker('9'), { insert: 'b' }, marker('3'), { insert: '\n' },
    ...body('ninth originally', '9'),
    ...body('third originally', '3')
  ]};

  //Marker 9 comes first in the prose, so it becomes 1 - and its body stays below the other one,
  //where the full pass would have swapped them.
  assert.deepStrictEqual(renumberFootnotesInPlace(delta), { ops: [
    { insert: 'a' }, marker('1'), { insert: 'b' }, marker('2'), { insert: '\n' },
    ...body('ninth originally', '1'),
    ...body('third originally', '2')
  ]});
});

//The case the caret guard used to swallow whole: pressing Enter inside a note body leaves a second
//paragraph carrying the same id and no continuation mark, so it printed a number of its own until
//the writer left the note and the full pass finally ran.
test('renumberFootnotesInPlace marks a note\'s second paragraph as a continuation', function(){
  var delta = { ops: [
    { insert: 'a' }, marker('1'), { insert: '\n' },
    { insert: 'the note' },        { insert: '\n', attributes: { footnoteBody: '1' } },
    { insert: 'a new paragraph' }, { insert: '\n', attributes: { footnoteBody: '1' } }
  ]};

  assert.deepStrictEqual(renumberFootnotesInPlace(delta), { ops: [
    { insert: 'a' }, marker('1'), { insert: '\n' },
    { insert: 'the note' },        { insert: '\n', attributes: { footnoteBody: '1' } },
    { insert: 'a new paragraph' },
    { insert: '\n', attributes: { footnoteBody: '1', footnoteBodyCont: true } }
  ]});
});

//Same rule as the full pass: a body with no marker is not the in-place pass's to number either.
test('renumberFootnotesInPlace leaves an orphaned body alone', function(){
  var delta = { ops: [
    { insert: 'no more reference here' }, { insert: '\n' },
    ...body('orphaned note', '7')
  ]};

  assert.deepStrictEqual(renumberFootnotesInPlace(delta), delta);
});

//Every number it assigns is one embed swapped for another and one line attribute changed, never an
//insertion or a deletion of text - which is what lets render.js apply it under a caret that is
//sitting in one of the very bodies being relabelled.
test('renumberFootnotesInPlace is length-neutral', function(){
  var delta = { ops: [
    { insert: 'a' }, marker('4'), { insert: 'b' }, marker('2'), { insert: '\n' },
    ...body('one', '4'),
    ...body('two', '2')
  ]};

  function length(d){
    return d.ops.reduce(function(sum, op){
      return sum + (typeof op.insert === 'string' ? op.insert.length : 1);
    }, 0);
  }

  assert.strictEqual(length(renumberFootnotesInPlace(delta)), length(delta));
});
