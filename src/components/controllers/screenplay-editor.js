const Quill = require('quill');
const { parseDelta, replaceTextPreservingFormats } = require('./quill-utils');
const { classifyLine, deltaToElements, estimatePageStarts } = require('./fountain');
const { ELEMENT_TYPES } = require('../blots/screenplay');

//The editor side of screenplay mode - see docs/screenplay-plan.md, "The editor" and "Keyboard".
//Everything here is a function of a Quill instance and a delta; nothing reads the DOM for
//content.

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

//The types whose text is kept in capitals: put there when a line becomes one, and again as the
//line is typed into (attachScreenplayTyping). The CSS draws capitals regardless; this is what
//puts them in the file, so a cue reads as a cue to the spec without a force marker.
const UPPERCASED = ['scene', 'character', 'transition'];

//The lines that are part of a speech, between its cue and whatever follows.
const SPEECH = ['dialogue', 'parenthetical', 'lyric'];

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

function textOf(quill, info){
  return quill.getText(info.index, info.length - 1);
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
//(Quill's history merges user changes that land within its delay). The caret is put back where it
//was: the replacement is a delete and an insert at the same place, which Quill would otherwise
//carry to the end of the new text.
function uppercaseLines(quill, index, length){
  var selection = quill.getSelection();

  quill.getLines(index, Math.max(length, 1)).forEach(function(line){
    var start = quill.getIndex(line);
    var textLength = line.length() - 1;
    if(textLength <= 0)
      return;

    var text = quill.getText(start, textLength);
    if(text === text.toUpperCase())
      return;

    replaceTextPreservingFormats(quill, start, textLength, function(run){ return run.toUpperCase(); });
  });

  if(selection)
    quill.setSelection(selection.index, selection.length, 'silent');
}

//Opens an empty line of `type` above the line at `index`, which must be the line's start. The
//inserted newline terminates the new line, so it carries the new type; the line pushed down keeps
//its own terminator and so its own formats. The caret is left where it was, which is now the
//empty line.
function insertLineAbove(quill, index, type){
  quill.insertText(index, '\n', { element: type === 'action' ? false : type, tight: false, dual: false }, 'user');
  quill.setSelection(index, 0, 'user');
}

//What an element shortcut does: a selection or an empty line is made the type,
//and a line with text gets a new, empty line of the type instead - above it with the caret at the
//start, below it with the caret at the end, and between the two halves of the line otherwise, the
//halves keeping the line's type. The line's own text is never retyped by a shortcut; that is what
//the reformat shortcuts are for, which call setElement outright.
function insertElement(quill, type, range){
  range = range || quill.getSelection(true);
  if(!range)
    return;

  var info = lineAt(quill, range.index);
  var textLength = info.length - 1;

  if(range.length > 0 || textLength === 0){
    setElement(quill, type, range);
    return;
  }

  if(info.offset === 0){
    insertLineAbove(quill, range.index, type);
    return;
  }

  if(info.offset >= textLength){
    splitLine(quill, range.index, elementOf(info.line), type, false);
    return;
  }

  //Mid-line: split the line into two of its own type, then open the new line between them. The
  //second half is a continuation, so the dual and tight marks come off it as splitLine does.
  var formats = info.line.formats();
  quill.insertText(range.index, '\n', formats, 'user');
  quill.formatLine(range.index + 1, 1, { tight: false, dual: false }, 'user');
  insertLineAbove(quill, range.index + 1, type);
}

//The cue a caret is in: the line itself when it is a cue, or the cue above the speech the caret
//is in. Null anywhere else.
function cueFor(quill, index){
  var info = lineAt(quill, index);
  while(info){
    var type = elementOf(info.line);
    if(type === 'character')
      return info;
    if(SPEECH.indexOf(type) === -1 || info.index === 0)
      return null;
    info = lineAt(quill, info.index - 1);
  }
  return null;
}

//Dual dialogue, as Fountain has it: the mark goes on the cue of the second speaker, and here on
//the cue the caret is on or under. Toggled, so the same key takes it off.
function toggleDual(quill){
  var range = quill.getSelection(true);
  if(!range)
    return;

  var cue = cueFor(quill, range.index);
  if(!cue)
    return;

  quill.formatLine(cue.index, 1, { dual: !cue.line.formats().dual }, 'user');
}

// ------------------------------------------------------------------------------------------
// Keys
// ------------------------------------------------------------------------------------------

//What Enter at the end of a line makes next: a cue is followed by dialogue and dialogue by the
//next cue, a heading by action, a transition by a heading.
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

//A cue's name: the text without its extension and the dual marker, in capitals.
const CUE_EXTENSIONS = /\s*\(.*$/;

function cueName(text){
  return text.replace(CUE_EXTENSIONS, '').replace(/\s*\^$/, '').trim().toUpperCase();
}

//Whether the cue at `info` is the same character speaking again in the same scene after
//something other than speech - action, a transition - which is when a script marks the cue
//(CONT'D). Read from the lines above: back over the previous speech to its cue, noting whether
//anything that is not speech stood between. A heading, a section or a page break ends the search
//with no: a character picking up in a new scene is not continuing. Notes and synopses are not on
//the page and count for nothing; an empty action line is a blank line and counts for nothing
//either.
function continuedCue(quill, info){
  var text = textOf(quill, info);
  if(/\(/.test(text))
    return false;

  var name = cueName(text);
  if(name === '')
    return false;

  var lines = quill.getLines(0, info.index).filter(function(line){ return line !== info.line; });
  var sawBreak = false;

  for(var i = lines.length - 1; i >= 0; i--){
    var type = elementOf(lines[i]);
    if(type === 'character')
      return sawBreak && cueName(quill.getText(quill.getIndex(lines[i]), lines[i].length() - 1)) === name;
    if(SPEECH.indexOf(type) !== -1 || type === 'note' || type === 'synopsis' || type === 'boneyard')
      continue;
    if(type === 'scene' || type === 'section' || type === 'pagebreak')
      return false;
    if(type === 'action' && lines[i].length() <= 1)
      continue;
    sawBreak = true;
  }

  return false;
}

const CONTINUED = " (CONT'D)";

//Trailing spaces are jumped over on Enter and Tab: a caret before nothing but spaces is treated
//as at the end of the line, so the spaces never start the next one.
function skipTrailingSpaces(quill, range, info){
  var textLength = info.length - 1;
  if(info.offset === 0 || info.offset >= textLength)
    return range;

  var rest = quill.getText(range.index, info.index + textLength - range.index);
  if(!/^\s+$/.test(rest))
    return range;

  return { index: info.index + textLength, length: 0 };
}

//The Enter binding. Everything it decides is in the table in docs/screenplay-plan.md, "Keyboard":
//
//  empty line, not action  -> the line becomes action (the way out of a type chosen by mistake)
//  caret at the start      -> the line moves down and an empty line of its own type opens above
//  caret at the end        -> a new line of the type that follows this one; an action line that
//                             reads as a heading or transition is converted first, and a cue that
//                             continues the same character's speech after action gets (CONT'D)
//  caret in the middle     -> the line splits into two of the same type
//
//A selection is left to Quill, and so is every keypress while the editor shows prose - returning
//true is what hands a binding on (modules/keyboard.js listen()). Unshifted onto Quill's list by
//attachScreenplayKeys so it runs before Quill's own Enter, which would copy the line's type down.
function screenplayEnterBinding(quill, getMode){
  return {
    key: 13,
    screenplayKey: 'enter',
    handler: function(range){
      if(getMode() !== 'screenplay' || range.length > 0)
        return true;

      var info = lineAt(quill, range.index);
      range = skipTrailingSpaces(quill, range, info);
      info = lineAt(quill, range.index);
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
        insertLineAbove(quill, range.index, type);
        quill.setSelection(range.index + 1, 0, 'user');
        return false;
      }

      if(info.offset < textLength){
        splitLine(quill, range.index, type, type, false);
        return false;
      }

      var current = type;
      var next = NEXT_ON_ENTER[type] || 'action';

      //The one place the editor classifies text on Enter: "CUT TO:" typed as plain action becomes
      //the transition it is, with no shortcut (a heading was already made one on the space after
      //its "INT." - see attachScreenplayTyping). Asked as the codec would read the line after a
      //blank line and before one, which is where a heading or a transition stands.
      if(type === 'action'){
        var read = classifyLine(textOf(quill, info), { blankBefore: true, nextBlank: true, inDialogue: false });
        if(read.type === 'scene' || read.type === 'transition'){
          current = read.type;
          next = read.type === 'scene' ? 'action' : 'scene';
        }
      }

      if(type === 'character' && continuedCue(quill, info)){
        quill.insertText(range.index, CONTINUED, 'user');
        range = { index: range.index + CONTINUED.length, length: 0 };
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

//A heading's INT./EXT. prefix, its " - DAY" time of day, which is not part of the place, and the
//separator Tab puts between the two.
const HEADING_PREFIX = /^(?:INT\.?\/EXT|EXT\.?\/INT|INT|EXT|EST|I\/E)[.\s\-]+/i;
const HEADING_TIME = /\s+-\s*([^-]*)$/;
const HEADING_NUMBER = /\s*#[^#]*#\s*$/;
const HEADING_SEPARATOR = ' - ';

//Tab moves to the element a writer reaches for next from where they are: action becomes a cue, a
//cue or a speech opens a parenthetical under it with the caret between the parentheses (an empty
//one becomes the parenthetical itself), a parenthetical opens the speech. A heading is stepped through: on an empty one it types the "INT. " a heading almost
//always starts with, and after the place it puts the " - " the time of day follows, which opens
//the list of times. On a transition: nothing with the caret at the start, and an action line
//under it otherwise, since Enter is what opens the heading.
function screenplayTabBinding(quill, getMode){
  return {
    key: 9,
    screenplayKey: 'tab',
    handler: function(range){
      if(getMode() !== 'screenplay')
        return true;

      var info = lineAt(quill, range.index);
      var type = elementOf(info.line);
      var textLength = info.length - 1;
      var end = info.index + textLength;

      switch(type){
        case 'scene':
          if(textLength === 0){
            quill.insertText(range.index, 'INT. ', 'user');
            quill.setSelection(range.index + 5, 0, 'user');
            break;
          }
          var text = textOf(quill, info);
          var prefix = HEADING_PREFIX.exec(text);
          if(prefix && text.slice(prefix[0].length).trim() !== '' && !HEADING_TIME.test(text)){
            var trailing = text.length - text.replace(/\s+$/, '').length;
            if(trailing > 0)
              quill.deleteText(end - trailing, trailing, 'user');
            quill.insertText(end - trailing, HEADING_SEPARATOR, 'user');
            quill.setSelection(end - trailing + HEADING_SEPARATOR.length, 0, 'user');
          }
          break;
        case 'action':
          setElement(quill, 'character', { index: info.index, length: 0 });
          break;
        case 'character':
        case 'dialogue':
          if(textLength === 0){
            setElement(quill, 'parenthetical', { index: info.index, length: 0 });
            quill.insertText(info.index, '()', 'user');
            quill.setSelection(info.index + 1, 0, 'user');
            break;
          }
          splitLine(quill, end, type, 'parenthetical', false);
          quill.insertText(end + 1, '()', 'user');
          quill.setSelection(end + 2, 0, 'user');
          break;
        case 'parenthetical':
          splitLine(quill, end, type, 'dialogue', false);
          break;
        case 'transition':
          if(info.offset > 0)
            splitLine(quill, end, type, 'action', false);
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

//The modifier Quill's own bindings call shortKey - Cmd on a Mac, Ctrl elsewhere. Quill resolves
//it in addBinding's normalize(); the bindings below go on without addBinding (see
//attachScreenplayKeys), so it is resolved here the same way.
const SHORT_KEY = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '') ? 'metaKey' : 'ctrlKey';

//Ctrl+Enter: a new heading, which the autocomplete then offers INT. and EXT. for.
//A fixed binding rather than a shortcut, like Shift+Enter, since Enter is reserved from the
//shortcuts (shortcuts.js RESERVED_KEYS).
function screenplayNewSceneBinding(quill, getMode){
  var binding = {
    key: 13,
    handler: function(range){
      if(getMode() !== 'screenplay')
        return true;
      insertElement(quill, 'scene', range);
      return false;
    }
  };
  binding[SHORT_KEY] = true;
  return binding;
}

//Ctrl+Shift+Enter, Insert Element: the picker of every type a line can be.
function screenplayPickerBinding(quill, getMode){
  var binding = {
    key: 13,
    shiftKey: true,
    handler: function(){
      if(getMode() !== 'screenplay')
        return true;
      require('../views/element-picker_display')(quill);
      return false;
    }
  };
  binding[SHORT_KEY] = true;
  return binding;
}

//Installs the six bindings ahead of Quill's own for the same keys. Unshifted straight onto the
//keyboard's lists rather than added through addBinding, which appends - Quill's Enter and Tab
//handlers are added in its constructor after the named options.bindings, so nothing added later
//by the supported route can run before them (see render.js's setup for the footnote Enter binding,
//which has the same problem and the same answer). Attached once; each handler asks getMode() when
//it fires, so a project change needs nothing re-attached.
function attachScreenplayKeys(quill, getMode){
  var bindings = quill.keyboard.bindings;
  bindings[13] = bindings[13] || [];
  bindings[9] = bindings[9] || [];

  bindings[13].unshift(screenplayPickerBinding(quill, getMode));
  bindings[13].unshift(screenplayNewSceneBinding(quill, getMode));
  bindings[13].unshift(screenplayShiftEnterBinding(quill, getMode));
  bindings[13].unshift(screenplayEnterBinding(quill, getMode));
  bindings[9].unshift(screenplayShiftTabBinding(getMode));
  bindings[9].unshift(screenplayTabBinding(quill, getMode));
}

//The screenplay binding for a key, for the autocomplete to hand the keypress on to once it has
//put the chosen text in: the writer pressed Enter on a cue, and gets the speech under it.
function screenplayBindingFor(quill, key){
  var code = key === 'tab' ? 9 : 13;
  return (quill.keyboard.bindings[code] || []).find(function(binding){ return binding.screenplayKey === key; }) || null;
}

// ------------------------------------------------------------------------------------------
// Typing - what changes as the text does, docs/screenplay-plan.md, "Keyboard"
// ------------------------------------------------------------------------------------------

//The whole of an action line that has just become the start of a heading: "INT. " and its kin,
//period and space, nothing else. The line becomes a heading the moment that space is typed.
const HEADING_START = /^(?:INT\.?\/EXT|EXT\.?\/INT|INT|EXT|EST|I\/E)\.\s$/i;

//Two things done on every user change while the editor shows a script. First, an action line that
//has just been typed as "INT. " becomes a heading, so the writer sees the
//heading style while typing the place and the location list can open on it. Second, the lines the
//change touched are kept in capitals where their type takes them: a cue, heading or transition is
//stored the way it is shown, so the file carries "BOB" and not a forced "@bob". Both changes go
//in as user changes within Quill's history delay, so Ctrl+Z takes the typed character and its
//consequence off together. Nothing is done while an IME composition is open, which a replacement
//under it would break, and nothing on the changes made here (the busy guard) or on a load.
function attachScreenplayTyping(quill, getMode){
  var busy = false;
  var composing = false;

  quill.root.addEventListener('compositionstart', function(){ composing = true; });
  quill.root.addEventListener('compositionend', function(){ composing = false; });

  quill.on('text-change', function(delta, oldDelta, source){
    if(busy || composing || source !== 'user' || getMode() !== 'screenplay')
      return;

    var span = touchedSpan(delta);
    if(!span)
      return;

    busy = true;
    try{
      if(span.insertedSpace){
        var info = lineAt(quill, span.end - 1);
        if(elementOf(info.line) === 'action' && HEADING_START.test(textOf(quill, info)))
          setElement(quill, 'scene', { index: info.index, length: 0 });
      }

      var start = quill.getIndex(quill.getLine(span.start)[0]);
      quill.getLines(start, Math.max(span.end - start, 1)).forEach(function(line){
        if(UPPERCASED.indexOf(elementOf(line)) !== -1)
          uppercaseLines(quill, quill.getIndex(line), 1);
      });
    }
    finally{
      busy = false;
    }
  });
}

//The index range a change delta touched, walked the way Quill applies it, and whether it was a
//single typed space - the one keystroke the heading detection above waits for.
function touchedSpan(delta){
  var index = 0;
  var start = null;
  var end = 0;
  var insertedSpace = false;
  var inserts = 0;

  (delta.ops || []).forEach(function(op){
    if(typeof op.retain === 'number'){
      if(op.attributes){
        if(start === null) start = index;
        end = index + op.retain;
      }
      index += op.retain;
    }
    else if(op.insert !== undefined){
      var length = typeof op.insert === 'string' ? op.insert.length : 1;
      if(start === null) start = index;
      index += length;
      end = index;
      inserts += 1;
      insertedSpace = op.insert === ' ';
    }
    else if(typeof op.delete === 'number'){
      if(start === null) start = index;
      end = Math.max(end, index);
    }
  });

  if(start === null)
    return null;

  return { start: start, end: Math.max(end, start), insertedSpace: insertedSpace && inserts === 1 };
}

// ------------------------------------------------------------------------------------------
// Scenes
// ------------------------------------------------------------------------------------------

//The scenes of a script, from the delta: every line whose element is a scene heading, with its
//text and the index it starts at. This is what the sidebar renders and what navigation and the
//scene moves work from - never the DOM. One walk of the paragraphs; the index arithmetic is the
//same one every other delta consumer here makes, a character per string character, one per embed,
//one per line's newline.
function sceneIndex(delta){
  var scenes = [];
  var index = 0;

  if(!delta || !Array.isArray(delta.ops))
    return scenes;

  parseDelta(delta).paragraphs.forEach(function(para){
    var text = '';
    var length = 0;
    para.textRuns.forEach(function(run){
      if(typeof run.text === 'string'){
        text += run.text;
        length += run.text.length;
      }
      else
        length += 1;
    });

    if(para.attributes && para.attributes.element === 'scene')
      scenes.push({ title: text, index: index });

    index += length + 1;
  });

  return scenes;
}

//Which scene the caret is in: the last heading at or before it, or -1 for text before the first
//heading (a FADE IN:, an opening action line), which belongs to no scene.
function sceneAt(scenes, caret){
  var found = -1;
  scenes.forEach(function(scene, k){
    if(scene.index <= caret)
      found = k;
  });
  return found;
}

//The start of the heading before the caret and after it, for the navigation shortcuts. Strictly
//before: with the caret mid-scene, "previous" is this scene's own heading, which is where a writer
//pressing it wants to be; from the heading itself, it is the one above.
function previousSceneStart(scenes, caret){
  var found = null;
  scenes.forEach(function(scene){
    if(scene.index < caret)
      found = scene.index;
  });
  return found;
}

function nextSceneStart(scenes, caret){
  var found = scenes.find(function(scene){ return scene.index > caret; });
  return found ? found.index : null;
}

//A block of scenes is one or more consecutive scenes, each its heading and every line down to the
//next heading or the end. Text before the first heading (a FADE IN:, an opening action) belongs to
//no scene and is never part of a block. See docs/screenplay-plan.md, "One script".

//Which scenes a selection covers, as scene numbers from..to inclusive: the scene the caret is in,
//or every scene a range touches, a partly selected one included. A range ending exactly where a
//heading begins does not take that scene. A caret before the first heading covers nothing; a range
//starting there and reaching a heading covers from the first scene.
function sceneBlock(scenes, range){
  if(!range || scenes.length === 0)
    return null;

  var length = range.length > 0 ? range.length : 0;
  var to = sceneAt(scenes, length > 0 ? range.index + length - 1 : range.index);
  if(to < 0)
    return null;

  return { from: Math.max(sceneAt(scenes, range.index), 0), to: to };
}

function headingsOf(paragraphs){
  var headings = [];
  paragraphs.forEach(function(para, i){
    if(para.attributes && para.attributes.element === 'scene')
      headings.push(i);
  });
  return headings;
}

function paragraphLength(para){
  var length = 0;
  para.textRuns.forEach(function(run){
    length += typeof run.text === 'string' ? run.text.length : 1;
  });
  return length + 1;
}

//An empty line comes out of parseDelta as one run of empty text, and an empty insert must not go
//back in: Delta.diff cannot align a delta holding them with the editor's own, and answers with a
//change that rewrites every line of the script (thousands of ops on a feature script - seconds
//in the editor, a hang to the writer) instead of the move it is.
function paragraphsToOps(paragraphs){
  var ops = [];
  paragraphs.forEach(function(para){
    para.textRuns.forEach(function(run){
      if(run.text === '')
        return;
      var op = { insert: run.text };
      if(run.attributes)
        op.attributes = run.attributes;
      ops.push(op);
    });
    var lineOp = { insert: '\n' };
    if(para.attributes)
      lineOp.attributes = para.attributes;
    ops.push(lineOp);
  });
  return ops;
}

//The text index a paragraph starts at.
function offsetOf(paragraphs, n){
  var index = 0;
  for(var i = 0; i < n; i++)
    index += paragraphLength(paragraphs[i]);
  return index;
}

//The paragraph span of scenes from..to, or null when there are no such scenes.
function blockSpan(paragraphs, from, to){
  var headings = headingsOf(paragraphs);
  if(from < 0 || to < from || to >= headings.length)
    return null;

  return { from: headings[from], to: to + 1 < headings.length ? headings[to + 1] : paragraphs.length };
}

//Where a block of scenes sits in the text and the delta of the block on its own, for cutting it out
//of the script into a document of its own. Pure: the caller deletes `length` characters at `start`.
function splitScenes(delta, from, to){
  var paragraphs = parseDelta(delta).paragraphs;
  var span = blockSpan(paragraphs, from, to);
  if(!span)
    return null;

  var start = offsetOf(paragraphs, span.from);
  var block = paragraphs.slice(span.from, span.to);

  return {
    start: start,
    length: offsetOf(paragraphs, span.to) - start,
    extracted: { ops: paragraphsToOps(block) }
  };
}

//A new delta with the block of scenes from..to swapped with the scene above (direction -1) or below
//(+1), or null when there is no such neighbour. Pure: the caller diffs this against the editor's
//contents and applies the difference as one user change, which is one undo entry. Returns the new
//delta and where the moved block now starts and how long it is, for the selection.
function moveScenes(delta, from, to, direction){
  var paragraphs = parseDelta(delta).paragraphs;
  var block = blockSpan(paragraphs, from, to);
  var neighbour = direction < 0 ? blockSpan(paragraphs, from - 1, from - 1) : blockSpan(paragraphs, to + 1, to + 1);
  if(!block || !neighbour)
    return null;

  var first = direction < 0 ? neighbour : block;
  var second = direction < 0 ? block : neighbour;

  var reordered = paragraphs.slice(0, first.from)
    .concat(paragraphs.slice(second.from, second.to))
    .concat(paragraphs.slice(first.from, first.to))
    .concat(paragraphs.slice(second.to));

  //The moved block is the second of the two when it went up, and the first when it went down -
  //which, once reordered, puts it at first.from either way, or after the neighbour's length.
  var movedAt = direction < 0 ? first.from : first.from + (second.to - second.from);
  var start = offsetOf(reordered, movedAt);

  return {
    ops: paragraphsToOps(reordered),
    start: start,
    length: offsetOf(reordered, movedAt + (block.to - block.from)) - start
  };
}

function moveScene(delta, k, direction){
  return moveScenes(delta, k, k, direction);
}

//`delta` with `extra`'s lines after its own, and where the added text starts. A script that is
//nothing but its one empty line (a new project's) is replaced rather than appended to, so the
//block does not sit under a blank.
function appendScenes(delta, extra){
  var paragraphs = parseDelta(delta).paragraphs;
  if(paragraphs.length === 1 && !paragraphs[0].attributes && paragraphLength(paragraphs[0]) === 1)
    paragraphs = [];

  var start = offsetOf(paragraphs, paragraphs.length);
  return { ops: paragraphsToOps(paragraphs.concat(parseDelta(extra).paragraphs)), start: start };
}

// ------------------------------------------------------------------------------------------
// Autocomplete - docs/screenplay-plan.md, "Autocomplete, word count, title page"
// ------------------------------------------------------------------------------------------

//The lists every script shares: how a heading starts, when it is set, how a
//scene ends, and what a cue carries after the name. The script's own transitions join the last.
const SCENE_INTROS = ['INT.', 'EXT.', 'INT./EXT.', 'EST.'];
const TIMES_OF_DAY = ['DAY', 'NIGHT', 'CONTINUOUS', 'LATER', 'MOMENTS LATER', 'MORNING', 'AFTERNOON', 'EVENING', 'DAWN', 'DUSK', 'SAME TIME'];
const TRANSITIONS = ['CUT TO:', 'DISSOLVE TO:', 'FADE OUT.', 'FADE TO BLACK.', 'SMASH CUT TO:', 'MATCH CUT TO:', 'JUMP CUT TO:', 'INTERCUT WITH:', 'FADE TO:', 'TIME CUT:'];
const EXTENSIONS = ['V.O.', 'O.S.', 'O.C.', "CONT'D"];

//Every character the script has a cue for, once each, in capitals, sorted - what a cue being
//typed is completed from.
function characterNames(delta){
  return unique(linesOfType(delta, 'character').map(cueName));
}

//Every place the script has a heading for, the same way: "INT. WILL'S BEDROOM - NIGHT (1973)"
//contributes "WILL'S BEDROOM".
function locations(delta){
  return unique(linesOfType(delta, 'scene').map(function(text){
    return text.replace(HEADING_NUMBER, '').replace(HEADING_PREFIX, '').replace(HEADING_TIME, '').trim().toUpperCase();
  }));
}

function paragraphText(para){
  return para.textRuns.map(function(run){ return typeof run.text === 'string' ? run.text : ''; }).join('');
}

function linesOfType(delta, type){
  if(!delta || !Array.isArray(delta.ops))
    return [];

  return parseDelta(delta).paragraphs.filter(function(para){
    return para.attributes && para.attributes.element === type;
  }).map(paragraphText);
}

function unique(values){
  var seen = {};
  return values.filter(function(value){
    if(value === '' || seen[value])
      return false;
    seen[value] = true;
    return true;
  }).sort();
}

//Who speaks next, for an empty cue at `lineStart`: the character who spoke
//before the last speaker first, since a scene is mostly two people taking turns, then the last
//speaker and the rest of the scene's speakers by recency, then the speakers of earlier scenes by
//recency, then the rest of the cast. Names once each.
function speakersFor(delta, lineStart){
  var paragraphs = parseDelta(delta).paragraphs;
  var index = 0;
  var here = paragraphs.length;

  for(var p = 0; p < paragraphs.length; p++){
    if(index >= lineStart){
      here = p;
      break;
    }
    var length = 0;
    paragraphs[p].textRuns.forEach(function(run){ length += typeof run.text === 'string' ? run.text.length : 1; });
    index += length + 1;
  }

  var inScene = [];
  var earlier = [];
  var seen = {};
  var pastHeading = false;

  for(var i = here - 1; i >= 0; i--){
    var attributes = paragraphs[i].attributes || {};
    if(attributes.element === 'scene'){
      pastHeading = true;
      continue;
    }
    if(attributes.element !== 'character')
      continue;
    var name = cueName(paragraphText(paragraphs[i]));
    if(name === '' || seen[name])
      continue;
    seen[name] = true;
    (pastHeading ? earlier : inScene).push(name);
  }

  if(inScene.length > 1){
    var last = inScene[0];
    inScene[0] = inScene[1];
    inScene[1] = last;
  }

  return inScene.concat(earlier, characterNames(delta).filter(function(name){ return !seen[name]; }));
}

function startingWith(list, typed){
  return list.filter(function(item){ return item.indexOf(typed) === 0 && item !== typed; });
}

//What to offer for the line being typed, or null. `lineStart` is the index the line starts at,
//which the next-speaker guess needs to know where in the script it is. The result says what was
//typed, the suggestions, and how an accepted one goes in: `prefix` before it, `suffix` after it,
//replacing the line's text from offset `from` to offset `to`. A list is offered before anything
//is typed too - the next speaker on an empty cue, the intros on an empty heading, the times after
//" - " - and Enter or Tab takes its first entry like any other; Escape is the way past it.
//
//  cue, empty                -> the speakers, next-speaker first
//  cue, "BO"                 -> the names starting with it
//  cue, "BOB (" or "BOB (V"  -> the extensions, in parentheses after the name
//  heading, empty or "IN"    -> INT., EXT. and the rest, with a space after
//  heading, "INT. KI"        -> the places starting with it
//  heading, "INT. KITCHEN - " -> the times of day
//  transition                -> the usual transitions and the script's own
function suggestionsFor(delta, type, lineText, lineStart){
  var text = lineText || '';

  if(type === 'character'){
    var open = /^(.*?)\s*\(([^)]*)$/.exec(text);
    if(open){
      var name = open[1].trim().toUpperCase();
      if(name === '')
        return null;
      var typedExtension = open[2].trim().toUpperCase();
      var extensions = startingWith(EXTENSIONS, typedExtension).map(function(extension){ return '(' + extension + ')'; });
      return extensions.length > 0 ? { typed: typedExtension, prefix: name + ' ', suffix: '', from: 0, to: text.length, suggestions: extensions } : null;
    }

    var typedName = text.trim().toUpperCase();
    if(typedName === ''){
      var speakers = speakersFor(delta, lineStart || 0);
      return speakers.length > 0 ? { typed: '', prefix: '', suffix: '', from: 0, to: text.length, suggestions: speakers } : null;
    }

    var names = startingWith(characterNames(delta), typedName);
    return names.length > 0 ? { typed: typedName, prefix: '', suffix: '', from: 0, to: text.length, suggestions: names } : null;
  }

  if(type === 'scene'){
    var prefix = HEADING_PREFIX.exec(text);
    if(!prefix){
      var typedIntro = text.trim().toUpperCase();
      var intros = startingWith(SCENE_INTROS, typedIntro);
      //An intro is the start of the heading, not the end of it: Enter fills it in and stays.
      return intros.length > 0 ? { typed: typedIntro, prefix: '', suffix: ' ', from: 0, to: text.length, handOn: false, suggestions: intros } : null;
    }

    var time = HEADING_TIME.exec(text);
    if(time){
      var typedTime = time[1].trim().toUpperCase();
      var times = startingWith(TIMES_OF_DAY, typedTime);
      return times.length > 0 ? { typed: typedTime, prefix: '', suffix: '', from: text.length - time[1].length, to: text.length, suggestions: times } : null;
    }

    var typedPlace = text.slice(prefix[0].length).trim().toUpperCase();
    var places = startingWith(locations(delta), typedPlace);
    return places.length > 0 ? { typed: typedPlace, prefix: '', suffix: '', from: prefix[0].length, to: text.length, suggestions: places } : null;
  }

  if(type === 'transition'){
    var typedTransition = text.trim().toUpperCase();
    var known = TRANSITIONS.slice();
    linesOfType(delta, 'transition').forEach(function(line){
      var transition = line.trim().toUpperCase();
      if(transition !== '' && known.indexOf(transition) === -1)
        known.push(transition);
    });
    var transitions = startingWith(known, typedTransition);
    return transitions.length > 0 ? { typed: typedTransition, prefix: '', suffix: '', from: 0, to: text.length, suggestions: transitions } : null;
  }

  return null;
}

//The suggestion box: a list under the caret while a cue, heading or transition is being typed,
//moved through with the arrow keys, accepted with Enter, Tab, the right arrow or a click - the
//first entry unless the arrows chose another - dismissed with Escape (and brought back with
//Escape again) or by typing on to something it has nothing for. Enter and Tab go on to do what they do on the line once the text is in - Enter on a
//cue opens the speech, Tab the parenthetical - which is what makes a name one keypress. Its keys
//are Quill bindings unshifted ahead of the screenplay ones and guarded on the box being open,
//rather than one-shot listeners racing each other, which is what the abandoned first attempt
//had. Positioned from quill.getBounds, so it needs no DOM of the editor's own read; the names and
//places come from the delta. `isEnabled` is the Settings switch, asked on every refresh.
function attachAutocomplete(quill, getMode, isEnabled){
  var box = null;
  var current = null;
  var selected = 0;
  var accepting = false;

  function close(){
    if(box && box.parentNode)
      box.parentNode.removeChild(box);
    box = null;
    current = null;
  }

  function isOpen(){
    return box != null;
  }

  function render(){
    if(!box){
      box = document.createElement('div');
      box.className = 'suggestion-box';
      box.setAttribute('role', 'listbox');
      box.setAttribute('aria-label', 'Suggestions');
      document.body.appendChild(box);
    }

    while(box.firstChild)
      box.removeChild(box.firstChild);

    current.suggestions.forEach(function(text, i){
      var item = document.createElement('div');
      item.className = 'suggestion' + (i === selected ? ' suggestion-selected' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', i === selected ? 'true' : 'false');
      item.textContent = text;
      item.onmousedown = function(e){
        e.preventDefault();
        selected = i;
        accept(null);
      };
      box.appendChild(item);
    });

    var range = quill.getSelection();
    var bounds = quill.getBounds(range ? range.index : 0);
    var editor = quill.root.getBoundingClientRect();
    box.style.left = (editor.left + bounds.left) + 'px';
    box.style.top = (editor.top + bounds.top + bounds.height) + 'px';
  }

  function refresh(){
    if(getMode() !== 'screenplay' || (isEnabled && !isEnabled())){
      close();
      return;
    }

    var range = quill.getSelection();
    if(!range || range.length > 0){
      close();
      return;
    }

    var info = lineAt(quill, range.index);
    var type = elementOf(info.line);
    var found = suggestionsFor(quill.getContents(), type, textOf(quill, info), info.index);

    if(!found){
      close();
      return;
    }

    current = found;
    current.lineStart = info.index;
    current.lineLength = info.length - 1;
    selected = 0;
    render();
  }

  //The chosen text replaces the part of the line it completes, as one user change, and the caret
  //lands after it. Then the key that accepted it does what it would do there: `key` is 'enter' or
  //'tab' for the screenplay binding to run, or null for a click or the right arrow.
  function accept(key){
    if(!current)
      return;

    var start = current.lineStart + current.from;
    var length = current.to - current.from;
    var replacement = current.prefix + current.suggestions[selected] + current.suffix;
    var handOn = current.handOn !== false;
    var Delta = Quill.import('delta');

    //Closed before the change goes in: the change is a user text-change, which would otherwise
    //refresh the box against the line it has just completed - and reopen it when the name chosen
    //is the start of a longer one ("WILL", with "WILLIAM" in the cast).
    close();
    accepting = true;
    try{
      quill.updateContents(new Delta().retain(start).delete(length).insert(replacement), 'user');
      quill.setSelection(start + replacement.length, 0, 'user');
    }
    finally{
      accepting = false;
    }

    var binding = key && handOn ? screenplayBindingFor(quill, key) : null;
    if(binding)
      binding.handler.call(quill.keyboard, { index: start + replacement.length, length: 0 }, {});
  }

  function move(step){
    selected = (selected + step + current.suggestions.length) % current.suggestions.length;
    render();
  }

  function acceptWith(key){
    return function(){
      if(!isOpen())
        return true;
      accept(key);
      return false;
    };
  }

  function whenOpen(action){
    return function(){
      if(!isOpen())
        return true;
      action();
      return false;
    };
  }

  //Escape closes an open list, and brings a closed one back when there is one to bring.
  function escape(){
    if(isOpen()){
      close();
      return false;
    }
    refresh();
    return !isOpen();
  }

  var bindings = quill.keyboard.bindings;
  [[13, acceptWith('enter')], [9, acceptWith('tab')], [39, acceptWith(null)], [27, escape],
   [40, whenOpen(function(){ move(1); })], [38, whenOpen(function(){ move(-1); })]].forEach(function(pair){
    bindings[pair[0]] = bindings[pair[0]] || [];
    bindings[pair[0]].unshift({ key: pair[0], handler: pair[1] });
  });

  quill.on('text-change', function(delta, oldDelta, source){
    if(accepting)
      return;
    if(source === 'user')
      refresh();
    else
      close();
  });

  //Moving the caret off the line, or out of the editor, takes the box with it. Landing on an
  //empty line opens it: Enter and the element keys open their new line and put the caret on it
  //after the text-change (Quill leaves a caret at the insertion point where it was), so the empty
  //cue that offers the next speaker, or the empty heading that offers INT., is only seen here.
  quill.on('selection-change', function(range, oldRange, source){
    if(!isOpen()){
      if(range && source === 'user' && range.length === 0 && lineAt(quill, range.index).length <= 1)
        refresh();
      return;
    }
    if(!range || range.index < current.lineStart || range.index > current.lineStart + current.lineLength)
      close();
  });

  return { close: close, isOpen: isOpen, refresh: refresh };
}

// ------------------------------------------------------------------------------------------
// Page marks - docs/screenplay-plan.md, "Autocomplete, word count, title page" (Page count)
// ------------------------------------------------------------------------------------------

//Draws where the pages are estimated to turn: the first paragraph of each page after the first
//gets `data-sp-page` holding its page number, and the CSS on that attribute draws the dotted rule
//and the number above it. Everything else is cleared, so a paragraph that no longer starts a page
//loses its mark; `show` false clears them all.
//
//The attribute is put on the paragraph's node directly, not through a format: a mark is derived
//from the whole script, so it is not part of any line's content, must not be saved, and must not
//be an undo step. Parchment reads only the attributors it knows back off a node, so the attribute
//is invisible to getContents() and the mutation it makes emits no text-change. The estimate is
//fountain.js's line model, one element per line of the editor, which is why the elements are
//matched to the lines by position; a count that disagrees (an embed pasted from prose) draws
//nothing rather than something wrong.
function markEstimatedPages(quill, show){
  var lines = quill.getLines();
  var pageOf = {};

  if(show){
    var elements = deltaToElements(quill.getContents());
    if(elements.length === lines.length){
      estimatePageStarts(elements).forEach(function(start){
        pageOf[start.index] = String(start.page);
      });
    }
  }

  lines.forEach(function(line, i){
    var node = line.domNode;
    var want = pageOf[i];
    if(want === undefined){
      if(node.hasAttribute('data-sp-page'))
        node.removeAttribute('data-sp-page');
    }
    else if(node.getAttribute('data-sp-page') !== want)
      node.setAttribute('data-sp-page', want);
  });
}

module.exports = {
  loadScreenplayDelta,
  deltaToScreenplayHtml,
  setElement,
  insertElement,
  toggleDual,
  cueFor,
  elementOf,
  lineAt,
  characterNames,
  locations,
  speakersFor,
  suggestionsFor,
  attachAutocomplete,
  attachScreenplayTyping,
  markEstimatedPages,
  sceneIndex,
  sceneAt,
  previousSceneStart,
  nextSceneStart,
  moveScene,
  moveScenes,
  sceneBlock,
  splitScenes,
  appendScenes,
  attachScreenplayKeys,
  screenplayEnterBinding,
  screenplayShiftEnterBinding,
  screenplayTabBinding,
  screenplayShiftTabBinding,
  screenplayNewSceneBinding,
  screenplayPickerBinding,
  SCENE_INTROS,
  TIMES_OF_DAY,
  TRANSITIONS,
  EXTENSIONS
};
