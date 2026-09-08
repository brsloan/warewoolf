const { parseDelta, getOrderedListNumbers, getListMarker } = require('./quill-utils');

//Sequences a leading backslash can escape. The two-char markers are listed before their one-char
//prefixes so "\*\*" is read as an escaped "**" rather than an escaped "*" followed by a literal
//"*". List/ordered markers ("-", "+", "1. ") are only ever written with an escaping backslash at
//the very start of a paragraph's text (see escapeListMarkers below), so they're only recognised
//there - a stray "\-" in the middle of a sentence is just a literal backslash followed by a dash.
const ESCAPABLE_ANYWHERE = [/^\*\*/, /^\*/, /^~~/, /^__/, /^#/, /^\[>/, /^>/, /^\[\^/];
const ESCAPABLE_AT_LINE_START = [/^-/, /^\+/, /^(?:\d+|[a-z])\. /];

//Whether a backslash at `index` is at the start of its line, for the purpose of reading escapes.
//Line-start list markers ("- ", "1. ") are only ever written with an escaping backslash right after
//a paragraph's indent (see escapeListMarkers), never after any other character - so "at line start"
//means "nothing but indent precedes this backslash", not literally index === 0.
//
//Spaces count as indent alongside tabs, and have to: escapeListMarkers writes the backslash after
//whatever indent it finds, so refusing spaces here would leave the backslash it wrote sitting in
//the text as a literal character.
//
//Walks backwards rather than forwards, which is what keeps it cheap: a backslash in the middle of a
//sentence is preceded by an ordinary character, so the very first comparison settles it. Only a
//backslash genuinely sitting in a paragraph's indent reads more than one, and there are never many
//of those. This used to ask the same question as /^\t*$/.test(text.slice(0, index)), which copied
//the whole preceding text on every backslash - about a fifth of the parse time on a chapter dense
//with escaped markers, such as the MarkdownFic page of the Help doc.
function onlyIndentPrecedes(text, index){
  for(let i = index - 1; i >= 0; i--)
    if(text[i] !== '\t' && text[i] !== ' ')
      return false;

  return true;
}

function consumeEscape(text, i, atLineStart){
  var tail = text.slice(i + 1);
  var patterns = atLineStart ? ESCAPABLE_ANYWHERE.concat(ESCAPABLE_AT_LINE_START) : ESCAPABLE_ANYWHERE;

  for(let p = 0; p < patterns.length; p++){
    var m = patterns[p].exec(tail);
    if(m)
      return m[0];
  }

  return null;
}

function countRun(text, i, ch){
  var n = 0;
  while(text[i + n] === ch)
    n++;
  return n;
}

//Walks a paragraph's text once, left to right, toggling bold/italic/underline/strike on and off as
//their markers are found, rather than matching each style as its own regex across the whole line.
//That toggling is what lets a span of one style contain a differently-styled span in its *middle*
//- e.g. "**bold and __underlined__ within**" - without the outer style getting lost from the text
//on either side of the inner span, which is what happened when each style was a separate
//whole-string replace pass run one after another.
function tokenizeInline(text){
  var runs = [];
  var state = { bold: false, italic: false, underline: false, strike: false };
  var buffer = '';

  function flush(){
    if(buffer.length === 0)
      return;

    var attributes = {};
    if(state.bold) attributes.bold = true;
    if(state.italic) attributes.italic = true;
    if(state.underline) attributes.underline = true;
    if(state.strike) attributes.strike = true;

    var run = { text: buffer };
    if(Object.keys(attributes).length > 0)
      run.attributes = attributes;

    runs.push(run);
    buffer = '';
  }

  var i = 0;
  while(i < text.length){
    var ch = text[i];

    if(ch === '\\'){
      var escaped = consumeEscape(text, i, onlyIndentPrecedes(text, i));
      if(escaped !== null){
        buffer += escaped;
        i += 1 + escaped.length;
      }
      else{
        buffer += ch;
        i += 1;
      }
      continue;
    }

    //A run of 3 asterisks toggles bold+italic together (WareWoolf's documented combined-style
    //marker); any left over beyond 3 keep being read as further bold/italic toggles.
    if(ch === '*'){
      var take = Math.min(countRun(text, i, '*'), 3);
      flush();
      if(take === 3){ state.bold = !state.bold; state.italic = !state.italic; }
      else if(take === 2) state.bold = !state.bold;
      else state.italic = !state.italic;
      i += take;
      continue;
    }

    if(ch === '_'){
      if(countRun(text, i, '_') >= 2){
        flush();
        state.underline = !state.underline;
        i += 2;
      }
      else{
        buffer += ch;
        i += 1;
      }
      continue;
    }

    if(ch === '~'){
      if(countRun(text, i, '~') >= 2){
        flush();
        state.strike = !state.strike;
        i += 2;
      }
      else{
        buffer += ch;
        i += 1;
      }
      continue;
    }

    buffer += ch;
    i += 1;
  }

  flush();
  return runs;
}

const ALIGNMENTS = { l: 'left', r: 'right', c: 'center', j: 'justify' };
const LIST_MARKER = /^([\t ]*)([-*+]|(?:\d+|[a-z])\.) (.*)$/;

//Four spaces read as one tab, the way CommonMark counts an indent. WareWoolf still writes tabs, so
//a file that came in space-indented is normalized on the first save, exactly as a '-' marker is
//rewritten as '*'.
const SPACES_PER_LEVEL = 4;

//MarkdownFic carries three levels, and so do the .docx/.epub writers - anything deeper folds into
//the last one. See getListLevel in quill-utils.js, which draws the same ceiling from the other end.
const MAX_LIST_LEVEL = 2;

//How deep a list item's indent puts it. A tab is a level; so is each group of four spaces, with a
//remainder of fewer than four counting for nothing - so two spaces leave an item at the level of
//the one above rather than nested under it.
function indentLevelFor(indent){
  var level = 0;
  var spaces = 0;

  for(let i = 0; i < indent.length; i++){
    if(indent[i] === '\t'){
      level++;
      spaces = 0;
      continue;
    }

    spaces++;
    if(spaces === SPACES_PER_LEVEL){
      level++;
      spaces = 0;
    }
  }

  return Math.min(level, MAX_LIST_LEVEL);
}
//(.*) rather than (.+): a blank quoted line is written as "> " (marker, no text), and (.+) would
//force the optional space to backtrack into the capture, turning every blank line inside a quote
//into a line containing one literal space. mdfc-to-html.js already carries this fix; mirror it here.
const BLOCKQUOTE_MARKER = /^>+ ?(.*)$/;
const ALIGN_MARKER = /^\[>([lrcj])\] (.*)$/;
const HEADER_MARKER = /^(#{1,4}) (.*)$/;

//A line's block-level markers (alignment, then list/blockquote/heading) only ever appear at the very
//start of the line, in that order, so they're read off with a handful of anchored regexes - only the
//inline styling in the remaining text needs tokenizeInline's character-by-character scan.
//
//Alignment is the outermost marker and combines with every block marker below it, which is why it is
//stripped first and the rest are matched against what's left. It used to be read *after* the list and
//blockquote markers, which meant a centered list item or a centered quote could not be spelled at all:
//convertDeltaToMDF's getLineMarker overwrote the alignment marker with the block one, so the
//alignment was dropped on save and gone on the next read. List, blockquote and heading still do not
//combine with each other - Quill's own blots are mutually exclusive - and keep their old precedence.
//`afterListItem` says whether the line immediately above this one was a list item, and it gates one
//thing only: whether a SPACE-indented marker opens a list.
//
//A tab-indented marker, or one with no indent at all, is a list item wherever it appears - that has
//always been true and is untouched. Spaces are the addition, and they are gated because a space
//indent is not a marker a writer opts into: fiction is full of space-indented paragraphs, imported
//manuscripts especially (Convert Marked Tabs exists for exactly that, and defaults to four spaces).
//A paragraph of prose that happens to open with a hyphen would otherwise become a bullet, silently
//losing its indent and its first character. Requiring a list item directly above is CommonMark's
//own rule - an indented item nests under something - and it keeps a lone indented paragraph prose.
function parseLine(line, afterListItem){
  var attributes = {};
  var rest = line;

  var align = ALIGN_MARKER.exec(rest);
  if(align){
    attributes.align = ALIGNMENTS[align[1]];
    rest = align[2];
  }

  var list = LIST_MARKER.exec(rest);
  if(list && (afterListItem || list[1].indexOf(' ') === -1)){
    attributes.list = /^[-*+]$/.test(list[2]) ? 'bullet' : 'ordered';

    var level = indentLevelFor(list[1]);
    if(level > 0)
      attributes.indent = level;

    return { attributes: attributes, runs: tokenizeInline(list[3]) };
  }

  var blockquote = BLOCKQUOTE_MARKER.exec(rest);
  if(blockquote){
    attributes.blockquote = true;
    return { attributes: attributes, runs: tokenizeInline(blockquote[1]) };
  }

  var header = HEADER_MARKER.exec(rest);
  if(header){
    attributes.header = header[1].length;
    rest = header[2];
  }

  return { attributes: attributes, runs: tokenizeInline(rest) };
}

function parseMDF(str){
  if(typeof str !== 'string' || str.length === 0)
    return { ops: [ {insert: '\n'} ] };

  var lines = str.split(/\r\n|\r|\n/);

  //convertDeltaToMDF always ends every paragraph (including the last) with a line terminator, so
  //splitting on line terminators always leaves one trailing empty element that isn't a real blank
  //paragraph - drop it. Every other element, including runs of several empty strings from several
  //consecutive blank lines, is a real paragraph and is kept, each becoming its own op below.
  if(lines[lines.length - 1] === '')
    lines.pop();

  var ops = [];

  //Whether the line just parsed was a list item, which is all the context parseLine needs - see the
  //note on it. Deliberately the line immediately above, not the last non-blank one: a blank line
  //ends the list, which keeps the gate as narrow as it can be.
  var afterListItem = false;

  lines.forEach(function(line){
    var parsed = parseLine(line, afterListItem);
    afterListItem = parsed.attributes.list != null;

    parsed.runs.forEach(function(run){
      var op = { insert: run.text };
      if(run.attributes)
        op.attributes = run.attributes;
      ops.push(op);
    });

    var lineOp = { insert: '\n' };
    if(Object.keys(parsed.attributes).length > 0)
      lineOp.attributes = parsed.attributes;
    ops.push(lineOp);
  });

  if(ops.length === 0)
    ops.push({insert: '\n'});

  return { ops: ops };
}

const STYLE_ORDER = ['bold', 'italic', 'underline', 'strike'];
const STYLE_MARKER = { bold: '**', italic: '*', underline: '__', strike: '~~' };

function activeStyles(attributes){
  var active = { bold: false, italic: false, underline: false, strike: false };
  if(attributes){
    STYLE_ORDER.forEach(function(style){
      active[style] = Boolean(attributes[style]);
    });
  }
  return active;
}

//Writes only the markers for styles that actually change between two runs, in the fixed order
//documented for MarkdownFic (bold, italic, underline, strike - reversed when closing), instead of
//wrapping every run in its own open+close markers regardless of its neighbors. A style that
//carries on unchanged across a run boundary - e.g. a bold sentence with one underlined word in the
//middle, which Quill represents as three runs where the outer two are bold-only and the middle one
//is bold+underline - is therefore never closed and immediately reopened. That redundant
//close-then-reopen is what corrupted mixed styling on the read side: it left adjacent marker
//sequences in the output whose grouping into tokens was ambiguous.
function markersBetween(from, to){
  var closing = STYLE_ORDER.slice().reverse().filter(function(style){ return from[style] && !to[style]; });
  var opening = STYLE_ORDER.filter(function(style){ return !from[style] && to[style]; });

  return closing.map(function(style){ return STYLE_MARKER[style]; }).join('')
    + opening.map(function(style){ return STYLE_MARKER[style]; }).join('');
}

function convertDeltaToMDF(delt){
  var mdf = '';

  var parsedQuill = parseDelta(delt);
  var listNumbers = getOrderedListNumbers(parsedQuill.paragraphs);

  parsedQuill.paragraphs.forEach((para, i) => {

    if(para.textRuns.length > 0)
      mdf += getLineMarker(para.attributes, listNumbers[i]);

    var openStyles = activeStyles(null);

    para.textRuns.forEach((run, i) => {
      var styles = activeStyles(run.attributes);
      mdf += markersBetween(openStyles, styles);
      mdf += escapeAnyMarkers(run.text, i);
      openStyles = styles;
    });

    mdf += markersBetween(openStyles, activeStyles(null));

    mdf += '\r\n';
  });

  return mdf;
}

//The alignment marker is written first and kept whatever follows it, matching the order parseLine
//reads them back in. It used to be overwritten by a list or blockquote marker, so a centered quote or
//list item - which Quill happily holds, since align is a class on the block rather than a blot of its
//own - lost its alignment the moment the chapter was saved.
//
//List, blockquote and heading remain mutually exclusive, in that order of precedence. Quill cannot
//produce a line carrying two of them, so the order only decides what a hand-edited delta does.
function getLineMarker(attr, listItemNum = 0){
  var marker = '';

  if(attr){
    if(attr.align){
      if(attr.align == 'center')
        marker = '[>c] ';
      else if(attr.align == 'right')
        marker = '[>r] ';
      else if(attr.align == 'justify')
        marker = '[>j] '
    }

    var listMarker = getListMarker(attr, listItemNum);

    if(listMarker)
      marker += listMarker;
    else if(attr.blockquote)
      marker += '> ';
    else if(attr.header){
      for(let i=0; i < attr.header; i++){
        marker+= '#';
      }
      marker += ' ';
    }
  }

  return marker;
};

function escapeAnyMarkers(text, runIndex){
  var escapedMarkersRegx = /(\*\*|\*|~~|__|#|\[>|>|\[\^)/g;
  text = text.replace(escapedMarkersRegx, '\\$1')

  //Because escapeAnyMarkers is applied to every run in every paragraph
  //individually, in some circumstances (formatting within a line breaking it up into multiple runs)
  //escapeListMarkers would escape markers inside of a line instead of at the beginning. 
  //So we only apply escapeListMarkers to the first run, since any valid list marker would reside
  //entirely within the first run of any given paragraph
  if(runIndex == 0)
    text = escapeListMarkers(text);

  return text;
}

//Escaped after any indent, tabs or spaces, and without regard to what the paragraph above was.
//parseLine only reads a space-indented marker as a list when a list item precedes it, but escaping
//only in that case would mean a paragraph's spelling on disk depended on its neighbour - so a
//paragraph edited above it could change how this one reads. Escaping always costs a backslash and
//makes the line mean the same thing wherever it lands.
function escapeListMarkers(text){
  const listUnordered = /^([\t ]*)(-|\*|\+) /gm;
  text = text.replace(listUnordered, '$1\\$2 ');

  const listOrdered = /^([\t ]*)((?:\d+|[a-z])\.) /gm;
  text = text.replace(listOrdered, '$1\\$2 ');

  return text;
}

module.exports = {
  parseMDF,
  convertDeltaToMDF,
  tokenizeInline
};