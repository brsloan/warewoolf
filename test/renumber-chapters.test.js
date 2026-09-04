require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');

const { makeChapter, makeProject } = require('./helpers');
const { renumberChaps, insertChapTitle } = require('../src/components/controllers/renumber-chapters');

function untitledFirstLine(){
  return { ops: [ { insert: 'body text' }, { insert: '\n' } ] };
}

function titledFirstLine(oldTitle){
  return { ops: [ { insert: oldTitle }, { insert: '\n', attributes: { header: 1, align: 'center' } }, { insert: 'body text' }, { insert: '\n' } ] };
}

function emptyFirstLine(){
  return { ops: [ { insert: '\n' }, { insert: 'Old Chapter Title' }, { insert: '\n', attributes: { header: 1, align: 'center' } }, { insert: 'body text' }, { insert: '\n' } ] };
}

test('insertChapTitle inserts a centered header title when none exists', function(){
  var chap = makeChapter(untitledFirstLine());
  chap.title = 'Chapter One';

  insertChapTitle(chap);

  var titleOp = chap.contents.ops[0];
  assert.strictEqual(titleOp.insert, 'Chapter One');
  var headerOp = chap.contents.ops[1];
  assert.strictEqual(headerOp.attributes.header, 1);
  assert.strictEqual(headerOp.attributes.align, 'center');

  var text = chap.contents.ops.map(op => op.insert).join('');
  assert.ok(text.indexOf('body text') > -1);
});

test('insertChapTitle replaces the text of an existing header title', function(){
  var chap = makeChapter(titledFirstLine('Old Title'));
  chap.title = 'New Title';

  insertChapTitle(chap);

  var titleOp = chap.contents.ops[0];
  assert.strictEqual(titleOp.insert, 'New Title');
  var headerOp = chap.contents.ops[1];
  assert.strictEqual(headerOp.attributes.header, 1);
  assert.strictEqual(headerOp.attributes.align, 'center');

  var text = chap.contents.ops.map(op => op.insert).join('');
  assert.ok(text.indexOf('Old Title') == -1);
  assert.ok(text.indexOf('body text') > -1);
});

//Regression: getFormat/formatLine were called at index 1 instead of 0, so a blank first line
//caused the *second* paragraph's header format to be read as if it belonged to the first line.
//That made insertChapTitle wrongly take the "replace an existing title" branch instead of the
//"insert a new title" branch, which silently swallowed the pre-existing blank paragraph instead
//of pushing it down after the new title.
test('insertChapTitle preserves the blank first line instead of swallowing it when titling', function(){
  var chap = makeChapter(emptyFirstLine());
  chap.title = 'New Title';

  insertChapTitle(chap);

  var text = chap.contents.ops.map(op => op.insert).join('');
  assert.strictEqual(text, 'New Title\n\n\nOld Chapter Title\nbody text\n');
});

test('renumberChaps sets sequential titles from the template', function(){
  var chapA = makeChapter(untitledFirstLine());
  var chapB = makeChapter(untitledFirstLine());
  var project = makeProject([chapA, chapB]);

  renumberChaps(project, 0, 1, false, true, 'Chapter [num]');

  assert.strictEqual(chapA.title, 'Chapter 1');
  assert.strictEqual(chapB.title, 'Chapter 2');
});

test('renumberChaps uses number words when useNumerals is false', function(){
  var chap = makeChapter(untitledFirstLine());
  var project = makeProject([chap]);

  renumberChaps(project, 0, 0, false, false, 'Chapter [num]');

  assert.strictEqual(chap.title, 'Chapter One');
});

test('renumberChaps only rewrites chapter contents when withinChaps is true', function(){
  var chap = makeChapter(untitledFirstLine());
  var originalContents = chap.contents;
  var project = makeProject([chap]);

  renumberChaps(project, 0, 0, false, true, 'Chapter [num]');

  assert.strictEqual(chap.contents, originalContents);
  assert.strictEqual(chap.hasUnsavedChanges, true);
});

test('renumberChaps rewrites chapter contents with the new title when withinChaps is true', function(){
  var chap = makeChapter(untitledFirstLine());
  var project = makeProject([chap]);

  renumberChaps(project, 0, 0, true, true, 'Chapter [num]');

  assert.strictEqual(chap.contents.ops[0].insert, 'Chapter 1');
  assert.strictEqual(project.hasUnsavedChanges, true);
});
