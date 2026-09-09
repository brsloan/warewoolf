const { parseDelta, getOrderedListNumbers, getListMarker, isFootnoteMarker } = require('./quill-utils');

//Sequences a leading backslash can escape, grouped by where the escape means anything - which is
//exactly where parseLine could otherwise read the marker itself. A backslash anywhere else is a
//backslash: "a \> b" is text with a backslash in it, not an escaped blockquote marker.
//
//Within each group the two-char markers come before their one-char prefixes, so "\*\*" reads as an
//escaped "**" rather than an escaped "*" followed by a literal "*".
//
//Inline styles and a footnote reference are read anywhere in a line by tokenizeInline, so an escape
//for one is honoured anywhere.
const ESCAPABLE_ANYWHERE = [/^\*\*/, /^\*/, /^~~/, /^__/, /^\[\^/];

//ALIGN_MARKER, HEADER_MARKER and BLOCKQUOTE_MARKER are ^-anchored and tolerate no indent, so these
//three are only ever markers at the very start of the text tokenizeInline is handed - which is the
//text left after parseLine has stripped whatever block markers the line did carry.
const ESCAPABLE_AT_TEXT_START = [/^\[>/, /^#/, /^>/];

//LIST_MARKER reads its marker after any indent, so a list escape is honoured after indent too. It
//has to be: escapeListMarkers writes the backslash after whatever indent it finds, and spaces count
//as indent alongside tabs, so refusing spaces here would leave that backslash in the text.
const ESCAPABLE_AFTER_INDENT = [/^-/, /^\+/, /^(?:\d+|[a-z])\. /];

//Joined once here rather than per backslash, since consumeEscape is the hot path on a chapter dense
//with escaped markers.
const ESCAPABLE_LIST_AND_BLOCK = ESCAPABLE_ANYWHERE.concat(ESCAPABLE_AT_TEXT_START, ESCAPABLE_AFTER_INDENT);
const ESCAPABLE_LIST_ONLY = ESCAPABLE_ANYWHERE.concat(ESCAPABLE_AFTER_INDENT);

//Whether nothing but indent precedes the backslash at `index`, which is what puts it at a list
//marker's position.
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

function consumeEscape(text, i){
  var patterns = ESCAPABLE_ANYWHERE;

  if(i === 0)
    patterns = ESCAPABLE_LIST_AND_BLOCK;
  else if(onlyIndentPrecedes(text, i))
    patterns = ESCAPABLE_LIST_ONLY;

  var tail = text.slice(i + 1);

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
      var escaped = consumeEscape(text, i);
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

    //An unescaped footnote reference. The escape check above already consumed a backslash-prefixed
    //"\[^", which is how a writer who genuinely wants the literal characters gets them back - see
    //ESCAPABLE_ANYWHERE - so a bare "[" reaching here is either a real reference or ordinary prose
    //that happens to contain a bracket. A run's `text` becomes the marker's embed object rather
    //than a string in that one case, the same dual shape parseDelta already gives a run whose
    //insert is an embed - which is what lets parseMDF below hand `run.text` straight to `insert`
    //with no extra branch of its own.
    if(ch === '['){
      var footnoteRef = FOOTNOTE_REF_MARKER.exec(text.slice(i));
      if(footnoteRef){
        flush();

        var refAttributes = {};
        if(state.bold) refAttributes.bold = true;
        if(state.italic) refAttributes.italic = true;
        if(state.underline) refAttributes.underline = true;
        if(state.strike) refAttributes.strike = true;

        var markerRun = { text: { footnote: { n: footnoteRef[1] } } };
        if(Object.keys(refAttributes).length > 0)
          markerRun.attributes = refAttributes;

        runs.push(markerRun);
        i += footnoteRef[0].length;
        continue;
      }

      buffer += ch;
      i += 1;
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

//The body marker ("[^1]: ") is only ever read at true line start, once, by parseLine below - never
//by tokenizeInline, which only ever sees the reference form (no colon) once parseLine has already
//stripped this. (.*) rather than (.+), matching every other block marker here, so a blank note
//paragraph ("[^1]:" with nothing after it) still parses instead of losing its marker.
const FOOTNOTE_BODY_MARKER = /^\[\^(\d+)\]: ?(.*)$/;

//The reference form (no colon), recognised anywhere inline by tokenizeInline rather than only at
//line start the way every other marker here is - a footnote reference is ordinary inline content,
//free to sit in the middle of a sentence rather than opening it.
const FOOTNOTE_REF_MARKER = /^\[\^(\d+)\]/;

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

  //Stripped and kept, like alignment above, rather than returned early like list/blockquote below -
  //a footnote body combines with any of the three that follow (a note that is also a list item
  //spells as "[^1]: - item"), so the rest of the line still has to be read for one.
  var footnote = FOOTNOTE_BODY_MARKER.exec(rest);
  if(footnote){
    attributes.footnoteBody = footnote[1];
    rest = footnote[2];
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

  //The footnote body id the line above carried, if any. A multi-paragraph note spells every one of
  //its paragraphs "[^N]: " on disk, so a body line repeating the id directly above it is a
  //continuation of that note rather than the start of a new one - which is the difference between
  //a paragraph that prints the note's number and one that does not (see blots/footnotes.js). Read
  //from the file here rather than left to the reconcile pass, because a chapter is displayed the
  //moment it is loaded and the pass does not run until something changes.
  var previousFootnoteBody = null;

  lines.forEach(function(line){
    var parsed = parseLine(line, afterListItem);
    afterListItem = parsed.attributes.list != null;

    if(parsed.attributes.footnoteBody != null && parsed.attributes.footnoteBody === previousFootnoteBody)
      parsed.attributes.footnoteBodyCont = true;

    previousFootnoteBody = parsed.attributes.footnoteBody != null ? parsed.attributes.footnoteBody : null;

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
    var lineMarker = '';

    if(para.textRuns.length > 0)
      lineMarker = getLineMarker(para.attributes, listNumbers[i]);

    mdf += lineMarker;

    //Whether this line already carries a list, blockquote or heading marker of its own - the three
    //parseLine stops looking for once it has found one. See escapeAnyMarkers.
    var blockMarkerWritten = Boolean(getListMarker(para.attributes, listNumbers[i]) ||
      (para.attributes && (para.attributes.blockquote || para.attributes.header)));

    var openStyles = activeStyles(null);
    //Nothing on this line so far but the line marker, so the next character written is the one
    //parseLine will read a block marker from. A style marker, or any run text at all, ends that -
    //including a run the caller had to skip past, which is why this is tracked rather than taken
    //from the run index.
    var atStartOfText = true;

    para.textRuns.forEach((run, i) => {
      var styles = activeStyles(run.attributes);
      var styleMarkers = markersBetween(openStyles, styles);
      mdf += styleMarkers;

      if(styleMarkers !== '')
        atStartOfText = false;

      //A footnote marker embed rather than a string run (parseDelta hands one through with
      //flattenInserts's Phase 0 fix, unchanged) - written out as the literal, unescaped reference
      //it represents rather than run through escapeAnyMarkers, which would either throw on a
      //non-string or, if it accepted one, wrongly treat a real marker as prose to escape.
      if(isFootnoteMarker(run.text)){
        mdf += '[^' + run.text.footnote.n + ']';
        atStartOfText = false;
      }
      else{
        mdf += escapeAnyMarkers(run.text, {
          atLineStart: atStartOfText && lineMarker === '',
          atBlockPosition: atStartOfText && !blockMarkerWritten
        });

        if(run.text.length > 0)
          atStartOfText = false;
      }

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

    //Also combines with whatever follows, the same as alignment - not part of the list/blockquote/
    //header chain below, which stays mutually exclusive since Quill's own blots are.
    if(attr.footnoteBody != null)
      marker += '[^' + attr.footnoteBody + ']: ';

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

//Bold, italic, underline and strikethrough mean what they mean wherever they fall, and so does a
//footnote reference - tokenizeInline reads all five anywhere in a line. They are escaped anywhere.
const INLINE_MARKERS = /(\*\*|\*|~~|__|\[\^)/g;

//These three are not inline. parseLine reads alignment, blockquote and heading with ^-anchored
//regexes, so "#", ">" and "[>" are ordinary characters everywhere except the one position each is
//read at - and escaping them everywhere put a backslash into the file for nothing, which is what
//"File \> Dictionaries" was. Only the first character of a run needs it: a marker is recognised by
//its opening character, so "\## head" and "\>> quote" both read back whole.
const ALIGN_MARKER_START = /^\[>/;
const BLOCK_MARKER_START = /^(#|>)/;

//`position` says where in the line parseLine will be looking when it reaches this run, which is what
//decides whether a leading marker character has to be escaped:
//
//- atLineStart: nothing at all precedes this text on the line. ALIGN_MARKER is matched against the
//  raw line, so that is the only place a "[>" can be read as one.
//- atBlockPosition: nothing precedes this text except an alignment or footnote-body marker, both of
//  which parseLine strips before it looks for a list, blockquote or heading. A block marker of the
//  line's own means there is nothing left to look for - parseLine has already consumed it, and
//  returns early for a list or a quotation - so text behind one needs no escaping at all.
function escapeAnyMarkers(text, position){
  text = text.replace(INLINE_MARKERS, '\\$1');

  if(position.atLineStart)
    text = text.replace(ALIGN_MARKER_START, '\\$&');

  if(position.atBlockPosition){
    text = text.replace(BLOCK_MARKER_START, '\\$1');
    text = escapeListMarkers(text);
  }

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