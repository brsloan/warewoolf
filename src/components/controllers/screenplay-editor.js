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

//A new delta with scene `k` swapped with the one above (direction -1) or below (+1), or null when
//there is no such neighbour. A scene is its heading and every line down to the next heading; text
//before the first heading belongs to no scene and never moves. Pure: the caller diffs this against
//the editor's contents and applies the difference as one user change, which is one undo entry.
//Returns the new delta and where the moved heading now starts, for the caret.
function moveScene(delta, k, direction){
  var paragraphs = parseDelta(delta).paragraphs;
  var headings = [];
  paragraphs.forEach(function(para, i){
    if(para.attributes && para.attributes.element === 'scene')
      headings.push(i);
  });

  var neighbour = k + direction;
  if(k < 0 || k >= headings.length || neighbour < 0 || neighbour >= headings.length)
    return null;

  var rangeOf = function(n){
    return { from: headings[n], to: n + 1 < headings.length ? headings[n + 1] : paragraphs.length };
  };
  var first = rangeOf(Math.min(k, neighbour));
  var second = rangeOf(Math.max(k, neighbour));

  var reordered = paragraphs.slice(0, first.from)
    .concat(paragraphs.slice(second.from, second.to))
    .concat(paragraphs.slice(first.from, first.to))
    .concat(paragraphs.slice(second.to));

  //The moved scene is the first of the two when it went up, and the second when it went down -
  //which, once reordered, puts it at first.from either way, or after the other scene's length.
  var movedAt = direction < 0 ? first.from : first.from + (second.to - second.from);

  var ops = [];
  reordered.forEach(function(para){
    para.textRuns.forEach(function(run){
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

  //Where the moved heading now starts, walked the same way the ops were built.
  var index = 0;
  var start = 0;
  reordered.forEach(function(para, i){
    if(i === movedAt)
      start = index;
    para.textRuns.forEach(function(run){
      index += typeof run.text === 'string' ? run.text.length : 1;
    });
    index += 1;
  });

  return { ops: ops, start: start };
}

// ------------------------------------------------------------------------------------------
// Autocomplete - docs/screenplay-plan.md, "Autocomplete, word count, title page"
// ------------------------------------------------------------------------------------------

//The extensions a cue carries after the name - (V.O.), (CONT'D), (O.S.) - and the dual marker.
const CUE_EXTENSIONS = /\s*\(.*$/;
//A heading's INT./EXT. prefix and its " - DAY" time of day, which is not part of the place.
const HEADING_PREFIX = /^(?:INT\.?\/EXT|EXT\.?\/INT|INT|EXT|EST|I\/E)[.\s\-]+/i;
const HEADING_TIME = /\s+-\s+[^-]*$/;
const HEADING_NUMBER = /\s*#[^#]*#\s*$/;

//Every character the script has a cue for, once each, in capitals, sorted - what a cue being
//typed is completed from.
function characterNames(delta){
  return unique(linesOfType(delta, 'character').map(function(text){
    return text.replace(CUE_EXTENSIONS, '').replace(/\s*\^$/, '').trim().toUpperCase();
  }));
}

//Every place the script has a heading for, the same way: "INT. WILL'S BEDROOM - NIGHT (1973)"
//contributes "WILL'S BEDROOM".
function locations(delta){
  return unique(linesOfType(delta, 'scene').map(function(text){
    return text.replace(HEADING_NUMBER, '').replace(HEADING_PREFIX, '').replace(HEADING_TIME, '').trim().toUpperCase();
  }));
}

function linesOfType(delta, type){
  if(!delta || !Array.isArray(delta.ops))
    return [];

  return parseDelta(delta).paragraphs.filter(function(para){
    return para.attributes && para.attributes.element === type;
  }).map(function(para){
    return para.textRuns.map(function(run){ return typeof run.text === 'string' ? run.text : ''; }).join('');
  });
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

//What to offer for the line being typed: on a cue, the names it is the start of; on a heading,
//the places its text after the prefix is the start of. Nothing until two characters are typed,
//and never the thing already typed in full. Returns { typed, suggestions, prefix } - `prefix` is
//the heading's INT./EXT. part, kept so an accepted suggestion goes back behind it.
function suggestionsFor(delta, type, lineText){
  if(type === 'character'){
    var typedName = lineText.trim().toUpperCase();
    if(typedName.length < 2)
      return null;

    var names = characterNames(delta).filter(function(name){
      return name.indexOf(typedName) === 0 && name !== typedName;
    });
    return names.length > 0 ? { typed: typedName, prefix: '', suggestions: names } : null;
  }

  if(type === 'scene'){
    var prefix = HEADING_PREFIX.exec(lineText);
    if(!prefix)
      return null;

    var typedPlace = lineText.slice(prefix[0].length).trim().toUpperCase();
    if(typedPlace.length < 2)
      return null;

    var places = locations(delta).filter(function(place){
      return place.indexOf(typedPlace) === 0 && place !== typedPlace;
    });
    return places.length > 0 ? { typed: typedPlace, prefix: prefix[0], suggestions: places } : null;
  }

  return null;
}

//The suggestion box: a list under the caret while a cue or heading is being typed, moved through
//with the arrow keys, accepted with Enter or Tab, dismissed with Escape or by typing on to
//something it has nothing for. Its keys are Quill bindings unshifted ahead of the screenplay ones
//and guarded on the box being open, rather than one-shot listeners racing each other, which is
//what the abandoned first attempt had. Positioned from quill.getBounds, so it needs no DOM of
//the editor's own read; the names and places come from the delta.
function attachAutocomplete(quill, getMode){
  var box = null;
  var current = null;
  var selected = 0;

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
        accept();
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
    if(getMode() !== 'screenplay'){
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
    var found = suggestionsFor(quill.getContents(), type, quill.getText(info.index, info.length - 1));

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

  //The chosen name or place replaces the line's text - behind the heading's prefix, for a
  //heading - as one user change, and the caret lands at the end of it.
  function accept(){
    if(!current)
      return;

    var start = current.lineStart;
    var length = current.lineLength;
    var replacement = current.prefix + current.suggestions[selected];
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
  }

  var accepting = false;

  function move(step){
    selected = (selected + step + current.suggestions.length) % current.suggestions.length;
    render();
  }

  function whenOpen(action){
    return function(){
      if(!isOpen())
        return true;
      action();
      return false;
    };
  }

  var bindings = quill.keyboard.bindings;
  [[13, function(){ accept(); }], [9, function(){ accept(); }], [27, close],
   [40, function(){ move(1); }], [38, function(){ move(-1); }]].forEach(function(pair){
    bindings[pair[0]] = bindings[pair[0]] || [];
    bindings[pair[0]].unshift({ key: pair[0], handler: whenOpen(pair[1]) });
  });

  quill.on('text-change', function(delta, oldDelta, source){
    if(accepting)
      return;
    if(source === 'user')
      refresh();
    else
      close();
  });

  //Moving the caret off the line, or out of the editor, takes the box with it.
  quill.on('selection-change', function(range){
    if(!isOpen())
      return;
    if(!range || range.index < current.lineStart || range.index > current.lineStart + current.lineLength)
      close();
  });

  return { close: close, isOpen: isOpen, refresh: refresh };
}

module.exports = {
  loadScreenplayDelta,
  deltaToScreenplayHtml,
  setElement,
  elementOf,
  lineAt,
  characterNames,
  locations,
  suggestionsFor,
  attachAutocomplete,
  sceneIndex,
  sceneAt,
  previousSceneStart,
  nextSceneStart,
  moveScene,
  attachScreenplayKeys,
  screenplayEnterBinding,
  screenplayShiftEnterBinding,
  screenplayTabBinding,
  screenplayShiftTabBinding
};
