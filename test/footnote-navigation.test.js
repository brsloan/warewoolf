require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');

const { registerFootnoteBlots } = require('../src/components/blots/footnotes');
const {
  attachFootnoteClipboard,
  footnoteEnterBinding,
  insertOrJumpFootnote
} = require('../src/components/controllers/footnote-navigation');

registerFootnoteBlots();

//The editor's own format list, which is what makes 'footnote'/'footnoteBody' insertable at all -
//scroll.js's whitelist silently drops anything not named here. Mirrors render.js's editorQuill.
const EDITOR_FORMATS = [
  'bold', 'italic', 'strike', 'underline', 'blockquote', 'header', 'align', 'list', 'indent',
  'footnote', 'footnoteBody', 'footnoteBodyCont'
];

//Attached to the document rather than detached: both halves of the clipboard handling read the
//live DOM selection (handleCopy through window.getSelection(), handleCut through Quill's own), and
//neither reports a range for a root that isn't in the page.
function makeEditor(ops){
  const Quill = require('quill');
  var container = document.createElement('div');
  document.body.appendChild(container);

  var quill = new Quill(container, { formats: EDITOR_FORMATS });
  quill.setContents({ ops: ops });
  attachFootnoteClipboard(quill);

  return quill;
}

//A stand-in for the real ClipboardEvent, which jsdom does not implement: enough of one for the
//handlers, and it records what was written so a test can assert on it.
function dispatchClipboardEvent(quill, type){
  var written = {};
  var event = new window.Event(type, { bubbles: true, cancelable: true });

  event.clipboardData = {
    setData: function(mime, value){ written[mime] = value; },
    getData: function(mime){ return written[mime] || ''; }
  };

  quill.root.dispatchEvent(event);

  return { written: written, prevented: event.defaultPrevented };
}

//Calls the binding's handler the way Quill's keyboard module would, with the caret where the test
//puts it. Quill's own `collapsed` check happens before this in listen(), and is asserted separately.
function pressEnterAt(quill, index){
  quill.setSelection(index, 0);
  return footnoteEnterBinding(quill).handler({ index: index, length: 0 });
}

//Every marker's number, in document order - getContents() hands the ops back in that order.
function markerNumbers(quill){
  return quill.getContents().ops
    .filter(function(op){ return op.insert && op.insert.footnote; })
    .map(function(op){ return String(op.insert.footnote.n); });
}

function plainText(quill){
  return quill.getContents().ops
    .map(function(op){ return typeof op.insert === 'string' ? op.insert : '[marker]'; })
    .join('');
}

const WITH_FOOTNOTE = [
  { insert: 'See note' },
  { insert: { footnote: { n: '1' } } },
  { insert: ' here.\n' },
  { insert: 'The note body.' },
  { insert: '\n', attributes: { footnoteBody: '1' } }
];

//Regression: handleCut used to delete the selection through Quill whatever handleCopy had done -
//but handleCopy only takes the event over when the selection actually contains a marker, and
//returns early *before* preventDefault otherwise. On every ordinary cut that left two mechanisms
//removing the same characters, with no clipboard written by either: handleCopy had set nothing,
//and the browser's own cut was still armed over a selection Quill had already emptied.
test('cutting a selection with no footnote marker is left entirely to the browser', function(){
  var quill = makeEditor([ { insert: 'plain text here\n' } ]);
  quill.setSelection(0, 5);

  var result = dispatchClipboardEvent(quill, 'cut');

  assert.strictEqual(result.prevented, false, 'the native cut must stay armed');
  assert.deepStrictEqual(result.written, {}, 'nothing should be written to the clipboard');
  assert.strictEqual(plainText(quill), 'plain text here\n', 'Quill must not delete the text itself');
});

test('copying a selection with no footnote marker is left entirely to the browser', function(){
  var quill = makeEditor([ { insert: 'plain text here\n' } ]);
  quill.setSelection(0, 5);

  var result = dispatchClipboardEvent(quill, 'copy');

  assert.strictEqual(result.prevented, false);
  assert.deepStrictEqual(result.written, {});
});

test('copying a marker takes the event over and carries the note body as a payload', function(){
  var quill = makeEditor(WITH_FOOTNOTE);
  quill.setSelection(0, 15);

  var result = dispatchClipboardEvent(quill, 'copy');

  assert.strictEqual(result.prevented, true);

  var html = result.written['text/html'];
  assert.match(html, /class="ww-fnref"/);
  assert.match(html, /data-fn-body=/);
  assert.deepStrictEqual(
    JSON.parse(html.match(/data-fn-body="([^"]*)"/)[1].replace(/&quot;/g, '"')),
    [ { insert: 'The note body.' }, { attributes: { footnoteBody: '1' }, insert: '\n' } ]
  );

  //The plain-text flavour spells the marker the way a writer would type it by hand, rather than
  //carrying the embed's invisible guard characters.
  assert.match(result.written['text/plain'], /\[\^1\]/);

  assert.strictEqual(plainText(quill), 'See note[marker] here.\nThe note body.\n', 'copy must not alter the document');
});

test('cutting a marker writes the payload and deletes the selection exactly once', function(){
  var quill = makeEditor(WITH_FOOTNOTE);
  quill.setSelection(0, 15);

  var result = dispatchClipboardEvent(quill, 'cut');

  assert.strictEqual(result.prevented, true, 'the native cut must be suppressed once Quill owns the deletion');
  assert.match(result.written['text/html'], /data-fn-body=/);
  assert.strictEqual(plainText(quill), '\nThe note body.\n');
});

//Regression: the plain-text flavour was built from the cloned DOM's textContent, which runs blocks
//together - so copying several paragraphs and pasting them outside the app produced one unbroken
//line. Built from the selection's delta instead, where every paragraph end is a real '\n'.
test('the plain-text flavour keeps paragraph breaks and spells markers by hand', function(){
  var quill = makeEditor([
    { insert: 'First para' },
    { insert: { footnote: { n: '1' } } },
    { insert: '.\nSecond para.\nThird para.\n' },
    { insert: 'The note body.' },
    { insert: '\n', attributes: { footnoteBody: '1' } }
  ]);
  quill.setSelection(0, 37);

  var result = dispatchClipboardEvent(quill, 'copy');

  assert.strictEqual(result.written['text/plain'], 'First para[^1].\nSecond para.\nThird para.');
});

//Regression: markerAt() reads range.index, which for a selection is where it starts - so Enter on
//a selection that began immediately before a marker jumped to the note instead of replacing what
//was selected. Quill checks `collapsed` in listen() before calling any handler, so declaring it on
//the binding is what hands that keypress back to Quill's own Enter handler.
test('the Enter binding only claims a collapsed caret', function(){
  var quill = makeEditor(WITH_FOOTNOTE);
  var binding = footnoteEnterBinding(quill);

  assert.strictEqual(binding.key, 13);
  assert.strictEqual(binding.collapsed, true);
});

test('Enter just before a marker jumps to that note\'s body and claims the keypress', function(){
  var quill = makeEditor(WITH_FOOTNOTE);

  //Index 8 is the caret immediately before the marker: 'See note' is eight characters. The body
  //starts at 16 - the marker itself is one more, then ' here.\n' is seven.
  var claimed = pressEnterAt(quill, 8);

  assert.strictEqual(claimed, false, 'returning false is what stops Quill inserting a newline');
  assert.strictEqual(quill.getSelection().index, 16, 'caret moved to the start of the note body');
});

test('Enter anywhere else falls through to Quill\'s own handler', function(){
  var quill = makeEditor(WITH_FOOTNOTE);

  assert.strictEqual(pressEnterAt(quill, 4), true);
  assert.strictEqual(pressEnterAt(quill, 0), true);
});

//Regression: the back-jump left the caret just *after* the marker, which is not a position the
//shortcut reads as "before a marker" - so a second press inserted a whole new footnote instead of
//jumping back into the body, and there was no way to flip between the two.
test('the shortcut jumps from a note body to just before its marker, and back again', function(){
  var quill = makeEditor(WITH_FOOTNOTE);

  //Index 20 is inside the body text: 'See note' plus the marker plus ' here.\n' is sixteen.
  quill.setSelection(20, 0);
  insertOrJumpFootnote(quill);

  assert.strictEqual(quill.getSelection().index, 8, 'caret sits immediately before the marker');

  insertOrJumpFootnote(quill);

  assert.strictEqual(quill.getSelection().index, 16, 'and pressing it again returns to the body');
  assert.strictEqual(plainText(quill), 'See note[marker] here.\nThe note body.\n', 'jumping must not insert anything');
});

//Not navigation, but it needs the same attached-editor harness: the stylesheet keys a note's
//number off these two attributes reaching the DOM, and a block format only does that if it is both
//registered and named in the editor's `formats` list - scroll.js drops anything else without a
//word. The rendered attributes are what src/css/index.css matches on, so asserting them here is
//asserting that a second note still gets a number in front of its body.
test('a body paragraph renders its note id, and only a continuation is marked as one', function(){
  var quill = makeEditor([
    { insert: 'One' }, { insert: { footnote: { n: '1' } } },
    { insert: ' two' }, { insert: { footnote: { n: '2' } } }, { insert: '\n' },
    { insert: 'First note.' },     { insert: '\n', attributes: { footnoteBody: '1' } },
    { insert: 'Still note one.' }, { insert: '\n', attributes: { footnoteBody: '1', footnoteBodyCont: true } },
    { insert: 'Second note.' },    { insert: '\n', attributes: { footnoteBody: '2' } }
  ]);

  var bodies = [].slice.call(quill.root.querySelectorAll('[data-footnote]'));

  assert.deepStrictEqual(
    bodies.map(function(el){ return el.getAttribute('data-footnote'); }),
    ['1', '1', '2']
  );

  //The middle paragraph is the only one the stylesheet blanks. The last one is a different note,
  //and used to be blanked too because the rule matched any body paragraph following another.
  assert.deepStrictEqual(
    bodies.map(function(el){ return el.matches('[data-footnote-cont]'); }),
    [false, true, false]
  );
});

//Regression: the new marker is numbered highest + 1 at the point it is built, so a note inserted
//between two others starts life spelled "3" with its body at the bottom of the region. Neither of
//render.js's renumber passes used to correct that - the immediate one runs only after a structural
//change, and the debounced one is skipped by the very caret this function parks in the new body -
//so the writer watched the wrong number until they typed outside the note or saved the project.
test('a note inserted between two others is numbered and ordered as it lands', function(){
  var quill = makeEditor([
    { insert: 'One' }, { insert: { footnote: { n: '1' } } },
    { insert: ' two' }, { insert: { footnote: { n: '2' } } }, { insert: '\n' },
    { insert: 'First note.' },  { insert: '\n', attributes: { footnoteBody: '1' } },
    { insert: 'Second note.' }, { insert: '\n', attributes: { footnoteBody: '2' } }
  ]);

  //So the undo assertion below sees only the insertion, rather than an entry setContents merged
  //itself into: History records an 'api' change too, and merges anything within its 1s delay.
  quill.history.clear();
  var before = quill.getContents();

  //Index 6 is mid-word in ' two', between the two markers - and not immediately before the second
  //one, which the shortcut would read as a request to jump rather than to insert.
  quill.setSelection(6, 0);
  insertOrJumpFootnote(quill);

  assert.deepStrictEqual(markerNumbers(quill), ['1', '2', '3'], 'markers number in document order');

  var bodies = [].slice.call(quill.root.querySelectorAll('[data-footnote]'));
  assert.deepStrictEqual(bodies.map(function(el){ return el.getAttribute('data-footnote'); }), ['1', '2', '3']);
  assert.deepStrictEqual(
    bodies.map(function(el){ return el.textContent; }),
    ['First note.', '', 'Second note.'],
    'the new body sits between the notes it now falls between'
  );

  var format = quill.getFormat(quill.getSelection());
  assert.strictEqual(String(format.footnoteBody), '2', 'the caret follows the body to where it moved');

  //The renumbering is part of the insertion, not a separate cosmetic sweep, so one undo takes the
  //whole thing back out - including the number the old second note was given.
  quill.history.undo();
  assert.deepStrictEqual(quill.getContents().ops, before.ops);
});
