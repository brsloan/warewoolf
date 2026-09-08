require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');

const { registerFootnoteBlots } = require('../src/components/blots/footnotes');
const {
  attachFootnoteClipboard,
  footnoteEnterBinding
} = require('../src/components/controllers/footnote-navigation');

registerFootnoteBlots();

//The editor's own format list, which is what makes 'footnote'/'footnoteBody' insertable at all -
//scroll.js's whitelist silently drops anything not named here. Mirrors render.js's editorQuill.
const EDITOR_FORMATS = [
  'bold', 'italic', 'strike', 'underline', 'blockquote', 'header', 'align', 'list', 'indent',
  'footnote', 'footnoteBody'
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
