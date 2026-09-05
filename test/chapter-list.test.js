const test = require('node:test');
const assert = require('node:assert');
const chapterList = require('../src/components/controllers/chapter-list');

//These functions only ever read a chapter's identity, never its contents or its file, so a plain
//labelled object is enough to tell one apart from another in an assertion.
function chap(title){
  return { title: title };
}

function makeProject(chapters, reference, trash, activeChapterIndex){
  return {
    chapters: chapters || [],
    reference: reference || [],
    trash: trash || [],
    activeChapterIndex: activeChapterIndex || 0
  };
}

//2 chapters, 1 reference doc, 2 trashed chapters - combined indices 0..4 spanning all three lists.
function mixedProject(){
  return makeProject(
    [chap('c0'), chap('c1')],
    [chap('r0')],
    [chap('t0'), chap('t1')]
  );
}

//---------------------------------------------------------------------------
// toLocator / toCombinedIndex
//---------------------------------------------------------------------------

test('toLocator maps every combined index onto the right list and position', function(){
  var project = mixedProject();

  assert.deepStrictEqual(
    [0, 1, 2, 3, 4].map(function(i){ return chapterList.toLocator(project, i); }),
    [
      { list: 'chapters',  index: 0 },
      { list: 'chapters',  index: 1 },
      { list: 'reference', index: 0 },
      { list: 'trash',     index: 0 },
      { list: 'trash',     index: 1 }
    ]
  );
});

test('toLocator returns null for an index that names no chapter', function(){
  var project = mixedProject();

  assert.strictEqual(chapterList.toLocator(project, 5), null);
  assert.strictEqual(chapterList.toLocator(project, -1), null);
  assert.strictEqual(chapterList.toLocator(makeProject(), 0), null);
});

test('toLocator accepts a combined index that arrived as a string, as it does from a dataset attribute', function(){
  var project = mixedProject();

  assert.deepStrictEqual(chapterList.toLocator(project, '2'), { list: 'reference', index: 0 });
});

test('toCombinedIndex is the exact inverse of toLocator across all three lists', function(){
  var project = mixedProject();

  [0, 1, 2, 3, 4].forEach(function(i){
    assert.strictEqual(chapterList.toCombinedIndex(project, chapterList.toLocator(project, i)), i);
  });
});

test('toCombinedIndex returns -1 for a locator that points outside its list', function(){
  var project = mixedProject();

  assert.strictEqual(chapterList.toCombinedIndex(project, { list: 'reference', index: 7 }), -1);
  assert.strictEqual(chapterList.toCombinedIndex(project, { list: 'nonsense', index: 0 }), -1);
  assert.strictEqual(chapterList.toCombinedIndex(project, null), -1);
});

test('toCombinedIndex offsets a reference position by the chapter count and a trash position by both', function(){
  var project = mixedProject();

  assert.strictEqual(chapterList.toCombinedIndex(project, { list: 'reference', index: 0 }), 2);
  assert.strictEqual(chapterList.toCombinedIndex(project, { list: 'trash', index: 1 }), 4);
});

//---------------------------------------------------------------------------
// clampedLocator
//---------------------------------------------------------------------------

test('clampedLocator lands an out-of-range index on the last chapter in the project', function(){
  var project = mixedProject();

  assert.deepStrictEqual(chapterList.clampedLocator(project, 99), { list: 'trash', index: 1 });
  assert.deepStrictEqual(chapterList.clampedLocator(project, -5), { list: 'chapters', index: 0 });
});

test('clampedLocator returns null when the project has nothing in any list', function(){
  assert.strictEqual(chapterList.clampedLocator(makeProject(), 0), null);
});

//---------------------------------------------------------------------------
// resolve / chapterAt / activeLocator
//---------------------------------------------------------------------------

test('resolve hands back the chapter a locator names', function(){
  var project = mixedProject();

  assert.strictEqual(chapterList.resolve(project, { list: 'reference', index: 0 }).title, 'r0');
  assert.strictEqual(chapterList.resolve(project, { list: 'trash', index: 1 }).title, 't1');
  assert.strictEqual(chapterList.resolve(project, { list: 'trash', index: 9 }), undefined);
  assert.strictEqual(chapterList.resolve(project, null), undefined);
});

test('chapterAt goes straight from a combined index to the chapter', function(){
  var project = mixedProject();

  assert.strictEqual(chapterList.chapterAt(project, 3).title, 't0');
  assert.strictEqual(chapterList.chapterAt(project, 99), undefined);
});

test('activeLocator points at whatever activeChapterIndex currently names', function(){
  var project = mixedProject();
  project.activeChapterIndex = 2;

  assert.deepStrictEqual(chapterList.activeLocator(project), { list: 'reference', index: 0 });
});

//---------------------------------------------------------------------------
// position predicates
//---------------------------------------------------------------------------

test('isFirstInList and isLastInList answer per list, not against the combined run', function(){
  var project = mixedProject();

  //r0 is both the first and the last reference doc, though its combined index is neither 0 nor 4.
  var onlyReference = { list: 'reference', index: 0 };
  assert.strictEqual(chapterList.isFirstInList(project, onlyReference), true);
  assert.strictEqual(chapterList.isLastInList(project, onlyReference), true);

  assert.strictEqual(chapterList.isFirstInList(project, { list: 'trash', index: 0 }), true);
  assert.strictEqual(chapterList.isLastInList(project, { list: 'trash', index: 0 }), false);
});

test('isLastOfAll is true only for the very last chapter across all three lists', function(){
  var project = mixedProject();

  assert.strictEqual(chapterList.isLastOfAll(project, { list: 'trash', index: 1 }), true);
  assert.strictEqual(chapterList.isLastOfAll(project, { list: 'trash', index: 0 }), false);
  assert.strictEqual(chapterList.isLastOfAll(project, { list: 'chapters', index: 1 }), false);
});

//---------------------------------------------------------------------------
// remove / insertAt / append
//---------------------------------------------------------------------------

test('remove takes the chapter out of its own list and leaves the others alone', function(){
  var project = mixedProject();

  var removed = chapterList.remove(project, { list: 'reference', index: 0 });

  assert.strictEqual(removed.title, 'r0');
  assert.deepStrictEqual(project.reference, []);
  assert.strictEqual(project.chapters.length, 2);
  assert.strictEqual(project.trash.length, 2);
});

test('remove returns undefined and changes nothing when the locator names no chapter', function(){
  var project = mixedProject();

  assert.strictEqual(chapterList.remove(project, { list: 'reference', index: 4 }), undefined);
  assert.strictEqual(project.reference.length, 1);
});

test('insertAt puts the chapter at the given position and reports where it landed', function(){
  var project = mixedProject();

  var landed = chapterList.insertAt(project, 'chapters', 1, chap('new'));

  assert.deepStrictEqual(landed, { list: 'chapters', index: 1 });
  assert.deepStrictEqual(project.chapters.map(function(c){ return c.title; }), ['c0', 'new', 'c1']);
});

test('insertAt clamps a position past the end of the list onto the end', function(){
  var project = mixedProject();

  var landed = chapterList.insertAt(project, 'reference', 99, chap('new'));

  assert.deepStrictEqual(landed, { list: 'reference', index: 1 });
});

test('append adds to the end of the named list', function(){
  var project = mixedProject();

  var landed = chapterList.append(project, 'trash', chap('new'));

  assert.deepStrictEqual(landed, { list: 'trash', index: 2 });
  assert.strictEqual(project.trash[2].title, 'new');
});

//---------------------------------------------------------------------------
// selectionAfterRemoval
//---------------------------------------------------------------------------

test('selectionAfterRemoval stays on whatever slid into the removed chapter position', function(){
  var project = makeProject([chap('c0'), chap('c1'), chap('c2')]);
  chapterList.remove(project, { list: 'chapters', index: 1 });

  assert.deepStrictEqual(
    chapterList.selectionAfterRemoval(project, { list: 'chapters', index: 1 }),
    { list: 'chapters', index: 1 }
  );
});

test('selectionAfterRemoval steps back to the new last item when the end of a list was removed', function(){
  var project = makeProject([chap('c0'), chap('c1'), chap('c2')]);
  chapterList.remove(project, { list: 'chapters', index: 2 });

  assert.deepStrictEqual(
    chapterList.selectionAfterRemoval(project, { list: 'chapters', index: 2 }),
    { list: 'chapters', index: 1 }
  );
});

test('selectionAfterRemoval falls back to the last chapter once the emptied list has nothing left', function(){
  var project = makeProject([chap('c0'), chap('c1')], [chap('r0')]);
  chapterList.remove(project, { list: 'reference', index: 0 });

  assert.deepStrictEqual(
    chapterList.selectionAfterRemoval(project, { list: 'reference', index: 0 }),
    { list: 'chapters', index: 1 }
  );
});

test('selectionAfterRemoval falls back to whatever is left when there are no chapters either', function(){
  var project = makeProject([], [], [chap('t0')]);
  chapterList.remove(project, { list: 'reference', index: 0 });

  assert.deepStrictEqual(
    chapterList.selectionAfterRemoval(project, { list: 'reference', index: 0 }),
    { list: 'trash', index: 0 }
  );
});

test('selectionAfterRemoval returns null when the last chapter in the project was removed', function(){
  var project = makeProject([chap('c0')]);
  chapterList.remove(project, { list: 'chapters', index: 0 });

  assert.strictEqual(chapterList.selectionAfterRemoval(project, { list: 'chapters', index: 0 }), null);
});

//---------------------------------------------------------------------------
// moveUp / moveDown
//---------------------------------------------------------------------------

test('moveUp swaps a chapter with the one above it inside the same list', function(){
  var project = makeProject([chap('c0'), chap('c1'), chap('c2')]);

  var landed = chapterList.moveUp(project, { list: 'chapters', index: 2 });

  assert.deepStrictEqual(landed, { list: 'chapters', index: 1 });
  assert.deepStrictEqual(project.chapters.map(function(c){ return c.title; }), ['c0', 'c2', 'c1']);
});

test('moveUp on the first reference doc folds it into the end of the chapters list', function(){
  var project = makeProject([chap('c0')], [chap('r0'), chap('r1')]);

  var landed = chapterList.moveUp(project, { list: 'reference', index: 0 });

  assert.deepStrictEqual(landed, { list: 'chapters', index: 1 });
  assert.deepStrictEqual(project.chapters.map(function(c){ return c.title; }), ['c0', 'r0']);
  assert.deepStrictEqual(project.reference.map(function(c){ return c.title; }), ['r1']);
});

test('moveUp across the chapters/reference seam leaves the combined index unchanged', function(){
  var project = makeProject([chap('c0')], [chap('r0')]);
  var before = chapterList.toCombinedIndex(project, { list: 'reference', index: 0 });

  var landed = chapterList.moveUp(project, { list: 'reference', index: 0 });

  assert.strictEqual(chapterList.toCombinedIndex(project, landed), before);
});

test('moveUp refuses to lift a chapter out of the trash', function(){
  var project = makeProject([chap('c0')], [], [chap('t0')]);

  assert.strictEqual(chapterList.moveUp(project, { list: 'trash', index: 0 }), null);
  assert.strictEqual(project.trash.length, 1);
  assert.strictEqual(project.chapters.length, 1);
});

test('moveUp on the very first chapter does nothing', function(){
  var project = makeProject([chap('c0'), chap('c1')]);

  assert.strictEqual(chapterList.moveUp(project, { list: 'chapters', index: 0 }), null);
  assert.deepStrictEqual(project.chapters.map(function(c){ return c.title; }), ['c0', 'c1']);
});

test('moveDown swaps a chapter with the one below it inside the same list', function(){
  var project = makeProject([], [], [chap('t0'), chap('t1'), chap('t2')]);

  var landed = chapterList.moveDown(project, { list: 'trash', index: 0 });

  assert.deepStrictEqual(landed, { list: 'trash', index: 1 });
  assert.deepStrictEqual(project.trash.map(function(c){ return c.title; }), ['t1', 't0', 't2']);
});

test('moveDown on the last chapter spills it into the front of the reference list', function(){
  var project = makeProject([chap('c0'), chap('c1')], [chap('r0')]);

  var landed = chapterList.moveDown(project, { list: 'chapters', index: 1 });

  assert.deepStrictEqual(landed, { list: 'reference', index: 0 });
  assert.deepStrictEqual(project.chapters.map(function(c){ return c.title; }), ['c0']);
  assert.deepStrictEqual(project.reference.map(function(c){ return c.title; }), ['c1', 'r0']);
});

test('moveDown across the chapters/reference seam leaves the combined index unchanged', function(){
  var project = makeProject([chap('c0'), chap('c1')], [chap('r0')]);
  var before = chapterList.toCombinedIndex(project, { list: 'chapters', index: 1 });

  var landed = chapterList.moveDown(project, { list: 'chapters', index: 1 });

  assert.strictEqual(chapterList.toCombinedIndex(project, landed), before);
});

test('moveDown refuses to push the last reference doc into the trash', function(){
  var project = makeProject([chap('c0')], [chap('r0')], [chap('t0')]);

  assert.strictEqual(chapterList.moveDown(project, { list: 'reference', index: 0 }), null);
  assert.strictEqual(project.reference.length, 1);
  assert.strictEqual(project.trash.length, 1);
});

test('moveDown on the last trashed chapter does nothing', function(){
  var project = makeProject([], [], [chap('t0')]);

  assert.strictEqual(chapterList.moveDown(project, { list: 'trash', index: 0 }), null);
  assert.strictEqual(project.trash.length, 1);
});

test('moving a chapter down and back up again restores the original order', function(){
  var project = makeProject([chap('c0'), chap('c1'), chap('c2')]);

  var down = chapterList.moveDown(project, { list: 'chapters', index: 0 });
  chapterList.moveUp(project, down);

  assert.deepStrictEqual(project.chapters.map(function(c){ return c.title; }), ['c0', 'c1', 'c2']);
});
