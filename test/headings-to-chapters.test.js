require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');

const { getTempQuill } = require('../src/components/controllers/quill-utils');
const breakHeadingsIntoChapters = require('../src/components/controllers/headings-to-chapters');

//Builds a real Quill instance and loads it through setContents rather than handing ops straight
//to breakHeadingsIntoChapters. Quill's delta normalization merges adjacent ops that share the same
//(or no) attributes, so a plain paragraph immediately followed by a plain heading title collapses
//into a single op like "...paragraph text.\nChapter Two" - that merged shape is what the function
//actually sees in the app, and is what exposed the dropped-newline bug.
function quillWithContents(ops){
  var quill = getTempQuill();
  quill.setContents({ ops: ops });
  return quill;
}

function importedChapters(){
  var calls = [];
  var addImportedChapter = function(chap, title){
    calls.push({ chap: chap, title: title });
  };
  return { addImportedChapter, calls };
}

function fullText(ops){
  return ops.map(function(op){ return typeof op.insert === 'string' ? op.insert : ''; }).join('');
}

test('splits a heading-per-section document into chapters, keeping the first section in place', function(){
  var quill = quillWithContents([
    { insert: 'Preface text.' },
    { insert: '\n' },
    { insert: 'Chapter One' },
    { insert: '\n', attributes: { header: 1 } },
    { insert: 'Body text of chapter one.' },
    { insert: '\n' },
    { insert: 'Chapter Two' },
    { insert: '\n', attributes: { header: 1 } },
    { insert: 'Body text of chapter two.' },
    { insert: '\n' }
  ]);

  var { addImportedChapter, calls } = importedChapters();

  breakHeadingsIntoChapters(quill, addImportedChapter, '1');

  //Chapter One's section is intentionally left as the current document (see the i != 0 comment
  //in headings-to-chapters.js), so only Chapter Two should be split off as a new chapter.
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].title, 'Chapter Two');

  var remainingText = fullText(quill.getContents().ops);
  assert.ok(remainingText.indexOf('Preface text.') > -1);
  assert.ok(remainingText.indexOf('Chapter One') > -1);
  assert.ok(remainingText.indexOf('Body text of chapter one.') > -1);
  assert.ok(remainingText.indexOf('Chapter Two') == -1);
});

test('does not lose the paragraph break between a section and the next heading', function(){
  var quill = quillWithContents([
    { insert: 'Chapter One' },
    { insert: '\n', attributes: { header: 1 } },
    { insert: 'Body text of chapter one.' },
    { insert: '\n' },
    { insert: 'Chapter Two' },
    { insert: '\n', attributes: { header: 1 } },
    { insert: 'Body text of chapter two.' },
    { insert: '\n' }
  ]);

  var { addImportedChapter, calls } = importedChapters();

  breakHeadingsIntoChapters(quill, addImportedChapter, '1');

  var remainingText = fullText(quill.getContents().ops);
  assert.strictEqual(remainingText, 'Chapter One\nBody text of chapter one.\n');

  assert.strictEqual(calls.length, 1);
  var newChapterText = fullText(calls[0].chap.ops);
  assert.strictEqual(newChapterText, 'Chapter Two\nBody text of chapter two.\n');
});

test('every produced chapter delta ends in a newline', function(){
  var quill = quillWithContents([
    { insert: 'Chapter One' },
    { insert: '\n', attributes: { header: 1 } },
    { insert: 'Body one.' },
    { insert: '\n' },
    { insert: 'Chapter Two' },
    { insert: '\n', attributes: { header: 1 } },
    { insert: 'Body two.' },
    { insert: '\n' },
    { insert: 'Chapter Three' },
    { insert: '\n', attributes: { header: 1 } },
    { insert: 'Body three.' },
    { insert: '\n' }
  ]);

  var { addImportedChapter, calls } = importedChapters();

  breakHeadingsIntoChapters(quill, addImportedChapter, '1');

  var keptText = fullText(quill.getContents().ops);
  assert.ok(keptText.endsWith('\n'));

  assert.strictEqual(calls.length, 2);
  calls.forEach(function(call){
    var text = fullText(call.chap.ops);
    assert.ok(text.endsWith('\n'), 'expected "' + text + '" to end with a newline');
  });
});

test('does not split on headings of a different level', function(){
  var quill = quillWithContents([
    { insert: 'Chapter One' },
    { insert: '\n', attributes: { header: 1 } },
    { insert: 'Section A' },
    { insert: '\n', attributes: { header: 2 } },
    { insert: 'body' },
    { insert: '\n' }
  ]);

  var { addImportedChapter, calls } = importedChapters();

  breakHeadingsIntoChapters(quill, addImportedChapter, '1');

  assert.strictEqual(calls.length, 0);
});

test('does not crash when a non-text embed sits right before a heading', function(){
  //The embed has to be the op immediately before the header-marked newline itself (not just
  //somewhere near the heading) to exercise the lastIndexOf('\n') call on a non-string insert.
  var quill = quillWithContents([
    { insert: 'Chapter One' },
    { insert: '\n', attributes: { header: 1 } },
    { insert: 'Body one.' },
    { insert: '\n' },
    { insert: { image: 'data:image/png;base64,AAAA' } },
    { insert: '\n', attributes: { header: 1 } },
    { insert: 'Body two.' },
    { insert: '\n' }
  ]);

  var { addImportedChapter, calls } = importedChapters();

  assert.doesNotThrow(function(){
    breakHeadingsIntoChapters(quill, addImportedChapter, '1');
  });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].chap.ops[0].insert.image, 'data:image/png;base64,AAAA');
});

test('is a no-op when there is only one heading section', function(){
  var quill = quillWithContents([
    { insert: 'Chapter One' },
    { insert: '\n', attributes: { header: 1 } },
    { insert: 'Body one.' },
    { insert: '\n' }
  ]);

  var { addImportedChapter, calls } = importedChapters();
  var originalOps = quill.getContents().ops;

  breakHeadingsIntoChapters(quill, addImportedChapter, '1');

  assert.strictEqual(calls.length, 0);
  assert.deepStrictEqual(quill.getContents().ops, originalOps);
});
