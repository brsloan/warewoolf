const { substitutionFor, MAX_PREFIX_LOOKBACK } = require('../models/autocorrect');

//Wires models/autocorrect.js's rules to a Quill instance: watches what the writer types and, when a
//rule matches, swaps the characters behind the cursor for what they meant. Both editors get one of
//these (see render.js's setUpQuills), and neither needs re-attaching when a writer changes the
//settings - `getRules` is read on every keystroke rather than captured, the same way keybindings.js
//reads its shortcut map.
//
//Watching 'text-change' rather than binding the trigger keys: Quill's keyboard module matches on
//keyCode, and the keyCode for '"', "'" and '-' is not the same on every keyboard layout. A delta
//says what was actually inserted whatever key produced it, which also means this works for a
//writer typing on an AZERTY or a Dvorak keyboard without a table of layouts.
//
//UNDO is the escape hatch for every case a rule gets wrong, and the two history.cutoff() calls
//below are what make it work. Quill's history merges everything typed within a second into one
//undo entry, so without them Ctrl+Z after 'don't' would delete the whole word rather than putting
//the straight apostrophe back. Cutting before the substitution makes it an entry of its own, and
//cutting after stops the next keystroke merging into it - so Ctrl+Z undoes exactly the
//substitution and leaves what was typed, which is what a writer expects from a word processor.
//
//The substitution has to be applied with 'user' as its source, not 'api'. The editors are built
//with history's userOnly, which records user changes and merely transforms api ones (see Quill's
//modules/history.js) - an api substitution would not be undoable at all, and Ctrl+Z would strip
//the typed characters while leaving the em dash behind.
function attachAutocorrect(quill, getRules){
  //Our own substitution is a 'user' change like any other, so it comes back through this same
  //handler. Nothing it does could match a rule a second time, but the guard keeps that an
  //observation rather than something to rely on.
  var applying = false;

  //An IME (and Android's soft keyboard) emits deltas mid-composition that are neither one
  //character nor final, and correcting one out from under the input method leaves the two
  //disagreeing about what is on screen. Left alone until the composition is committed - at which
  //point it arrives as a multi-character insert, which is not a keystroke and is skipped anyway.
  var composing = false;

  function onCompositionStart(){
    composing = true;
  }

  function onCompositionEnd(){
    composing = false;
  }

  //An undo arrives as a 'user' change of exactly the shape a keystroke has - a retain, a
  //one-character insert and a delete - because undoing a substitution IS putting the typed
  //character back in place of the one that replaced it. Left unguarded, a substitution could not
  //be undone at all: Ctrl+Z on "don’t" restored the straight apostrophe and this immediately
  //curled it again. A redo is the same shape, and so is undoing a backspace.
  //
  //Quill 1.x offers nothing public that says a change came from the history module, so this reads
  //the flag history.js sets around applying one - reaching into a Quill internal the way
  //quill-utils.js already does for the keyboard module's bindings. The version is pinned and 1.x
  //takes no further changes.
  function undoingOrRedoing(){
    return Boolean(quill.history && quill.history.ignoreChange);
  }

  function onTextChange(delta, oldDelta, source){
    if(applying || composing || source !== 'user' || undoingOrRedoing())
      return;

    var typed = typedCharacterFrom(delta);
    if(typed == null)
      return;

    var rules = getRules ? getRules() : null;
    if(rules == null)
      return;

    var substitution = substitutionFor(prefixBefore(quill, typed.index), typed.character, rules);
    if(substitution == null)
      return;

    applySubstitution(typed.index, substitution);
  }

  function applySubstitution(index, substitution){
    //index is where the typed character landed, and deleteBack counts back from the end of it -
    //so this is the first character being replaced.
    var start = index + 1 - substitution.deleteBack;
    //Carried over explicitly, and not optional. Quill treats an insert with no attributes as an
    //insert with no formatting - it diffs the requested attributes against what the text inherits
    //at that position and applies the difference (see applyDelta in Quill's core/editor.js) - so
    //leaving them off would strip the italics, and the heading, off the substituted character.
    //
    //Taken from the character just typed rather than from the whole range being replaced: it is
    //the one whose formatting the substitution is continuing, and asking about a range of more
    //than one character can answer with an array of values where they differ.
    var formats = quill.getFormat(index, 1);

    var ops = [];
    if(start > 0)
      ops.push({ retain: start });
    ops.push(formatted({ insert: substitution.insert }, formats));
    ops.push({ delete: substitution.deleteBack });

    applying = true;
    try{
      quill.history.cutoff();
      quill.updateContents({ ops: ops }, 'user');
      quill.setSelection(start + substitution.insert.length, 0, 'user');
      quill.history.cutoff();
    }
    finally{
      applying = false;
    }
  }

  quill.on('text-change', onTextChange);
  quill.root.addEventListener('compositionstart', onCompositionStart);
  quill.root.addEventListener('compositionend', onCompositionEnd);

  return function detach(){
    quill.off('text-change', onTextChange);
    quill.root.removeEventListener('compositionstart', onCompositionStart);
    quill.root.removeEventListener('compositionend', onCompositionEnd);
  };
}

//The single character a keystroke inserted and where it landed, or null for every other change:
//a paste, an undo, a chapter being loaded, a formatting change, a deletion. Typing is a delta of
//an optional retain, an insert of exactly one character, and - when the keystroke replaced a
//selection - a delete of what it replaced. Anything else is not a keystroke.
function typedCharacterFrom(delta){
  if(delta == null || !Array.isArray(delta.ops) || delta.ops.length === 0)
    return null;

  var ops = delta.ops.slice();
  var index = 0;

  //A retain carrying attributes is a formatting change, not a cursor position.
  if(typeof ops[0].retain === 'number' && ops[0].attributes == null){
    index = ops[0].retain;
    ops.shift();
  }

  if(ops.length === 0 || typeof ops[0].insert !== 'string' || ops[0].insert.length !== 1)
    return null;

  var character = ops[0].insert;
  ops.shift();

  if(ops.length > 1)
    return null;

  if(ops.length === 1 && typeof ops[0].delete !== 'number')
    return null;

  return { index: index, character: character };
}

//The text before the typed character, cut at the start of its line. Cutting there is what stops a
//rule reaching back into the previous paragraph - a quote at the start of a line has to open, and
//it would close if it could see the word that ended the line above.
//
//Read after the change rather than from oldDelta: text-change fires once the insert is applied, so
//everything up to `index` is already what a rule needs to see.
function prefixBefore(quill, index){
  var start = Math.max(0, index - MAX_PREFIX_LOOKBACK);
  var text = quill.getText(start, index - start);
  var lineBreak = text.lastIndexOf('\n');

  return lineBreak === -1 ? text : text.slice(lineBreak + 1);
}

//Quill treats an empty attributes object as a change to make rather than as no formatting, so an
//op only carries one when there is something in it.
function formatted(op, formats){
  if(formats && Object.keys(formats).length > 0)
    op.attributes = formats;

  return op;
}

module.exports = {
  attachAutocorrect
};
