const { codeForKey } = require('../models/shortcuts');

function getTempQuill(){
  const Quill = require('quill');
  return new Quill(document.createElement('div'), {
      modules: {
          history: {
              userOnly: true
          }
      }
      });
}

function splitDeltaAtIndices(delt, splitPoints){
  var generatedDeltas = [];
  if (splitPoints.length > 0) {
    var tempQuill = getTempQuill();
    tempQuill.setContents(delt);

    //Add beginning fragment before first splitPoint
    if(splitPoints[0] != 0)
      generatedDeltas.push(tempQuill.getContents(0, splitPoints[0]));
      //Add middle deltas
      for(let i = 0; i < splitPoints.length - 1; i++){
        var deltLength = splitPoints[i + 1] - splitPoints[i];
        generatedDeltas.push(tempQuill.getContents(splitPoints[i], deltLength));
      }
      //Add last delta from index to end of delta
      generatedDeltas.push(tempQuill.getContents(splitPoints[splitPoints.length - 1]));
  }

  return generatedDeltas;
}

function generateChapTitleFromFirstLine(delt){
    const titleCharacterLimit = 100;
    if(!delt.ops || delt.ops.length == 0)
      return '';
    var firstInsert = delt.ops[0].insert;
    if(typeof firstInsert !== 'string')
      return '';
    return firstInsert.split(/\r\n|\r|\n/)[0].slice(0,titleCharacterLimit).replaceAll(/<|>/g,'');
}

function parseDelta(delta){
  var paras = [];

  if(delta.ops && delta.ops.length > 0){
    var ops = flattenInserts(delta.ops);

    var tempRuns = [];

    for(let i=0;i<ops.length;i++){
      if(ops[i].insert == '\n'){
        if(tempRuns.length == 0)
          tempRuns.push({text: ''});
        var para = { textRuns: tempRuns };
        if(ops[i].attributes)
          para.attributes = ops[i].attributes;

        paras.push(para);
        tempRuns = [];
      }
      else {
        var run = { text: ops[i].insert };
        if(ops[i].attributes)
          run.attributes = ops[i].attributes;

        tempRuns.push(run);
      }
    }
  }

  return { paragraphs: paras };
}

function flattenInserts(ops){
  var flattened = [];

  for(let i=0;i<ops.length;i++){
    if(ops[i].insert == '\n')
      flattened.push(ops[i]);
    else{
      var lines = ops[i].insert.split('\n');
      for(let l=0;l<lines.length;l++){
        var op = { insert: lines[l] };
        if(ops[i].attributes)
          op.attributes = ops[i].attributes;
        flattened.push(op);

        if(l != lines.length -1)
          flattened.push({ insert: '\n'} );
      }
    }
  }

  return flattened;
}

//Numbered lists restart at one for each new list and count independently at each nesting level, so
//an item's number depends on every paragraph before it rather than on the paragraph alone. Walking
//the paragraphs once up front hands each one the number to print, which leaves the callers with
//nothing to do but render it. Paragraphs that are not numbered list items get a 0 they ignore.
function getOrderedListNumbers(paragraphs){
  var numbers = [];
  var counters = [0, 0, 0];

  paragraphs.forEach(function(para, i){
    numbers.push(0);

    if(para.textRuns.length == 0)
      return;

    if(!isOrderedListItem(para)){
      counters = [0, 0, 0];
      return;
    }

    //A new list begins wherever the paragraph before it was not a numbered list item.
    if(i == 0 || !isOrderedListItem(paragraphs[i - 1]))
      counters = [0, 0, 0];

    var level = getListLevel(para.attributes);
    counters[level]++;
    numbers[i] = counters[level];
  });

  return numbers;
}

function isOrderedListItem(para){
  return Boolean(para.attributes && para.attributes.list && para.attributes.list == 'ordered');
}

//Quill tracks nesting as an indent count with no ceiling, but the export formats only carry three
//levels, so anything deeper is folded into the last one.
function getListLevel(attr){
  if(!attr.indent || attr.indent < 1)
    return 0;

  return attr.indent == 1 ? 1 : 2;
}

//The marker a list item is written with is the same in every text format WareWoolf exports, so both
//the .mdfc writer and the plain text writer take it from here. Returns '' for anything that is not
//a list item, which is the caller's cue to keep the marker it already worked out.
function getListMarker(attr, listItemNum = 0){
  if(!attr || !attr.list)
    return '';

  var tabs = '';
  if(attr.indent && attr.indent > 0)
    tabs = attr.indent == 1 ? '\t' : '\t\t';

  if(attr.list == 'bullet')
    return tabs + '* ';
  if(attr.list == 'ordered')
    return tabs + listItemNum + '. ';

  return '';
}

function convertToPlainText(delt){
  var plaintext = '';

  var parsedQuill = parseDelta(delt);
  var listNumbers = getOrderedListNumbers(parsedQuill.paragraphs);

  parsedQuill.paragraphs.forEach((para, i) => {

    if(para.textRuns.length > 0)
      plaintext += getLineMarkerForPlaintextExport(para.attributes, listNumbers[i]);

    para.textRuns.forEach((run, i) => {
      plaintext += run.text;
    });

    plaintext += '\r\n';
  });

  return plaintext;
}

function getLineMarkerForPlaintextExport(attr, listItemNum = 0){
  var marker = '';

  if(attr){
    if(attr.blockquote)
      marker = '\t';

    var listMarker = getListMarker(attr, listItemNum);
    if(listMarker)
      marker = listMarker;
  }

  return marker;
};

//What each of the formatting shortcuts does, keyed by the action ids in models/shortcuts.js. Quill
//calls a handler with `this` bound to a context carrying the instance, so they reach for
//this.quill rather than closing over one - which is what lets the same table serve both editors,
//and lets a rebind re-attach them without rebuilding anything.
const QUILL_HANDLERS = {
  //Title: centre it and make it a top-level heading in one keystroke.
  formatTitle: function(){
    this.quill.format('align', 'center', 'user');
    this.quill.format('header', 1, 'user');
  },
  formatHeading1: headingHandler(1),
  formatHeading2: headingHandler(2),
  formatHeading3: headingHandler(3),
  formatHeading4: headingHandler(4),
  formatClearHeading: headingHandler(null),
  formatAlignLeft: alignmentHandler(null),
  formatAlignCenter: alignmentHandler('center'),
  formatAlignRight: alignmentHandler('right'),
  formatAlignJustify: alignmentHandler('justify'),
  formatStrikethrough: toggleHandler('strike'),
  formatBold: toggleHandler('bold'),
  formatItalics: toggleHandler('italic'),
  formatUnderline: toggleHandler('underline'),
  //Cycles bullet -> numbered -> none.
  formatList: function(){
    var current = this.quill.getFormat().list;

    if(current == 'bullet')
      this.quill.format('list', 'ordered', 'user');
    else if(current == 'ordered')
      this.quill.format('list', null, 'user');
    else
      this.quill.format('list', 'bullet', 'user');
  }
};

function headingHandler(level){
  return function(){
    this.quill.format('header', level, 'user');
  };
}

function alignmentHandler(alignment){
  return function(){
    this.quill.format('align', alignment, 'user');
  };
}

function toggleHandler(format){
  return function(){
    this.quill.format(format, !this.quill.getFormat()[format], 'user');
  };
}

//Quill matches a keypress on its keyCode, not on the key's name, and has no table of its own past
//a handful of named keys - so this is that table. The physical code a binding was captured from is
//preferred over the guess made from its key name, which is the whole reason a binding carries one:
//on a keyboard where Shift+1 is not '!', only the code says which key was actually pressed.
const KEY_CODES = {
  Backspace: 8, Tab: 9, Enter: 13, Escape: 27, Space: 32,
  PageUp: 33, PageDown: 34, End: 35, Home: 36,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
  Insert: 45, Delete: 46,
  Semicolon: 186, Equal: 187, Comma: 188, Minus: 189, Period: 190, Slash: 191,
  Backquote: 192, BracketLeft: 219, Backslash: 220, BracketRight: 221, Quote: 222
};

//The editor and the notes pane get the same formatting shortcuts. Quill's own keyboard module owns
//these bindings rather than render.js's document-level listener, so they are attached to each
//instance - and re-attached to it whenever a writer rebinds one.
//
//Re-attachable is the whole design here. Quill 1.x has no removeBinding(), so every binding this
//adds is tagged, and the tagged ones are stripped from the instance before the new set goes on.
//Only ours are touched: Quill's own bindings for Enter, Tab, Backspace and the rest are left
//exactly where they are.
//
//Bold/italic/underline are in the table too, though Quill binds those itself by default. They are
//in the popup's list, so they have to be rebindable like everything else - which means Quill's own
//three are switched off where the editors are built (see render.js) and re-added from here.
function applyQuillShortcuts(q, bindings){
  removeAppliedBindings(q);

  Object.keys(QUILL_HANDLERS).forEach(function(id){
    var binding = toQuillBinding(bindings ? bindings[id] : null);

    if(binding == null)
      return;

    binding.handler = QUILL_HANDLERS[id];
    binding.warewoolfAction = id;

    q.keyboard.addBinding(binding);
  });
}

//Returns null for a shortcut a writer has unbound, and for one whose key Quill has no code for -
//in which case leaving it unbound is the honest outcome, since a binding Quill cannot match would
//sit in the table looking bound and never fire.
function toQuillBinding(binding){
  if(binding == null)
    return null;

  var keyCode = keyCodeFor(binding);
  if(keyCode == null)
    return null;

  return {
    key: keyCode,
    shortKey: binding.mod,
    altKey: binding.alt,
    shiftKey: binding.shift
  };
}

function keyCodeFor(binding){
  var code = binding.code || codeForKey(binding.key);

  if(code == null)
    return null;

  if(KEY_CODES[code])
    return KEY_CODES[code];

  var letter = /^Key([A-Z])$/.exec(code);
  if(letter)
    return letter[1].charCodeAt(0);

  var digit = /^Digit([0-9])$/.exec(code);
  if(digit)
    return digit[1].charCodeAt(0);

  var functionKey = /^F([1-9]|1[0-2])$/.exec(code);
  if(functionKey)
    return 111 + Number(functionKey[1]);

  return null;
}

//Quill keys its bindings by keyCode, each holding an array of everything bound to that key, so
//removing ours means filtering each of those arrays rather than deleting anything.
function removeAppliedBindings(q){
  var bindings = q.keyboard.bindings;

  Object.keys(bindings).forEach(function(keyCode){
    bindings[keyCode] = bindings[keyCode].filter(function(binding){
      return binding.warewoolfAction == null;
    });
  });
}


//Advances the selection roughly one screenful down, the same way native PageDown does in an
//ordinary textarea - Quill has no built-in equivalent. Only ever called from the keyboard
//shortcut in keybindings.js, but it is a pure function of the Quill instance it is given, so it
//lives here with the app's other direct Quill manipulation rather than needing anything injected.
function goPageDown(quillObj){
  var selectedRange = quillObj.getSelection();

  if(selectedRange){
    var startingScrolltop = 0 + quillObj.root.scrollTop;
    var destinationY = quillObj.root.clientHeight;
    var textIndex = selectedRange.index + 1;
    //quillObj.selection.getBounds() returns viewport-relative coordinates, but destinationY and
    //scrollTop above are relative to the editor's own container - convert before comparing, the
    //same subtraction Quill's own public getBounds() does (see typewriter-mode.js's use of it).
    var containerTop = quillObj.container.getBoundingClientRect().top;

    var found = false;

    while(!found){
      var rawBounds = quillObj.selection.getBounds(textIndex, 1);
      var bounds = rawBounds ? { top: rawBounds.top - containerTop, height: rawBounds.height } : null;

      //Checked before reading any property of bounds: getBounds() returns null once textIndex
      //runs past the end of the content, which this loop always eventually reaches.
      if(bounds == null){
        found = true;
        quillObj.setSelection(textIndex - 1);
      }
      else if(bounds.top >= destinationY){
        found = true;
        quillObj.setSelection(textIndex);
        quillObj.root.scrollTop = startingScrolltop + bounds.top - bounds.height;
      }
      textIndex += 1;
    }
  }
}

module.exports = {
  getTempQuill,
  splitDeltaAtIndices,
  generateChapTitleFromFirstLine,
  parseDelta,
  convertToPlainText,
  getOrderedListNumbers,
  getListLevel,
  getListMarker,
  applyQuillShortcuts,
  goPageDown
}