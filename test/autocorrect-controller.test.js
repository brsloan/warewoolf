const test = require('node:test');
const assert = require('node:assert');

//Quill touches the DOM as soon as it is required, so this has to come before anything that pulls
//it in - same as quill-utils.test.js.
require('./quill-dom-setup');

const Quill = require('quill');
const { attachAutocorrect } = require('../src/components/controllers/autocorrect');
const { getDefaultRules } = require('../src/components/models/autocorrect');

//A Quill with the substitutions attached, plus the handle on the rules the controller reads
//through - so a test can change them mid-way and watch the next keystroke pick them up.
//
//Built on a container in the document rather than on quill-utils.js's detached getTempQuill(),
//because Quill answers getSelection() with null for an instance it cannot focus - and where the
//cursor ends up after a substitution is one of the things worth pinning down here.
function editorWith(rules){
  var container = document.createElement('div');
  document.body.appendChild(container);

  var quill = new Quill(container, { modules: { history: { userOnly: true } } });
  var current = { rules: rules === undefined ? getDefaultRules() : rules };
  var detach = attachAutocorrect(quill, function(){ return current.rules; });

  quill.focus();

  return { quill: quill, rules: current, detach: detach };
}

//One character at a time at the end of the document, which is as close to a keystroke as this gets
//without a browser: Quill emits the same single-character 'user' delta either way. The trailing
//newline every Quill document ends with is what the -1 steps back over.
function type(quill, text, formats){
  text.split('').forEach(function(character){
    if(formats)
      quill.insertText(quill.getLength() - 1, character, formats, 'user');
    else
      quill.insertText(quill.getLength() - 1, character, 'user');
  });
}

//Typing the way a browser does it, which is the other way around from insertText(): the character
//goes into the DOM text node, the native caret moves past it, and Quill is told to catch up
//afterwards. Worth the extra work for the caret tests below - insertText() never touches the DOM
//selection, so Quill has no stale native offset to put the caret back to and the mid-sentence bug
//cannot show at all.
function typeNatively(quill, index, text){
  text.split('').forEach(function(character, offset){
    var at = index + offset;
    var leaf = quill.getLeaf(at)[0];
    var node = leaf.domNode;
    var into = at - quill.getIndex(leaf);

    node.data = node.data.slice(0, into) + character + node.data.slice(into);

    var range = document.createRange();
    range.setStart(node, into + 1);
    range.collapse(true);

    var selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    quill.update('user');
  });
}

//The substitution puts the caret right in a microtask (see the controller's keepCaret), so a test
//that wants to see where it ended up has to let the queue drain first.
function settled(){
  return new Promise(function(resolve){ setTimeout(resolve, 0); });
}

//Without the trailing newline, which is Quill's own and not something a test wrote.
function textOf(quill){
  return quill.getText().slice(0, -1);
}

//---------------------------------------------------------------------------
// the substitutions, typed
//---------------------------------------------------------------------------

test('a quoted line of dialogue comes out with curly quotes', function(){
  var editor = editorWith();

  type(editor.quill, '"Get out," she said.');

  assert.strictEqual(textOf(editor.quill), '“Get out,” she said.');
});

test('an apostrophe typed inside a word closes', function(){
  var editor = editorWith();

  type(editor.quill, "don't");

  assert.strictEqual(textOf(editor.quill), 'don’t');
});

test('two hyphens typed in a row become an em dash', function(){
  var editor = editorWith();

  type(editor.quill, 'wait--no');

  assert.strictEqual(textOf(editor.quill), 'wait—no');
});

test('three periods typed in a row become an ellipsis', function(){
  var editor = editorWith();

  type(editor.quill, 'well...');

  assert.strictEqual(textOf(editor.quill), 'well…');
});

test('ordinary typing is left exactly as it was written', function(){
  var editor = editorWith();

  type(editor.quill, 'The quick brown fox, well-fed, jumped.');

  assert.strictEqual(textOf(editor.quill), 'The quick brown fox, well-fed, jumped.');
});

test('a quote opening the second line is not judged by the end of the first', function(){
  var editor = editorWith();

  type(editor.quill, 'said\n"Hello"');

  assert.strictEqual(textOf(editor.quill), 'said\n“Hello”');
});

test('a substitution leaves the cursor after the character it inserted', function(){
  var editor = editorWith();

  type(editor.quill, 'wait--');

  var selection = editor.quill.getSelection();

  assert.strictEqual(selection.index, 5);
  assert.strictEqual(selection.length, 0);
});

//Quill restores the caret from an offset it measured before the substitution shortened the line,
//and an offset into a text node does not move with the text. At the end of a line the stale offset
//is past the end of the text and the restore quietly fails, which is why these two are worth
//having: mid-sentence is the only place it lands anywhere at all.
test('an em dash typed mid-sentence leaves the cursor on the dash, not past it', async function(){
  var editor = editorWith();

  editor.quill.setContents({ ops: [{ insert: 'wait no\n' }] });
  editor.quill.setSelection(4, 0);
  typeNatively(editor.quill, 4, '--');
  await settled();

  assert.strictEqual(textOf(editor.quill), 'wait— no');
  assert.strictEqual(editor.quill.getSelection().index, 5);
  assert.strictEqual(editor.quill.getSelection().length, 0);
});

test('an ellipsis typed mid-sentence leaves the cursor on it, not two characters past', async function(){
  var editor = editorWith();

  editor.quill.setContents({ ops: [{ insert: 'well then\n' }] });
  editor.quill.setSelection(4, 0);
  typeNatively(editor.quill, 4, '...');
  await settled();

  assert.strictEqual(textOf(editor.quill), 'well… then');
  assert.strictEqual(editor.quill.getSelection().index, 5);
  assert.strictEqual(editor.quill.getSelection().length, 0);
});

test('an em dash typed at the end of a line still leaves the cursor after it', async function(){
  var editor = editorWith();

  editor.quill.setContents({ ops: [{ insert: 'wait\n' }] });
  editor.quill.setSelection(4, 0);
  typeNatively(editor.quill, 4, '--');
  await settled();

  assert.strictEqual(textOf(editor.quill), 'wait—');
  assert.strictEqual(editor.quill.getSelection().index, 5);
  assert.strictEqual(editor.quill.getSelection().length, 0);
});

test('the substituted character keeps the formatting it was typed in', function(){
  var editor = editorWith();

  type(editor.quill, 'wait--', { italic: true });

  var ops = editor.quill.getContents().ops;

  assert.strictEqual(textOf(editor.quill), 'wait—');
  assert.strictEqual(ops.length, 2, 'the em dash should not have broken the run in two');
  assert.deepStrictEqual(ops[0], { insert: 'wait—', attributes: { italic: true } });
});

test('a keystroke that replaces a selection still substitutes', function(){
  var editor = editorWith();

  type(editor.quill, 'wait-XYZ');
  //Select the XYZ and type over it, which is one delta of a retain, an insert and a delete.
  editor.quill.setSelection(5, 3);
  editor.quill.deleteText(5, 3, 'user');
  editor.quill.insertText(5, '-', 'user');

  assert.strictEqual(textOf(editor.quill), 'wait—');
});

//---------------------------------------------------------------------------
// what it leaves alone
//---------------------------------------------------------------------------

test('pasted text is left alone', function(){
  var editor = editorWith();

  //A paste arrives as one insert of many characters, which is not a keystroke.
  editor.quill.insertText(0, 'He said "wait--" and went.', 'user');

  assert.strictEqual(textOf(editor.quill), 'He said "wait--" and went.');
});

test('a chapter loaded into the editor is left alone', function(){
  var editor = editorWith();

  editor.quill.setContents({ ops: [{ insert: 'He said "wait--" and went.\n' }] });

  assert.strictEqual(textOf(editor.quill), 'He said "wait--" and went.');
});

test('a change made by the app rather than by the writer is left alone', function(){
  var editor = editorWith();

  editor.quill.insertText(0, '"', 'api');

  assert.strictEqual(textOf(editor.quill), '"');
});

test('a formatting change is not mistaken for a keystroke', function(){
  var editor = editorWith();

  type(editor.quill, 'wait-');
  editor.quill.formatText(0, 5, 'bold', true, 'user');

  assert.strictEqual(textOf(editor.quill), 'wait-');
});

test('a deletion is not mistaken for a keystroke', function(){
  var editor = editorWith();

  type(editor.quill, 'wait--x');
  editor.quill.deleteText(5, 1, 'user');

  assert.strictEqual(textOf(editor.quill), 'wait—');
});

test('nothing is substituted while every rule is off', function(){
  var editor = editorWith({});

  type(editor.quill, '"wait--no..."');

  assert.strictEqual(textOf(editor.quill), '"wait--no..."');
});

test('nothing is substituted when there are no rules at all', function(){
  var editor = editorWith(null);

  type(editor.quill, '"wait--"');

  assert.strictEqual(textOf(editor.quill), '"wait--"');
});

test('a rule that is off leaves its character alone and the others still fire', function(){
  var editor = editorWith(Object.assign(getDefaultRules(), { emDash: false }));

  type(editor.quill, '"wait--"');

  assert.strictEqual(textOf(editor.quill), '“wait--”');
});

//---------------------------------------------------------------------------
// settings changing under it
//---------------------------------------------------------------------------

test('rules are read on every keystroke, so a change in settings takes effect at once', function(){
  var editor = editorWith();

  type(editor.quill, '"');
  editor.rules.rules = {};
  type(editor.quill, '"');

  assert.strictEqual(textOf(editor.quill), '“"');
});

test('detaching stops the substitutions', function(){
  var editor = editorWith();

  type(editor.quill, '"');
  editor.detach();
  type(editor.quill, 'wait--"');

  assert.strictEqual(textOf(editor.quill), '“wait--"');
});

//---------------------------------------------------------------------------
// undo, which is the way back from a substitution a writer did not want
//---------------------------------------------------------------------------

test('undo puts back what was typed rather than swallowing the word', function(){
  var editor = editorWith();

  type(editor.quill, 'wait--');
  editor.quill.history.undo();

  assert.strictEqual(textOf(editor.quill), 'wait--');
});

test('undo after a smart quote puts the straight quote back', function(){
  var editor = editorWith();

  type(editor.quill, "don'");
  editor.quill.history.undo();

  assert.strictEqual(textOf(editor.quill), "don'");
});

test('what is typed after a substitution does not get folded into undoing it', function(){
  var editor = editorWith();

  type(editor.quill, 'wait--no');
  editor.quill.history.undo();

  assert.strictEqual(textOf(editor.quill), 'wait—');
});

//The undo of a one-character substitution has the very shape a keystroke has - a retain, a
//one-character insert and a delete - so without the history guard in the controller it was
//substituted straight back and the writer could never get their straight quote.
test('an undone substitution stays undone', function(){
  var editor = editorWith();

  type(editor.quill, "don'");
  editor.quill.history.undo();
  editor.quill.history.undo();

  assert.strictEqual(textOf(editor.quill), '');
});

test('redo puts the substitution back', function(){
  var editor = editorWith();

  type(editor.quill, 'wait--');
  editor.quill.history.undo();
  editor.quill.history.redo();

  assert.strictEqual(textOf(editor.quill), 'wait—');
});

test('undoing a backspace restores what was deleted rather than substituting it', function(){
  var editor = editorWith();

  editor.quill.setContents({ ops: [{ insert: 'don-t\n' }] });
  editor.quill.deleteText(3, 1, 'user');
  editor.quill.history.undo();

  assert.strictEqual(textOf(editor.quill), 'don-t');
});
