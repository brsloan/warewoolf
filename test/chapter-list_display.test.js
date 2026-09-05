const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const { renderChapterList, renameChapterInList } = require('../src/components/views/chapter-list_display');

//The three lists and their headers, as index.html lays them out inside the sidebar.
function bodyShell(){
  return '<div id="chapter-list-sidebar">' +
      '<h1 id="chapters-header">Chapters</h1>' +
      '<ul id="chapter-list"></ul>' +
      '<h1 id="reference-header">Reference</h1>' +
      '<ul id="reference-list"></ul>' +
      '<h1 id="trash-header">Trash</h1>' +
      '<ul id="trash-list"></ul>' +
    '</div>';
}

//Rendering only reads title/hasUnsavedChanges off a chapter, so a labelled object is enough.
function chap(title, hasUnsavedChanges){
  return { title: title, hasUnsavedChanges: Boolean(hasUnsavedChanges) };
}

function makeProject(chapters, reference, trash, activeChapterIndex){
  return {
    chapters: chapters || [],
    reference: reference || [],
    trash: trash || [],
    activeChapterIndex: activeChapterIndex || 0
  };
}

function noopHandlers(){
  return { onSelect: function(){}, onRename: function(){} };
}

function rowTitles(listId){
  return Array.from(document.querySelectorAll('#' + listId + ' li')).map(function(li){ return li.textContent; });
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete global.window;
  delete global.document;
});

//---------------------------------------------------------------------------
// renderChapterList
//---------------------------------------------------------------------------

test('each list renders into its own element, with untitled chapters and unsaved markers spelled out', function(){
  renderChapterList(
    makeProject([chap('c0'), chap('', true)], [chap('r0')], [chap('t0', true)]),
    noopHandlers()
  );

  assert.deepStrictEqual(rowTitles('chapter-list'), ['c0', '(untitled)*']);
  assert.deepStrictEqual(rowTitles('reference-list'), ['r0']);
  assert.deepStrictEqual(rowTitles('trash-list'), ['t0*']);
});

test('every row carries its combined index, counting on across the three lists', function(){
  renderChapterList(
    makeProject([chap('c0'), chap('c1')], [chap('r0')], [chap('t0')]),
    noopHandlers()
  );

  assert.deepStrictEqual(
    Array.from(document.querySelectorAll('li')).map(function(li){ return li.dataset.chapIndex; }),
    ['0', '1', '2', '3']
  );
});

test('the active row is highlighted wherever it falls, including in trash', function(){
  renderChapterList(
    makeProject([chap('c0')], [chap('r0')], [chap('t0')], 2),
    noopHandlers()
  );

  var active = document.querySelectorAll('.activeChapter');
  assert.strictEqual(active.length, 1);
  assert.strictEqual(active[0].textContent, 't0');
});

test('clicking a row selects it and double-clicking renames it, both by combined index', function(){
  var selected = [];
  var renamed = [];

  renderChapterList(
    makeProject([chap('c0')], [chap('r0')], [], 0),
    { onSelect: function(i){ selected.push(i); }, onRename: function(i){ renamed.push(i); } }
  );

  document.querySelector('#reference-list li').onclick.call(document.querySelector('#reference-list li'));
  document.querySelector('#reference-list li').ondblclick.call(document.querySelector('#reference-list li'));

  assert.deepStrictEqual(selected, ['1']);
  assert.deepStrictEqual(renamed, ['1']);
});

test('the reference and trash headers grey out only while their lists are empty', function(){
  renderChapterList(makeProject([chap('c0')]), noopHandlers());

  assert.ok(document.getElementById('reference-header').classList.contains('trash-header-empty'));
  assert.ok(document.getElementById('trash-header').classList.contains('trash-header-empty'));

  renderChapterList(makeProject([chap('c0')], [chap('r0')], [chap('t0')]), noopHandlers());

  assert.ok(!document.getElementById('reference-header').classList.contains('trash-header-empty'));
  assert.ok(!document.getElementById('trash-header').classList.contains('trash-header-empty'));
});

test('re-rendering replaces the previous rows instead of appending to them', function(){
  var project = makeProject([chap('c0'), chap('c1')]);

  renderChapterList(project, noopHandlers());
  renderChapterList(project, noopHandlers());

  assert.strictEqual(document.querySelectorAll('#chapter-list li').length, 2);
});

//---------------------------------------------------------------------------
// renameChapterInList
//---------------------------------------------------------------------------

function renderThenRename(handlers, combinedIndex){
  renderChapterList(makeProject([chap('Old Title')], [chap('r0')]), noopHandlers());
  return renameChapterInList(combinedIndex === undefined ? 0 : combinedIndex, handlers);
}

function pressKey(nameBox, key){
  nameBox.dispatchEvent(new window.KeyboardEvent('keydown', { key: key, bubbles: true, cancelable: true }));
}

test('renaming swaps the row text for an empty box and focuses it', function(){
  var nameBox = renderThenRename({ onCommit: function(){}, onCancel: function(){}, onDismiss: function(){} });

  assert.ok(nameBox);
  assert.strictEqual(nameBox.value, '', 'typing replaces the name outright rather than editing it');
  assert.strictEqual(document.activeElement, nameBox);
  assert.strictEqual(document.querySelectorAll('.name-box').length, 1);
});

test('Enter and Tab both commit the typed title', function(){
  ['Enter', 'Tab'].forEach(function(key){
    document.body.innerHTML = bodyShell();

    var committed = null;
    var nameBox = renderThenRename({
      onCommit: function(title){ committed = title; },
      onCancel: function(){ throw new Error('should not cancel'); },
      onDismiss: function(){ throw new Error('should not dismiss'); }
    });

    nameBox.value = 'New Title';
    pressKey(nameBox, key);

    assert.strictEqual(committed, 'New Title', key + ' should commit');
    assert.strictEqual(document.querySelector('.name-box'), null);
  });
});

test('Escape abandons the rename without committing anything', function(){
  var cancelled = false;
  var nameBox = renderThenRename({
    onCommit: function(){ throw new Error('should not commit'); },
    onCancel: function(){ cancelled = true; },
    onDismiss: function(){ throw new Error('should not dismiss'); }
  });

  nameBox.value = 'Discarded';
  pressKey(nameBox, 'Escape');

  assert.strictEqual(cancelled, true);
  assert.strictEqual(document.querySelector('.name-box'), null);
});

//Escape pulls focus back to the editor but blur must not, so they are reported separately.
test('losing focus dismisses the rename through its own handler', function(){
  var dismissed = false;
  var nameBox = renderThenRename({
    onCommit: function(){ throw new Error('should not commit'); },
    onCancel: function(){ throw new Error('should not cancel'); },
    onDismiss: function(){ dismissed = true; }
  });

  nameBox.onblur();

  assert.strictEqual(dismissed, true);
  assert.strictEqual(document.querySelector('.name-box'), null);
});

test('committing does not also fire the dismiss handler as the box is torn down', function(){
  var dismissed = false;
  var nameBox = renderThenRename({
    onCommit: function(){},
    onCancel: function(){},
    onDismiss: function(){ dismissed = true; }
  });

  pressKey(nameBox, 'Enter');

  assert.strictEqual(dismissed, false);
});

test('renaming a row that is not on screen does nothing rather than throwing', function(){
  var result = renderThenRename({ onCommit: function(){}, onCancel: function(){}, onDismiss: function(){} }, 99);

  assert.strictEqual(result, null);
  assert.strictEqual(document.querySelector('.name-box'), null);
});

test('starting a second rename replaces the first box rather than leaving two', function(){
  var handlers = { onCommit: function(){}, onCancel: function(){}, onDismiss: function(){} };
  renderThenRename(handlers, 0);
  renameChapterInList(1, handlers);

  assert.strictEqual(document.querySelectorAll('.name-box').length, 1);
});

//Regression: opening a new project while a rename was in progress threw
//"Failed to execute 'removeChild' on 'Node': The node to be removed is no longer a child of this
//node" from inside clearChildren(). The rename box's own onblur handler calls
//removeElementsByClass('name-box'); in a real browser, removing its row (as part of rebuilding the
//sidebar) blurs the still-focused box synchronously, reentering that same cleanup from inside
//clearChildren()'s own removal loop. jsdom does not fire blur synchronously during removeChild the
//way Chromium does, so this cannot reproduce the exception itself - it checks the structural
//guarantee the fix relies on instead: renderChapterList() defuses any leftover box (detaching its
//onblur, not just leaving it to be swept up as an ordinary child node) before it touches the DOM.
test('renderChapterList defuses a name-box left open from a previous render before rebuilding the sidebar', function(){
  renderChapterList(makeProject([chap('c0')]), noopHandlers());
  var nameBox = renameChapterInList(0, { onCommit: function(){}, onCancel: function(){}, onDismiss: function(){} });
  assert.ok(document.querySelector('.name-box'));

  assert.doesNotThrow(function(){
    renderChapterList(makeProject([chap('c0'), chap('c1')]), noopHandlers());
  });

  assert.strictEqual(document.querySelector('.name-box'), null);
  assert.strictEqual(nameBox.onblur, null, 'the leftover box\'s blur handler should be detached, not left dangling on a removed node');
});
