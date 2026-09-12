const Quill = require('quill');
const { parseDelta } = require('./quill-utils');
const { classifyLine } = require('./fountain');
const { ELEMENT_TYPES } = require('../blots/screenplay');

//The editor side of screenplay mode - see docs/screenplay-plan.md, "The editor" and "Keyboard".
//Everything here is a function of a Quill instance and a delta; nothing reads the DOM for content.

// ------------------------------------------------------------------------------------------
// Loading
// ------------------------------------------------------------------------------------------

//Loads a script into the editor by building its HTML and letting Parchment read it in one pass,
//rather than through setContents(). setContents is quadratic in the number of lines in Quill
//1.3.7: applyDelta (core/editor.js) formats each line with a scroll.formatAt that finds its line
//by walking the scroll's children from the head, so a 2,700-line script took seconds. Assigning
//the HTML and calling update() is the same path a native paste takes - the MutationObserver's
//records are taken and every added node is built into a blot in one linear walk - and measured
//at a third of the cost with attributors and a sixth with the old branch's blots.
//
//One invariant makes this safe: the HTML only ever comes from the delta, through
//deltaToScreenplayHtml below, never from a file or the clipboard. Silent, so the text-change
//handler (which acts on 'user' only) marks nothing dirty; the history is cleared because a load
//is not something to undo.
function loadScreenplayDelta(quill, delta){
  quill.root.innerHTML = deltaToScreenplayHtml(delta);
  quill.update('silent');
  quill.history.clear();
}

//One <p> per line with the element class Parchment's attributor reads back, the flags as the
//data attributes theirs read, and the three inline formats as the tags Quill's own blots match.
function deltaToScreenplayHtml(delta){
  var html = '';

  parseDelta(delta || { ops: [{ insert: '\n' }] }).paragraphs.forEach(function(para){
    var attributes = para.attributes || {};
    var open = '<p';
    if(ELEMENT_TYPES.indexOf(attributes.element) !== -1 && attributes.element !== 'action')
      open += ' class="sp-' + attributes.element + '"';
    if(attributes.tight)
      open += ' data-sp-tight="true"';
    if(attributes.dual)
      open += ' data-sp-dual="true"';
    open += '>';

    var inner = '';
    para.textRuns.forEach(function(run){
      if(typeof run.text !== 'string' || run.text === '')
        return;

      var text = escapeHtml(run.text);
      var styles = run.attributes || {};
      if(styles.underline) text = '<u>' + text + '</u>';
      if(styles.italic) text = '<em>' + text + '</em>';
      if(styles.bold) text = '<strong>' + text + '</strong>';
      inner += text;
    });

    //Quill's own empty line, which is what setContents would have built.
    html += open + (inner === '' ? '<br>' : inner) + '</p>';
  });

  return html;
}

function escapeHtml(text){
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ------------------------------------------------------------------------------------------
// Elements
// ------------------------------------------------------------------------------------------

//The types whose text is upper-cased when a line becomes one. The CSS draws capitals regardless;
//this is what puts them in the file, so a cue reads as a cue to the spec without a force marker.
const UPPERCASED = ['scene', 'character', 'transition'];

//The line at an index, with the numbers the handlers below need. `index` is where the line
//starts and `length` counts its terminating newline, as Quill's own line.length() does.
function lineAt(quill, index){
  var found = quill.getLine(index);
  var line = found[0];
  return { line: line, offset: found[1], index: quill.getIndex(line), length: line.length() };
}

function elementOf(line){
  var formats = line.formats();
  return formats.element || 'action';
}

//Makes the line (or every line the selection touches) the given element: one formatLine, since
//the type is an attributor, plus the capitals for the three types that take them. Action is the
//absence of an element. The dual mark belongs to cues alone and comes off with any other type.
function setElement(quill, type, range){
  range = range || quill.getSelection(true);
  if(!range)
    return;

  var formats = { element: type === 'action' ? false : type };
  if(type !== 'character')
    formats.dual = false;

  quill.formatLine(range.index, range.length, formats, 'user');

  if(UPPERCASED.indexOf(type) !== -1)
    uppercaseLines(quill, range.index, range.length);
}

//Replaces each line's text with its upper case, run by run so the inline formats are kept, in
//one change per line so a Ctrl+Z takes the capitals off together with the type that brought them
//(Quill's history merges user changes that land within its delay).
function uppercaseLines(quill, index, length){
  var Delta = Quill.import('delta');

  quill.getLines(index, Math.max(length, 1)).forEach(function(line){
    var start = quill.getIndex(line);
    var textLength = line.length() - 1;
    if(textLength <= 0)
      return;

    var ops = quill.getContents(start, textLength).ops;
    var changed = ops.some(function(op){ return typeof op.insert === 'string' && op.insert !== op.insert.toUpperCase(); });
    if(!changed)
      return;

    var change = new Delta().retain(start).delete(textLength);
    ops.forEach(function(op){
      change.insert(typeof op.insert === 'string' ? op.insert.toUpperCase() : op.insert, op.attributes);
    });

    quill.updateContents(change, 'user');
  });
}

// ------------------------------------------------------------------------------------------
// Keys
// ------------------------------------------------------------------------------------------

//What Enter at the end of a line makes next, as Final Draft has it: a cue is followed by dialogue
//and dialogue by the next cue, a heading by action, a transition by a heading.
const NEXT_ON_ENTER = {
  scene: 'action',
  action: 'action',
  character: 'dialogue',
  parenthetical: 'dialogue',
  dialogue: 'character',
  transition: 'scene'
};

//Splits the line at `index`, leaving the text before it as `currentType` and the text after it
//(or an empty line, when the caret was at the end) as `nextType`. The inserted newline carries the
//current line's own formats, so the text before the caret keeps them - Quill's own Enter does the
//same - and the line after is then given its type outright, which is what clears the dual mark and
//the tight flag rather than copying them down.
function splitLine(quill, index, currentType, nextType, tight){
  var info = lineAt(quill, index);

  if(currentType !== elementOf(info.line)){
    setElement(quill, currentType, { index: info.index, length: 0 });
    info = lineAt(quill, index);
  }

  quill.insertText(index, '\n', info.line.formats(), 'user');
  quill.formatLine(index + 1, 1, {
    element: nextType === 'action' ? false : nextType,
    tight: Boolean(tight),
    dual: false
  }, 'user');
  quill.setSelection(index + 1, 0, 'user');
}

//The Enter binding. Everything it decides is in the table in docs/screenplay-plan.md, "Keyboard":
//
//  empty line, not action  -> the line becomes action (the way out of a type chosen by mistake)
//  caret at the start      -> the line moves down and an empty action line opens above it
//  caret at the end        -> a new line of the type that follows this one; an action line that
//                             reads as a heading or transition is converted first
//  caret in the middle     -> the line splits into two of the same type
//
//A selection is left to Quill, and so is every keypress while the editor shows prose - returning
//true is what hands a binding on (modules/keyboard.js listen()). Unshifted onto Quill's list by
//attachScreenplayKeys so it runs before Quill's own Enter, which would copy the line's type down.
function screenplayEnterBinding(quill, getMode){
  return {
    key: 13,
    handler: function(range){
      if(getMode() !== 'screenplay' || range.length > 0)
        return true;

      var info = lineAt(quill, range.index);
      var type = elementOf(info.line);
      var textLength = info.length - 1;

      if(textLength === 0){
        if(type === 'action')
          splitLine(quill, range.index, 'action', 'action', false);
        else
          setElement(quill, 'action', { index: info.index, length: 0 });
        return false;
      }

      if(info.offset === 0){
        quill.insertText(range.index, '\n', { element: false, tight: false, dual: false }, 'user');
        quill.setSelection(range.index + 1, 0, 'user');
        return false;
      }

      if(info.offset < textLength){
        splitLine(quill, range.index, type, type, false);
        return false;
      }

      var current = type;
      var next = NEXT_ON_ENTER[type] || 'action';

      //The one place the editor classifies text: "INT. KITCHEN - DAY" or "CUT TO:" typed as plain
      //action becomes what it is, with no shortcut. Asked as the codec would read the line after a
      //blank line and before one, which is where a heading or a transition stands.
      if(type === 'action'){
        var read = classifyLine(quill.getText(info.index, textLength), { blankBefore: true, nextBlank: true, inDialogue: false });
        if(read.type === 'scene' || read.type === 'transition'){
          current = read.type;
          next = read.type === 'scene' ? 'action' : 'scene';
        }
      }

      splitLine(quill, range.index, current, next, false);
      return false;
    }
  };
}

//Shift+Enter: a new line of the same type with the tight flag - a second line of action with no
//blank line before it in the file, or a line break inside a speech.
function screenplayShiftEnterBinding(quill, getMode){
  return {
    key: 13,
    shiftKey: true,
    handler: function(range){
      if(getMode() !== 'screenplay' || range.length > 0)
        return true;

      var info = lineAt(quill, range.index);
      splitLine(quill, range.index, elementOf(info.line), elementOf(info.line), true);
      return false;
    }
  };
}

//Tab moves to the element a writer reaches for next from where they are, again as Final Draft
//has it: action becomes a cue, a cue or a speech opens a parenthetical under it with the caret
//between the parentheses, a parenthetical opens the speech, a transition becomes a heading. On
//an empty heading it types the "INT. " a heading almost always starts with.
function screenplayTabBinding(quill, getMode){
  return {
    key: 9,
    handler: function(range){
      if(getMode() !== 'screenplay')
        return true;

      var info = lineAt(quill, range.index);
      var type = elementOf(info.line);
      var end = info.index + info.length - 1;

      switch(type){
        case 'scene':
          if(info.length <= 1){
            quill.insertText(range.index, 'INT. ', 'user');
            quill.setSelection(range.index + 5, 0, 'user');
          }
          break;
        case 'action':
          setElement(quill, 'character', { index: info.index, length: 0 });
          break;
        case 'character':
        case 'dialogue':
          splitLine(quill, end, type, 'parenthetical', false);
          quill.insertText(end + 1, '()', 'user');
          quill.setSelection(end + 2, 0, 'user');
          break;
        case 'parenthetical':
          splitLine(quill, end, type, 'dialogue', false);
          break;
        case 'transition':
          setElement(quill, 'scene', { index: info.index, length: 0 });
          break;
        default:
          setElement(quill, 'action', { index: info.index, length: 0 });
      }

      return false;
    }
  };
}

//Shift+Tab has no meaning in a script, and Quill's own would outdent a list that cannot exist
//there or delete a tab that was never typed - swallowed rather than handed on.
function screenplayShiftTabBinding(getMode){
  return {
    key: 9,
    shiftKey: true,
    handler: function(){
      return getMode() !== 'screenplay';
    }
  };
}

//Installs the four bindings ahead of Quill's own for the same keys. Unshifted straight onto the
//keyboard's lists rather than added through addBinding, which appends - Quill's Enter and Tab
//handlers are added in its constructor after the named options.bindings, so nothing added later
//by the supported route can run before them (see render.js's setup for the footnote Enter binding,
//which has the same problem and the same answer). Attached once; each handler asks getMode() when
//it fires, so a project change needs nothing re-attached.
function attachScreenplayKeys(quill, getMode){
  var bindings = quill.keyboard.bindings;
  bindings[13] = bindings[13] || [];
  bindings[9] = bindings[9] || [];

  bindings[13].unshift(screenplayShiftEnterBinding(quill, getMode));
  bindings[13].unshift(screenplayEnterBinding(quill, getMode));
  bindings[9].unshift(screenplayShiftTabBinding(getMode));
  bindings[9].unshift(screenplayTabBinding(quill, getMode));
}

module.exports = {
  loadScreenplayDelta,
  deltaToScreenplayHtml,
  setElement,
  elementOf,
  lineAt,
  attachScreenplayKeys,
  screenplayEnterBinding,
  screenplayShiftEnterBinding,
  screenplayTabBinding,
  screenplayShiftTabBinding
};
