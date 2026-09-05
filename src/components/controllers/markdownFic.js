const { parseDelta, getOrderedListNumbers, getListMarker } = require('./quill-utils');

//Sequences a leading backslash can escape. The two-char markers are listed before their one-char
//prefixes so "\*\*" is read as an escaped "**" rather than an escaped "*" followed by a literal
//"*". List/ordered markers ("-", "+", "1. ") are only ever written with an escaping backslash at
//the very start of a paragraph's text (see escapeListMarkers below), so they're only recognised
//there - a stray "\-" in the middle of a sentence is just a literal backslash followed by a dash.
const ESCAPABLE_ANYWHERE = [/^\*\*/, /^\*/, /^~~/, /^__/, /^#/, /^\[>/, /^>/, /^\[\^/];
const ESCAPABLE_AT_LINE_START = [/^-/, /^\+/, /^(?:\d+|[a-z])\. /];

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
      //Line-start list markers ("- ", "1. ") are only ever written with a leading backslash right
      //after a paragraph's leading tabs (see escapeListMarkers), never after any other character -
      //so "at line start" here means "nothing but tabs precedes this backslash", not literally i===0.
      var atLineStart = /^\t*$/.test(text.slice(0, i));
      var escaped = consumeEscape(text, i, atLineStart);
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
const LIST_MARKER = /^(\t*)([-*+]|(?:\d+|[a-z])\.) (.*)$/;
const BLOCKQUOTE_MARKER = /^>+ ?(.+)$/;
const ALIGN_MARKER = /^\[>([lrcj])\] (.*)$/;
const HEADER_MARKER = /^(#{1,4}) (.*)$/;

//A line's block-level markers (list, blockquote, alignment, heading) only ever appear at the very
//start of the line, in that order of precedence, so they're read off with a handful of anchored
//regexes - only the inline styling in the remaining text needs tokenizeInline's character-by-
//character scan. Alignment and heading markers combine (in that order); list and blockquote don't
//combine with anything else, matching what convertDeltaToMDF below ever actually writes.
function parseLine(line){
  var attributes = {};

  var list = LIST_MARKER.exec(line);
  if(list){
    attributes.list = /^[-*+]$/.test(list[2]) ? 'bullet' : 'ordered';
    if(list[1].length === 1)
      attributes.indent = 1;
    else if(list[1].length >= 2)
      attributes.indent = 2;

    return { attributes: attributes, runs: tokenizeInline(list[3]) };
  }

  var blockquote = BLOCKQUOTE_MARKER.exec(line);
  if(blockquote){
    attributes.blockquote = true;
    return { attributes: attributes, runs: tokenizeInline(blockquote[1]) };
  }

  var rest = line;

  var align = ALIGN_MARKER.exec(rest);
  if(align){
    attributes.align = ALIGNMENTS[align[1]];
    rest = align[2];
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

  lines.forEach(function(line){
    var parsed = parseLine(line);

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
    if(attr.header){
      for(let i=0; i < attr.header; i++){
        marker+= '#';
      }
      marker += ' ';
    }
    if(attr.blockquote)
      marker = '> ';

    var listMarker = getListMarker(attr, listItemNum);
    if(listMarker)
      marker = listMarker;
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

function escapeListMarkers(text){
  const listUnordered = /^(\t*)(-|\*|\+) /gm; 
  text = text.replace(listUnordered, '$1\\$2 ');

  const listOrdered = /^(\t*)((?:\d+|[a-z])\.) /gm;
  text = text.replace(listOrdered, '$1\\$2 ');

  return text;
}

module.exports = {
  parseMDF,
  convertDeltaToMDF,
  tokenizeInline
};