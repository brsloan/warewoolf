const { parseDelta, getOrderedListNumbers, getListMarker, isFootnoteMarker } = require('./quill-utils');

//Sequences a leading backslash can escape, grouped by where the escape means anything - which is
//exactly where parseLine could otherwise read the marker itself. A backslash anywhere else is a
//backslash: "a \> b" is text with a backslash in it, not an escaped blockquote marker.
//
//An escape covers ONE character. It used to cover the whole two-character marker - "\**" was an
//escaped "**" - and that made the format ambiguous with itself: a writer's own "*" at the end of an
//italic span was written "\*" with the closing "*" right behind it, which is the same "\**", and it
//came back as a literal "**" with the span's marker eaten. No reader could tell those apart, and
//neither could a person. One character per escape has one reading: a literal "**" is "\*\*", and
//"\*" followed by a marker is exactly that. The same goes for "~~", "__" and a footnote reference,
//whose "[" is what carries the escape now.
//
//Inline styles and a footnote reference are read anywhere in a line by tokenizeInline, so an escape
//for one is honoured anywhere - and so is an escaped backslash, which is how a writer whose own
//backslash lands where an escape would be read gets it back instead of having it eaten.
//The "[" is conditional where the others are not, and for the same reason "#" is conditional on the
//writer's side: a bracket is only ever a marker as the head of a reference, so "a \[b] c" keeps its
//backslash the way "a \> b" does. The lookahead only decides whether this is an escape at all - the
//escape still covers the one character.
const ESCAPABLE_ANYWHERE = [/^\\/, /^\*/, /^~/, /^_/, /^\[(?=\^)/];

//ALIGN_MARKER, HEADER_MARKER and BLOCKQUOTE_MARKER are ^-anchored and tolerate no indent, so these
//three are only ever markers at the very start of the text tokenizeInline is handed - which is the
//text left after parseLine has stripped whatever block markers the line did carry.
//
//Matched on the opening character alone, which is wider than the markers themselves: "\#hashtag" is
//read as an escape though it could not have been a heading. That is deliberate - a writer hand-
//editing a file should not have to know that a heading needs its space before the escape becomes
//load-bearing - and it is why escapeAnyMarkers no longer writes that one (see HEADER_MARKER_START)
//while backslashIsRead still asks the question from this side.
//
//The "[" here is the alignment marker's, and is unconditional the way "#" and ">" are - at the
//start of the text any of the three may open a marker. ESCAPABLE_ANYWHERE's own "[" is narrower,
//covering only a footnote reference's, so the two do not overlap anywhere it matters.
const ESCAPABLE_AT_TEXT_START = [/^\[/, /^#/, /^>/];

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

//The sequences a backslash at `index` is able to escape, which is decided by where the backslash
//sits. escapeBackslashes asks the same question from the writer's side, and the run it is looking at
//need not begin the line's text - that is what `atTextStart` is for. tokenizeInline is always handed
//text that does begin it, so the reader below leaves the flag at its default.
function escapePatternsAt(text, index, atTextStart = true){
  if(atTextStart){
    if(index === 0)
      return ESCAPABLE_LIST_AND_BLOCK;
    if(onlyIndentPrecedes(text, index))
      return ESCAPABLE_LIST_ONLY;
  }

  return ESCAPABLE_ANYWHERE;
}

function consumeEscape(text, i){
  var patterns = escapePatternsAt(text, i);
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
    var textRuns = para.textRuns;
    var lineMarker = '';

    if(textRuns.length > 0)
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

    //Everything written to this line after its marker is whitespace - which is still a list
    //marker's position, since LIST_MARKER reads one after any indent. A quotation or heading marker
    //is not read there, so the two positions are tracked apart: escaping ">" or "#" behind indent
    //writes a backslash the reader will not take off again.
    var onlyIndentSoFar = true;

    //The last run text actually written to this line, which is what a "_" or "~" opening the next
    //run could pair with when no style marker separates the two.
    var lastTextWritten = '';

    textRuns.forEach((run, i) => {
      var styles = activeStyles(run.attributes);
      var styleMarkers = markersBetween(openStyles, styles);
      var text = run.text;

      //A style marker must not be left sitting against a space at the position parseLine reads a
      //list marker from: "*" and a space is a bullet, so an italic run whose text opened with one
      //turned its whole paragraph into a list item and lost both the italics and the space. There
      //is no escape for it - the asterisk really is the marker - so the space moves in front of the
      //marker instead, where LIST_MARKER's own indent absorbs it harmlessly.
      //
      //Only ever at the head of a line, and only whitespace that already sat at the head of the
      //styled text, so no style span is ever broken in two: a space in the middle of a bold span
      //stays exactly where it is. The space keeps its place in the text and loses only a style flag
      //it had no way of showing.
      if(styleMarkers !== '' && onlyIndentSoFar && !blockMarkerWritten && typeof text === 'string'){
        var leadingWhitespace = (/^[ \t]+/.exec(text) || [''])[0];

        if(leadingWhitespace !== ''){
          mdf += leadingWhitespace;
          text = text.slice(leadingWhitespace.length);
          atStartOfText = false;
        }
      }

      //Nothing left to mark up - either the run was empty to begin with, or it was nothing but the
      //whitespace just moved out. Its markers would be a pair with nothing between them, so it is
      //skipped without touching openStyles, and the next run carrying text writes the transition
      //from wherever the last one that did left it.
      if(typeof text === 'string' && text.length === 0)
        return;

      mdf += styleMarkers;

      //Whatever this run's text will run up against on the line, which is what a "_" or "~" at its
      //end could pair with, and whether anything follows it at all.
      var following = emissionAfter(textRuns, i, styles);

      if(styleMarkers !== ''){
        atStartOfText = false;
        onlyIndentSoFar = false;
      }

      //A footnote marker embed rather than a string run (parseDelta hands one through with
      //flattenInserts's Phase 0 fix, unchanged) - written out as the literal, unescaped reference
      //it represents rather than run through escapeAnyMarkers, which would either throw on a
      //non-string or, if it accepted one, wrongly treat a real marker as prose to escape.
      if(isFootnoteMarker(run.text)){
        mdf += '[^' + run.text.footnote.n + ']';
        atStartOfText = false;
        onlyIndentSoFar = false;
        lastTextWritten = ']';
      }
      else{
        mdf += escapeAnyMarkers(text, {
          atLineStart: atStartOfText && lineMarker === '',
          atBlockPosition: atStartOfText && !blockMarkerWritten,
          atListPosition: onlyIndentSoFar && !blockMarkerWritten,
          //Indent is still a position an escape is read at, so the wider table applies behind one.
          atTextStart: onlyIndentSoFar,
          somethingFollows: following !== '',
          precededBy: styleMarkers !== '' ? styleMarkers : lastTextWritten,
          followedBy: following
        });

        atStartOfText = false;
        if(/[^\t ]/.test(text))
          onlyIndentSoFar = false;
        lastTextWritten = text;
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

//Every asterisk is a marker wherever it falls - tokenizeInline toggles italic on a run of one, bold
//on two and both on three - so there is no position where a bare one is ordinary text. Escaped one
//character at a time, like every escape now; see the note on ESCAPABLE_ANYWHERE.
const INLINE_ASTERISK = /\*/g;

//"_" and "~" are markers only in pairs, so a lone one is ordinary text and keeps "snake_case" and
//"~1900" spelled as themselves. One is escaped only where it would land in a run of two or more
//once the line is assembled - beside another in the run's own text, or against the "__" or "~~" of
//a style marker written directly before or after it, which is what turned an underlined "_" into a
//plain one and moved "file_" into the underline beside it.
const PAIRED_MARKER_CHARS = ['_', '~'];

//A footnote reference is read anywhere too, but only in the one shape FOOTNOTE_REF_MARKER accepts:
//"[^", digits, "]". A bare "[^" is ordinary prose, so escaping the two characters wherever they
//appeared put a backslash in front of "[^note]" and every other bracket that happened to be
//followed by a caret. The lookahead keeps the escape on the marker itself.
const FOOTNOTE_REF_START = /\[\^(?=\d+\])/g;

//These three are not inline. parseLine reads alignment, blockquote and heading with ^-anchored
//regexes, so "#", ">" and "[>" are ordinary characters everywhere except the one position each is
//read at - and escaping them everywhere put a backslash into the file for nothing, which is what
//"File \> Dictionaries" was. Only the first character of a run needs it: a marker is recognised by
//its opening character, so "\## head" and "\>> quote" both read back whole.
//
//Position is not the whole of it either. BLOCKQUOTE_MARKER takes any run of ">" with or without a
//space after it, so a leading ">" is always a marker and always needs the escape. The other two are
//narrower than the character they open with: ALIGN_MARKER needs one of the four letters and "] ",
//HEADER_MARKER needs one to four "#" and a space. Matching only the opening character escaped
//"#hashtag", "##### deep" and "[>x] " for nothing, each of which parseLine reads straight back as
//the prose it is.
const ALIGN_MARKER_START = /^\[>(?=[lrcj]\] )/;
const BLOCKQUOTE_MARKER_START = /^>/;
const HEADER_MARKER_START = /^#(?=#{0,3} )/;

//`position` says where in the line parseLine will be looking when it reaches this run, which is what
//decides whether a leading marker character has to be escaped:
//
//- atLineStart: nothing at all precedes this text on the line. ALIGN_MARKER is matched against the
//  raw line, so that is the only place a "[>" can be read as one.
//- atBlockPosition: nothing precedes this text except an alignment or footnote-body marker, both of
//  which parseLine strips before it looks for a list, blockquote or heading. A block marker of the
//  line's own means there is nothing left to look for - parseLine has already consumed it, and
//  returns early for a list or a quotation - so text behind one needs no escaping at all.
//- atTextStart: nothing precedes this text in what tokenizeInline will be handed. That is a wider
//  position than atBlockPosition - a line carrying a block marker of its own still has a first
//  character, and consumeEscape reads an escape there - so it is what the backslash pass goes by.
//- somethingFollows: whether anything at all comes after this text on the line. See backslashIsRead.
//- precededBy, followedBy: the style markers written immediately before and after this text, which
//  is what an "_" or "~" at either edge could pair with. See escapePairedMarkerChars.
//
//The passes run in this order because each one reads the text the one before it produced: the
//backslash pass has to see the writer's own text, and the paired-character pass has to see the
//escapes already inserted, since a backslash between two underscores is what keeps them apart.
function escapeAnyMarkers(text, position){
  text = escapeBackslashes(text, position);

  text = text.replace(INLINE_ASTERISK, '\\$&');
  text = escapePairedMarkerChars(text, position);
  text = text.replace(FOOTNOTE_REF_START, '\\$&');

  if(position.atLineStart)
    text = escapeBlockMarker(text, position.followedBy, ALIGN_MARKER_START);

  if(position.atBlockPosition){
    text = escapeBlockMarker(text, position.followedBy, BLOCKQUOTE_MARKER_START);
    text = escapeBlockMarker(text, position.followedBy, HEADER_MARKER_START);
  }

  //Separate from atBlockPosition because LIST_MARKER reads its marker after indent while
  //BLOCKQUOTE_MARKER and HEADER_MARKER tolerate none - so where a line opens with whitespace, a
  //list escape is still needed and the other two are not.
  if(position.atListPosition)
    text = escapeListMarkers(text, position.followedBy);

  return text;
}

//A marker does not have to sit inside one run. parseLine reads the assembled line, so "[>c]" and
//" 1." - two runs, neither a marker on its own - are an alignment marker once they are written out
//next to each other, and a paragraph beginning that way came back centered with its text eaten.
//Each of these is matched against this run's text plus whatever follows it on the line, while the
//backslash still goes in front of the marker's own first character, which is in this text: all
//three patterns are anchored at the start of the probe, and that is this text's start.
function escapeBlockMarker(text, following, pattern){
  return pattern.test(text + following) ? '\\' + text : text;
}

//The string this run's text will sit directly against on the line: the style markers opening the
//next run, or where those are empty the next run's own text, looked past any run that writes
//nothing. Returns '' only at the end of a line, where nothing follows but the terminator.
//
//Raw text rather than escaped, which can only ever make a caller escape one character it need not
//have - a "~" answering to a "~" that turns out to have been escaped itself. That costs a backslash
//and reads back the same; missing a pair would cost the text.
function emissionAfter(textRuns, i, styles){
  var from = styles;

  for(let n = i + 1; n < textRuns.length; n++){
    var next = activeStyles(textRuns[n].attributes);
    var markers = markersBetween(from, next);

    if(markers !== '')
      return markers;

    if(isFootnoteMarker(textRuns[n].text))
      return '[^';

    if(typeof textRuns[n].text === 'string' && textRuns[n].text.length > 0)
      return textRuns[n].text;

    from = next;
  }

  return markersBetween(from, activeStyles(null));
}

//An "_" or "~" of the writer's own, escaped only where the assembled line would put it in a run of
//two and so make it a marker. Reads the text the passes above have already escaped, so a backslash
//sitting between two of them is seen for what it is - "_\*_" leaves both underscores alone, because
//in the file they are not next to each other.
function escapePairedMarkerChars(text, position){
  var out = '';

  for(let i = 0; i < text.length; i++){
    if(PAIRED_MARKER_CHARS.indexOf(text[i]) !== -1 && joinsAMarkerRun(text, i, position))
      out += '\\';

    out += text[i];
  }

  return out;
}

function joinsAMarkerRun(text, i, position){
  var ch = text[i];

  if(text[i - 1] === ch || text[i + 1] === ch)
    return true;

  if(i === 0 && position.precededBy.slice(-1) === ch)
    return true;

  if(i === text.length - 1 && position.followedBy.charAt(0) === ch)
    return true;

  return false;
}

//A backslash of the writer's own, doubled wherever consumeEscape would otherwise read it as an
//escape and take it off - which is what happened to a paragraph opening "\#head" or ending in a
//backslash right before a style marker. Everywhere else it is left exactly as typed, so a Windows
//path or a lone backslash mid-sentence still reads back as one character and still spells as one
//on disk.
//
//Runs before the marker escaping above rather than after it, so it sees the text the writer typed
//instead of the backslashes that pass inserts - it has to double its own backslash in front of one
//of those too, since a backslash is itself escapable now.
function escapeBackslashes(text, position){
  if(text.indexOf('\\') === -1)
    return text;

  var out = '';

  for(let i = 0; i < text.length; i++){
    if(text[i] === '\\' && backslashIsRead(text, i, position))
      out += '\\';

    out += text[i];
  }

  return out;
}

//Asking the reader's question rather than the writer's, which is what makes this cover both the
//markers escapeAnyMarkers is about to escape and the ones it deliberately leaves alone: every
//sequence the writer escapes is one of the patterns escapePatternsAt returns, but not the other way
//round - "\[^note]" carries no marker for the writer, and consumeEscape still reads the backslash
//off it.
//
//A backslash at the very end of the text is judged on whether anything follows it on the line at
//all. What can follow is a style marker, a footnote reference, or the escape in front of the next
//run's text, and consumeEscape reads a backslash off every one of those; only a line ending is
//safe. Being the last run with no style left to close is the one case that needs no backslash.
function backslashIsRead(text, i, position){
  if(i === text.length - 1)
    return position.somethingFollows;

  //Probed against what follows on the line, not just the rest of this run: the longest of these
  //patterns is three characters, so a backslash near the end of a run can be sitting in front of a
  //marker that the next run finishes - "\1" and ". item" is an escaped list marker between them,
  //and the backslash was being left single and eaten on the way back.
  var tail = text.slice(i + 1) + position.followedBy;

  return escapePatternsAt(text, i, position.atTextStart).some(function(pattern){
    return pattern.test(tail);
  });
}

//Escaped after any indent, tabs or spaces, and without regard to what the paragraph above was.
//parseLine only reads a space-indented marker as a list when a list item precedes it, but escaping
//only in that case would mean a paragraph's spelling on disk depended on its neighbour - so a
//paragraph edited above it could change how this one reads. Escaping always costs a backslash and
//makes the line mean the same thing wherever it lands.
//Matched against this text plus what follows it on the line, for the same reason escapeBlockMarker
//is: "1." and " item" are two runs and one list marker between them.
const LIST_MARKER_START = /^([\t ]*)(-|\*|\+|(?:\d+|[a-z])\.) /;

function escapeListMarkers(text, following){
  var marker = LIST_MARKER_START.exec(text + following);

  if(!marker)
    return text;

  var at = marker[1].length;

  //Only the indent is in this run and the marker itself begins in the next one, which will put the
  //backslash in front of it when its own turn comes - there is nothing of it here to escape.
  if(at >= text.length)
    return text;

  return text.slice(0, at) + '\\' + text.slice(at);
}

module.exports = {
  parseMDF,
  convertDeltaToMDF,
  tokenizeInline
};