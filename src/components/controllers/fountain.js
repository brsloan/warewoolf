const { parseDelta } = require('./quill-utils');

//The Fountain codec: a screenplay's `.fountain` file in, a list of elements out, and back again.
//See docs/screenplay-plan.md, "The codec". Shaped like markdownFic.js - pure text and pure deltas,
//no Quill and no DOM - and modelled on the reference implementation's line-by-line parser
//(screenplay/fountain/Fountain/FastFountainParser.m) rather than on its regex one, for the reason
//that parser exists at all: Fountain's rules are contextual, and a line is what it is because of
//the blank lines around it and the element before it, which a whole-document regex cannot see.
//
//An Element is { type, text, runs } plus, where they apply, `tight` (this line followed the one
//above with no blank line between them), `dual` (a character cue carrying the ^ dual-dialogue
//marker) and `depth` (a section heading's count of #). `runs` is the inline tokenisation,
//[{ text, attributes? }] with bold/italic/underline, and `text` is their plain concatenation.

const ELEMENT_TYPES = ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition',
  'centered', 'section', 'synopsis', 'note', 'boneyard', 'lyric', 'pagebreak'];

//The elements that only ever stand inside a dialogue group, after a character cue. A line that
//follows one of these with no blank line between is part of the same group; the parser reads it
//as one, and the serializer writes no blank line before it.
const GROUP_CONTINUATION = ['parenthetical', 'dialogue', 'lyric'];

//The elements a `tight` flag is never recorded on: each of them requires a blank line before it
//to be read as itself, so two in a row without one cannot happen on the way in and are not written
//that way on the way out.
const NEVER_TIGHT = ['scene', 'character', 'transition', 'pagebreak', 'section'];

//A scene heading: one of the prefixes the spec lists, then a period, space or hyphen, then
//anything. Case-insensitive, and only ever read after a blank line. "EXT/INT" is not in the spec
//but is in Big Fish twice, typed as a heading in the FDX, and no other reading of it makes sense.
const SCENE_HEADING = /^(?:INT|EXT|EST|INT\.?\/EXT|EXT\.?\/INT|I\/E)[.\s\-]/i;

//A transition ends in "TO:" and is entirely upper case; the spec's other forms ("FADE OUT.",
//"CUT TO BLACK.") are only transitions when forced with ">", which is what the reference parser
//does as well.
const TRANSITION = /TO:$/;

const CENTERED = /^>\s*(.*?)\s*<$/;
const PAGE_BREAK = /^={3,}\s*$/;

//A title page line that opens a key: a word or two of letters with no leading whitespace, a
//colon, then either the value or nothing (a multi-line value follows on indented lines). The
//reference parser takes anything before a colon as a key; letters and spaces is what the spec's
//keys are made of ("Title", "Draft date", "Contact"), and it keeps an opening action line with
//a colon in it - "a ***b*** C:\dir" - from being read as a title page.
const TITLE_PAGE_KEY = /^([A-Za-z][A-Za-z ]*):[\t ]*(.*)$/;

function normalizeLineBreaks(text){
  return text.replace(/\r\n|\r/g, '\n');
}

function isBlank(line){
  return line == null || line.trim() === '';
}

//A dialogue line of two or more spaces and nothing else is the spec's way of writing a blank line
//that stays inside the dialogue: outside a dialogue group it is just a blank line.
function isDialogueSpacer(line){
  return /^\s{2,}$/.test(line);
}

//Whether a line reads as a character cue on its own: no lower-case letter before any extension,
//and at least one letter there. The extensions in parentheses may be any case - "(cont'd)" is
//common - so they are looked past rather than tested.
function looksLikeCharacter(trimmed){
  var name = trimmed.replace(/\s*\(.*$/, '').replace(/\s*\^$/, '');
  return name.length > 0 && /[A-Za-z]/.test(name) && name === name.toUpperCase();
}

function looksLikeTransition(trimmed){
  return TRANSITION.test(trimmed) && trimmed === trimmed.toUpperCase();
}

//The one classifier both halves of the codec use: the parser to read a line, and the serializer
//to ask whether the line it is about to write would read back as the element it means. `context`
//is what the parser knows that the line itself does not: whether a blank line (or the start of the
//document) precedes it, whether the next line is blank, and whether a dialogue group is open.
//Returns { type, text, dual?, depth? } for the line on its own; `tight` is the parser's to decide.
//
//Only the single-line forms are here. A boneyard or note that spans lines is handled by the parser
//before this is asked, since a line inside one is whatever the comment says it is.
function classifyLine(line, context){
  var trimmed = line.trim();

  //Inside a dialogue group every line is dialogue of one kind or another until a blank line ends
  //the group. That is what the spec says, and it is what makes "!" or "." at the start of a spoken
  //line spoken rather than a force marker.
  if(context.inDialogue){
    if(/^\(.*\)$/.test(trimmed))
      return { type: 'parenthetical', text: trimmed };
    if(trimmed[0] === '~')
      return { type: 'lyric', text: trimmed.slice(1).trim() };
    return { type: 'dialogue', text: trimmed };
  }

  if(PAGE_BREAK.test(trimmed))
    return { type: 'pagebreak', text: '' };

  if(trimmed[0] === '~')
    return { type: 'lyric', text: trimmed.slice(1).trim() };

  if(trimmed[0] === '!')
    return { type: 'action', text: line.replace(/^\s*!/, '').replace(/\s+$/, '') };

  if(trimmed[0] === '@')
    return characterFrom(trimmed.slice(1).trim());

  //A single "=" is a synopsis; "===" was taken as a page break above.
  if(trimmed[0] === '=')
    return { type: 'synopsis', text: trimmed.slice(1).trim() };

  if(trimmed[0] === '#'){
    var hashes = /^#+/.exec(trimmed)[0];
    return { type: 'section', text: trimmed, depth: hashes.length };
  }

  //A single-line note. The parser handles one that spans lines.
  if(/^\[\[.*\]\]$/.test(trimmed))
    return { type: 'note', text: trimmed.slice(2, -2).trim() };

  if(/^\/\*.*\*\/$/.test(trimmed))
    return { type: 'boneyard', text: trimmed.slice(2, -2).trim() };

  var centered = CENTERED.exec(trimmed);
  if(centered)
    return { type: 'centered', text: centered[1] };

  //A forced heading is "." then text, but not ".." - an ellipsis opening an action line is not a
  //heading, and the reference parser makes the same exception.
  if(trimmed[0] === '.' && trimmed[1] !== '.')
    return { type: 'scene', text: trimmed.slice(1).trim() };

  if(trimmed[0] === '>')
    return { type: 'transition', text: trimmed.slice(1).trim() };

  if(context.blankBefore){
    if(SCENE_HEADING.test(trimmed))
      return { type: 'scene', text: trimmed };

    if(context.nextBlank && looksLikeTransition(trimmed))
      return { type: 'transition', text: trimmed };

    if(!context.nextBlank && looksLikeCharacter(trimmed))
      return characterFrom(trimmed);
  }

  //Action keeps its leading whitespace: the spec says so, since a writer indents a line on purpose.
  return { type: 'action', text: line.replace(/\s+$/, '') };
}

function characterFrom(text){
  var element = { type: 'character', text: text };
  if(/\^$/.test(text)){
    element.dual = true;
    element.text = text.replace(/\s*\^$/, '');
  }
  return element;
}

//Whether a document opening with this line has a title page. A script with none can still open
//with "FADE IN:", which has the shape of a key. The spec's keys are words ("Title", "Draft date");
//a transition is capitals. That is the whole difference, and it is enough.
function opensTitlePage(line){
  var key = TITLE_PAGE_KEY.exec(line);
  return key != null && key[1] !== key[1].toUpperCase();
}

//Reads the title page off the top of the document, if there is one: a run of "Key: value" lines
//up to the first blank line, where a key with nothing after the colon takes the indented lines
//that follow it as its values. Returns the page (an ordered list, since the order is the writer's)
//and how many lines it consumed - zero when the document does not open with a key.
function parseTitlePage(lines){
  var page = [];

  if(lines.length === 0 || !opensTitlePage(lines[0]))
    return { titlePage: page, consumed: 0 };

  var i = 0;
  var open = null;

  while(i < lines.length && !isBlank(lines[i])){
    var key = TITLE_PAGE_KEY.exec(lines[i]);

    if(key){
      open = { key: key[1].trim(), values: [] };
      page.push(open);
      if(key[2].trim() !== '')
        open.values.push(key[2].trim());
    }
    else if(open)
      open.values.push(lines[i].trim());

    i++;
  }

  return { titlePage: page, consumed: i };
}

//Splits the document into lines, reads the title page, then walks the body with the three pieces
//of state the rules need: blank lines seen since the last element, whether a dialogue group is
//open, and whether a boneyard or note is spanning lines.
function parseFountain(text){
  if(typeof text !== 'string' || text.length === 0)
    return { titlePage: [], elements: [] };

  var lines = normalizeLineBreaks(text).split('\n');
  var title = parseTitlePage(lines);
  var elements = [];

  var blankBefore = true;
  var inDialogue = false;
  //The comment type whose closing marker is being waited for, or null.
  var spanning = null;

  for(let i = title.consumed; i < lines.length; i++){
    var line = lines[i];
    var trimmed = line.trim();
    var previous = elements[elements.length - 1] || null;

    if(spanning){
      var closer = spanning === 'boneyard' ? '*/' : ']]';
      var closes = trimmed.endsWith(closer);
      var body = closes ? trimmed.slice(0, -closer.length).trim() : trimmed;
      //An empty closing line is only the marker - nothing to keep.
      if(!(closes && body === ''))
        elements.push(Object.assign(makeElement(spanning, body), { tight: true }));
      if(closes)
        spanning = null;
      blankBefore = false;
      continue;
    }

    if(isBlank(line) && !(inDialogue && isDialogueSpacer(line))){
      blankBefore = true;
      inDialogue = false;
      continue;
    }

    //A comment that opens here and does not close on this line.
    var opens = trimmed.startsWith('/*') ? 'boneyard' : (trimmed.startsWith('[[') ? 'note' : null);
    if(opens && !trimmed.endsWith(opens === 'boneyard' ? '*/' : ']]')){
      var head = trimmed.slice(2).trim();
      if(head !== '')
        elements.push(makeElement(opens, head));
      spanning = opens;
      blankBefore = false;
      inDialogue = false;
      continue;
    }

    var classified;
    if(inDialogue && isDialogueSpacer(line))
      classified = { type: 'dialogue', text: '' };
    else
      classified = classifyLine(line, {
        blankBefore: blankBefore,
        nextBlank: isBlank(lines[i + 1]),
        inDialogue: inDialogue
      });

    var element = makeElement(classified.type, classified.text);
    if(classified.dual) element.dual = true;
    if(classified.depth) element.depth = classified.depth;

    if(!blankBefore && previous && previous.type === element.type && NEVER_TIGHT.indexOf(element.type) === -1)
      element.tight = true;

    elements.push(element);

    inDialogue = element.type === 'character' || (inDialogue && GROUP_CONTINUATION.indexOf(element.type) !== -1);
    blankBefore = false;
  }

  return { titlePage: title.titlePage, elements: elements };
}

//Inline emphasis, the spec's four forms: *italic*, **bold**, ***bold italic***, _underline_. A
//backslash escapes the character after it. Walks the line once, toggling, the way markdownFic's
//tokenizeInline does and for the same reason: a span can sit inside a differently styled span.
//
//A marker with no partner is text, not a style left open to the end of the line: "5 * 3" is an
//action line about arithmetic. When a pass ends with a style still open, the marker that opened
//it is marked literal and the line is read again; every marker is a candidate at most once, so
//this ends.
function tokenizeInline(text){
  var literal = {};

  for(;;){
    var result = tokenizePass(text, literal);
    if(result.unclosed.length === 0)
      return result.runs;

    result.unclosed.forEach(function(position){
      literal[position] = true;
    });
  }
}

function tokenizePass(text, literal){
  var runs = [];
  var state = { bold: false, italic: false, underline: false };
  //Where each open style was switched on, so an unclosed one can be pointed at.
  var openedAt = {};
  var buffer = '';

  function flush(){
    if(buffer.length === 0)
      return;

    var attributes = {};
    if(state.bold) attributes.bold = true;
    if(state.italic) attributes.italic = true;
    if(state.underline) attributes.underline = true;

    var run = { text: buffer };
    if(Object.keys(attributes).length > 0)
      run.attributes = attributes;

    runs.push(run);
    buffer = '';
  }

  function toggle(style, at){
    flush();
    state[style] = !state[style];
    if(state[style])
      openedAt[style] = at;
    else
      delete openedAt[style];
  }

  var i = 0;
  while(i < text.length){
    var ch = text[i];

    if(ch === '\\' && i + 1 < text.length && '*_\\'.indexOf(text[i + 1]) !== -1){
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    if(ch === '*' && !literal[i]){
      var run = 1;
      while(run < 3 && text[i + run] === '*' && !literal[i + run])
        run++;

      if(run === 3){ toggle('bold', i); toggle('italic', i); }
      else if(run === 2) toggle('bold', i);
      else toggle('italic', i);
      i += run;
      continue;
    }

    if(ch === '_' && !literal[i]){
      toggle('underline', i);
      i += 1;
      continue;
    }

    buffer += ch;
    i += 1;
  }

  flush();

  var unclosed = Object.keys(openedAt).map(function(style){ return openedAt[style]; });
  return { runs: runs, unclosed: unclosed };
}

function runsText(runs){
  return runs.map(function(run){ return run.text; }).join('');
}

//An element from a line's raw text: the inline markup read off it, and `text` the plain result.
//Scene numbers stay in a heading's text; the serializer has nothing to do with them.
function makeElement(type, rawText){
  var runs = tokenizeInline(rawText);
  return { type: type, text: runsText(runs), runs: runs };
}

//Elements to the editor's delta: one line per element, its type as the `element` attributor
//(absent for action, which is Fountain's own default and the editor's), `tight` and `dual` as
//their own attributors, and the runs as inline formats. See docs/screenplay-plan.md's
//"Representation".
function elementsToDelta(elements){
  var ops = [];

  elements.forEach(function(element){
    (element.runs || [{ text: element.text || '' }]).forEach(function(run){
      if(run.text === '')
        return;
      var op = { insert: run.text };
      if(run.attributes && Object.keys(run.attributes).length > 0)
        op.attributes = Object.assign({}, run.attributes);
      ops.push(op);
    });

    var attributes = {};
    if(element.type !== 'action')
      attributes.element = element.type;
    if(element.tight)
      attributes.tight = true;
    if(element.dual)
      attributes.dual = true;

    var lineOp = { insert: '\n' };
    if(Object.keys(attributes).length > 0)
      lineOp.attributes = attributes;
    ops.push(lineOp);
  });

  if(ops.length === 0)
    ops.push({ insert: '\n' });

  return { ops: ops };
}

//The editor's delta back to elements. Any block attribute this codec does not know (a heading or a
//blockquote pasted from a prose chapter) is ignored, and an unknown element value is action.
function deltaToElements(delta){
  var elements = [];

  if(!delta || !Array.isArray(delta.ops))
    return elements;

  parseDelta(delta).paragraphs.forEach(function(para){
    var attributes = para.attributes || {};
    var runs = [];

    para.textRuns.forEach(function(run){
      //An embed has no text in a screenplay. It cannot be typed into one, so this is only ever a
      //footnote marker pasted from a prose chapter, and it is dropped rather than serialised.
      if(typeof run.text !== 'string' || run.text === '')
        return;

      var kept = { text: run.text };
      var styles = {};
      if(run.attributes){
        if(run.attributes.bold) styles.bold = true;
        if(run.attributes.italic) styles.italic = true;
        if(run.attributes.underline) styles.underline = true;
      }
      if(Object.keys(styles).length > 0)
        kept.attributes = styles;
      runs.push(kept);
    });

    var type = ELEMENT_TYPES.indexOf(attributes.element) !== -1 ? attributes.element : 'action';
    var element = { type: type, text: runsText(runs), runs: runs };

    if(attributes.tight && NEVER_TIGHT.indexOf(type) === -1)
      element.tight = true;
    if(attributes.dual && type === 'character')
      element.dual = true;
    if(type === 'section')
      element.depth = (/^#+/.exec(element.text) || [''])[0].length || 1;

    elements.push(element);
  });

  //An empty editor is one empty action line, which is an empty script.
  if(elements.length === 1 && elements[0].type === 'action' && elements[0].text === '')
    return [];

  return elements;
}

//Elements back to Fountain text. Everything the parser reads by position is put back by position:
//a blank line before each element except inside a dialogue group and before a `tight` line, and
//the force marker on any line that would otherwise read back as something else - decided by
//asking classifyLine, not by guessing which characters look dangerous.
function serializeFountain(titlePage, elements){
  var out = serializeTitlePage(titlePage || []);
  var body = [];

  //An empty action line is an empty paragraph in the editor and nothing in Fountain, where the
  //blank line between elements is structure rather than content. Written out it would have to be
  //forced ("!" alone on a line) to survive, and a file full of those for every stray Enter is not
  //worth a spacing the CSS provides anyway.
  elements = (elements || []).filter(function(element){
    return !(element.type === 'action' && (element.text || '') === '');
  });

  elements.forEach(function(element, i){
    var previous = i > 0 ? elements[i - 1] : null;
    var next = i + 1 < elements.length ? elements[i + 1] : null;

    var joined = previous != null && (element.tight ||
      (GROUP_CONTINUATION.indexOf(element.type) !== -1 && isDialogueGroupMember(previous)));

    if(previous != null && !joined)
      body.push('');

    var spanStart = !(previous && previous.type === element.type && element.tight);
    var spanEnd = !(next && next.type === element.type && next.tight);
    //Whether what follows this line on disk is a blank line, which is what the classifier reads
    //to tell a cue from an action line and a transition from a cue.
    var nextBlank = !(next && (next.tight ||
      (GROUP_CONTINUATION.indexOf(next.type) !== -1 && isDialogueGroupMember(element))));

    body.push(serializeLine(element, { spanStart: spanStart, spanEnd: spanEnd, nextBlank: nextBlank }));
  });

  //With no title page written, the first body line is what the parser looks at for one. An action
  //line shaped like a key ("Note: he is lying") would be read as a title page and vanish from the
  //script; forced, it reads as the action it is. Only action can be first and have that shape:
  //every other element opens with capitals or a marker the key pattern refuses.
  if(body.length > 0 && out === '' && opensTitlePage(body[0]) && elements[0].type === 'action')
    body[0] = '!' + body[0];

  if(body.length > 0){
    if(out !== '')
      out += '\n';
    out += body.join('\n') + '\n';
  }

  return out;
}

function isDialogueGroupMember(element){
  return element.type === 'character' || GROUP_CONTINUATION.indexOf(element.type) !== -1;
}

function serializeTitlePage(titlePage){
  var out = '';

  titlePage.forEach(function(entry){
    if(!entry || typeof entry.key !== 'string' || entry.key.trim() === '')
      return;

    var values = Array.isArray(entry.values) ? entry.values.filter(function(v){ return typeof v === 'string'; }) : [];

    if(values.length === 1)
      out += entry.key + ': ' + values[0] + '\n';
    else{
      out += entry.key + ':\n';
      values.forEach(function(value){
        out += '\t' + value + '\n';
      });
    }
  });

  return out;
}

function serializeLine(element, position){
  var text = inlineMarkup(element.runs || [{ text: element.text || '' }]);

  //Nothing here changes the case of what the writer typed. A lower-case cue or heading is written
  //forced instead ("@McClane", ".sniper scope pov"), which is what the spec's force markers are
  //for and is lossless where upper-casing is not: "@McCLANE" is in Big Fish because the name is
  //spelled that way. The editor upper-cases a line when it becomes a cue, heading or transition,
  //so the forced forms are rare in practice; the CSS shows them in capitals regardless.
  switch(element.type){
    case 'scene':
      return forceUnless('scene', '.', text, text, { blankBefore: true, nextBlank: position.nextBlank });
    case 'character':
      //A cue is read by the line after it: with a blank line there instead, it is action to the
      //spec, and a cue a writer has typed but not yet spoken under is forced so it comes back.
      return forceUnless('character', '@', text + (element.dual ? ' ^' : ''), text, { blankBefore: true, nextBlank: position.nextBlank });
    case 'transition':
      return forceUnless('transition', '> ', text, text, { blankBefore: true, nextBlank: true });
    case 'action':
      return forceUnless('action', '!', text, text, { blankBefore: !element.tight, nextBlank: position.nextBlank });
    case 'parenthetical':
      return /^\(.*\)$/.test(text) ? text : '(' + text + ')';
    case 'dialogue':
      //The spec's spelling of a blank line inside dialogue.
      return text === '' ? '  ' : text;
    case 'lyric':
      return '~' + text;
    case 'centered':
      return '> ' + text + ' <';
    case 'section':
      return /^#/.test(text) ? text : '#'.repeat(element.depth || 1) + ' ' + text;
    case 'synopsis':
      return '= ' + text;
    case 'pagebreak':
      return '===';
    case 'note':
      return (position.spanStart ? '[[' : '') + text + (position.spanEnd ? ']]' : '');
    case 'boneyard':
      return (position.spanStart ? '/* ' : '') + text + (position.spanEnd ? ' */' : '');
    default:
      return text;
  }
}

//Writes `line` as-is when it reads back as `type` with `expectedText` in the context it will sit
//in, and with the force marker in front when it does not. The text is compared as well as the
//type: an action line beginning "!" reads as action either way, but only the forced form keeps
//its "!".
function forceUnless(type, marker, line, expectedText, context){
  var read = classifyLine(line, { blankBefore: context.blankBefore, nextBlank: context.nextBlank, inDialogue: false });
  return read.type === type && read.text === expectedText ? line : marker + line;
}

const STYLE_ORDER = ['bold', 'italic', 'underline'];
const STYLE_MARKER = { bold: '**', italic: '*', underline: '_' };

function activeStyles(attributes){
  var active = { bold: false, italic: false, underline: false };
  if(attributes)
    STYLE_ORDER.forEach(function(style){ active[style] = Boolean(attributes[style]); });
  return active;
}

//Only the markers for styles that change between two runs, closing in reverse order and opening in
//order, the same reasoning as markdownFic's markersBetween.
function markersBetween(from, to){
  var closing = STYLE_ORDER.slice().reverse().filter(function(style){ return from[style] && !to[style]; });
  var opening = STYLE_ORDER.filter(function(style){ return !from[style] && to[style]; });
  return closing.concat(opening).map(function(style){ return STYLE_MARKER[style]; }).join('');
}

function inlineMarkup(runs){
  var out = '';
  var open = activeStyles(null);

  runs.forEach(function(run){
    if(typeof run.text !== 'string' || run.text === '')
      return;

    var styles = activeStyles(run.attributes);
    out += markersBetween(open, styles);
    out += escapeInline(run.text);
    open = styles;
  });

  out += markersBetween(open, activeStyles(null));
  return out;
}

//Every asterisk and underscore is a marker wherever it falls, and a backslash is what escapes one,
//so all three are escaped one character at a time.
function escapeInline(text){
  return text.replace(/[\\*_]/g, '\\$&');
}

//A page estimate from the elements alone. A script page is Courier 12 with an inch above and
//below: 55 lines. Each element takes the lines its text wraps to at its own width, plus the blank
//line before it, and a dialogue group has no blanks inside it. A real count needs the PDF; this is
//for the Word Count popup, which says it is an estimate.
const PAGE_LINES = 55;
const LINE_WIDTH = { action: 61, scene: 61, transition: 61, centered: 61, lyric: 35,
  dialogue: 35, parenthetical: 25, character: 38, section: 61, synopsis: 61 };

function estimatePages(elements){
  var lines = 0;

  elements.forEach(function(element, i){
    if(element.type === 'note' || element.type === 'boneyard')
      return;

    if(element.type === 'pagebreak'){
      lines = Math.ceil(lines / PAGE_LINES) * PAGE_LINES;
      return;
    }

    var previous = i > 0 ? elements[i - 1] : null;
    var joined = previous != null && (element.tight ||
      (GROUP_CONTINUATION.indexOf(element.type) !== -1 && isDialogueGroupMember(previous)));

    if(previous != null && !joined)
      lines += 1;

    var width = LINE_WIDTH[element.type] || 61;
    lines += Math.max(1, Math.ceil((element.text || '').length / width));
  });

  var exact = lines / PAGE_LINES;
  var whole = Math.floor(exact);
  var eighths = Math.round((exact - whole) * 8);
  if(eighths === 8){ whole += 1; eighths = 0; }

  return {
    pages: Math.ceil(exact),
    exact: exact,
    eighths: eighths === 0 ? String(whole) : whole + ' ' + eighths + '/8'
  };
}

//Title page lookups by key, case-insensitively, since the spec's keys are written however the
//writer likes ("Draft date", "Draft Date").
function getTitlePageValues(titlePage, key){
  var entry = (titlePage || []).find(function(e){ return e && typeof e.key === 'string' && e.key.toLowerCase() === key.toLowerCase(); });
  return entry ? entry.values.slice() : [];
}

//Replaces the values of `key`, or adds it at the end; removes it when `values` is empty. Returns
//a new list rather than editing the one passed in.
function setTitlePageValues(titlePage, key, values){
  var kept = (titlePage || []).filter(function(e){ return !(e && typeof e.key === 'string' && e.key.toLowerCase() === key.toLowerCase()); });
  var cleaned = (values || []).map(function(v){ return String(v).trim(); }).filter(function(v){ return v !== ''; });

  if(cleaned.length === 0)
    return kept;

  var index = (titlePage || []).findIndex(function(e){ return e && typeof e.key === 'string' && e.key.toLowerCase() === key.toLowerCase(); });
  var entry = { key: index !== -1 ? titlePage[index].key : key, values: cleaned };

  if(index === -1)
    kept.push(entry);
  else
    kept.splice(index, 0, entry);

  return kept;
}

//Only the shapes serializeTitlePage can write are kept: a .woolf is a plain file anything could
//have edited, the same discipline project.js applies to its word list.
function sanitizeTitlePage(raw){
  if(!Array.isArray(raw))
    return [];

  return raw.filter(function(entry){
    return entry && typeof entry.key === 'string' && entry.key.trim() !== '' && Array.isArray(entry.values);
  }).map(function(entry){
    return {
      key: entry.key.trim(),
      values: entry.values.filter(function(v){ return typeof v === 'string'; })
    };
  });
}

module.exports = {
  ELEMENT_TYPES,
  NEVER_TIGHT,
  parseFountain,
  serializeFountain,
  elementsToDelta,
  deltaToElements,
  tokenizeInline,
  classifyLine,
  estimatePages,
  getTitlePageValues,
  setTitlePageValues,
  sanitizeTitlePage
};
