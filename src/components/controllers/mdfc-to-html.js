const { tokenizeInline } = require('./markdownFic');

function convertMdfcToHtml(str){
    str = convertWindowsToLinuxLineEndings(str);

    //These use (.*) rather than (.+) to match markdownFic.js: a blank line that carries a heading
    //or alignment attribute is written out as a bare marker with no text after it, and it still
    //has to be recognised here or the marker itself leaks into the exported HTML.
    let header1 = /^# (.*)/gm;
    let header2 = /^## (.*)/gm;
    let header3 = /^### (.*)/gm;
    let header4 = /^#### (.*)/gm;
    let centeredHeader1 = /^\[>c] # (.*)/gm
    let centeredHeader2 = /^\[>c] ## (.*)/gm
    let centeredHeader3 = /^\[>c] ### (.*)/gm
    let centeredHeader4 = /^\[>c] #### (.*)/gm
    let rightHeader1 = /^\[>r] # (.*)/gm
    let rightHeader2 = /^\[>r] ## (.*)/gm
    let rightHeader3 = /^\[>r] ### (.*)/gm
    let rightHeader4 = /^\[>r] #### (.*)/gm
  
    let unorderedListHtml = /((?:(?:<li|<ul) class="ul.*(?:<\/li>|<\/ul>)\n)+)/g;
    let unorderedListHtmlLvl2 = /((?:(?:<li|<ul) class="ul (?:ul-two|ul-three).*(?:<\/li>|<\/ul>)\n)+)/g;
    let unorderedListHtmlLvl3 = /((?:(?:<li|<ul) class="ul ul-three".*(?:<\/li>|<\/ul>)\n)+)/g;
    let orderedListHtml = /((?:(?:<li|<ol) class="ol.*(?:<\/li>|<\/ol>)\n)+)/g
    let orderedListHtmlLvl2 = /((?:(?:<li|<ol) class="ol (?:ol-two|ol-three).*(?:<\/li>|<\/ol>)\n)+)/g;
    let orderedListHtmlLvl3 = /((?:(?:<li|<ol) class="ol ol-three".*(?:<\/li>|<\/ol>)\n)+)/g;
    //The ul/ol classes are temporary - they exist only so the whole-list detection above can tell
    //ordered items from unordered ones - but an alignment class written alongside them is not, so the
    //grouping tokens are named exactly and any alignment that follows them is handed back to the
    //replacement to keep. Spelling the tokens out also stops the match at the closing quote of the
    //class attribute; a greedy .* ran on to the last quote on the line, which swallowed the item's
    //text whenever it contained dialogue.
    let tempClasses = / class="(?:ul|ol)(?: (?:ul|ol)-(?:two|three))?(?: (left|right|center|justified))?"/g;

    //An alignment marker is the outermost thing on a line and combines with the block marker after
    //it (see parseLine in markdownFic.js), so every list and blockquote shape below reads an optional
    //one off the front and renders it as the same class the aligned <p> shapes use.
    let listUnordered = /^(?:\[>([lrcj])\] )?(?:-|\*|\+) (.*)/gm;
    let listUnorderedTwo = /^(?:\[>([lrcj])\] )?(\t)(?:-|\*|\+) (.*)/gm;
    let listUnorderedThreePlus = /^(?:\[>([lrcj])\] )?(\t){2,}(?:-|\*|\+) (.*)/gm;
    let listOrdered = /^(?:\[>([lrcj])\] )?((?:\d+|[a-z])\.) (.*)/gm;
    let listOrderedTwo = /^(?:\[>([lrcj])\] )?(\t)((?:\d+|[a-z])\.) (.*)/gm;
    let listOrderedThreePlus = /^(?:\[>([lrcj])\] )?(\t){2,}((?:\d+|[a-z])\.) (.*)/gm;
    //(.*) rather than (.+), matching the header/alignment markers above, so a bare ">" marker with
    //no text after it (a blank blockquote line) produces an empty element instead of either leaking
    //the literal ">" into the output or capturing a stray space as its content.
    let blockquote = /^(?:\[>([lrcj])\] )?>+ ?(.*)/gm;
    let alignLeft = /^\[>l] (.*)/gm;
    let alignRight = /^\[>r] (.*)/gm;
    let alignCenter = /^\[>c] (.*)/gm;
    let alignJustified = /^\[>j] (.*)/gm;
    let normal = /^(?!<)(.+)/gm;
    let blankLines = /(?:\r?\n){2,}/gm;
  
    str = convertFootnotes(str);
    //Must do references AFTER footnotes themselves to avoid replacing footnote markers
    str = convertFootnoteReferences(str);
  

    //Assign class to assist in discriminating between ordered and UL list items in whole list detection
    str = str.replace(listUnorderedThreePlus, function(match, align, tab, text){ return listItem('ul ul-three', align, text); });
    str = str.replace(listUnorderedTwo, function(match, align, tab, text){ return listItem('ul ul-two', align, text); });
    str = str.replace(listUnordered, function(match, align, text){ return listItem('ul', align, text); });
    str = str.replace(listOrderedThreePlus, function(match, align, tab, marker, text){ return listItem('ol ol-three', align, text); });
    str = str.replace(listOrderedTwo, function(match, align, tab, marker, text){ return listItem('ol ol-two', align, text); });
    str = str.replace(listOrdered, function(match, align, marker, text){ return listItem('ol', align, text); });


    str = str.replace(centeredHeader1, '<h1 class="center">$1</h1>');
    str = str.replace(centeredHeader2, '<h2 class="center">$1</h2>');
    str = str.replace(centeredHeader3, '<h3 class="center">$1</h3>');
    str = str.replace(centeredHeader4, '<h4 class="center">$1</h4>');
    str = str.replace(rightHeader1, '<h1 class="right">$1</h1>');
    str = str.replace(rightHeader2, '<h2 class="right">$1</h2>');
    str = str.replace(rightHeader3, '<h3 class="right">$1</h3>');
    str = str.replace(rightHeader4, '<h4 class="right">$1</h4>');
    str = str.replace(header1, '<h1>$1</h1>');
    str = str.replace(header2, '<h2>$1</h2>');
    str = str.replace(header3, '<h3>$1</h3>');
    str = str.replace(header4, '<h4>$1</h4>');
    //Ahead of the four alignment-only shapes below, which would otherwise claim an aligned quote
    //("[>c] > Quoted") for a centered <p> whose text began with a stray ">".
    str = str.replace(blockquote, function(match, align, text){
      return '<blockquote' + alignClass(align) + '>' + text + '</blockquote>';
    });
    str = str.replace(alignLeft, '<p class="left">$1</p>');
    str = str.replace(alignRight, '<p class="right">$1</p>');
    str = str.replace(alignCenter, '<p class="center">$1</p>');
    str = str.replace(alignJustified, '<p class="justified">$1</p>');
    str = str.replace(normal, '<p>$1</p>');
    str = str.replace(blankLines, '\n<br/>\n');

    //Now add outer list tags for entire lists
    str = str.replace(unorderedListHtml, '<ul>$1</ul>\n');
    str = str.replace(orderedListHtml, '<ol>$1</ol>\n');
    str = str.replace(unorderedListHtmlLvl2, '<ul>$1</ul>\n');
    str = str.replace(unorderedListHtmlLvl3, '<ul>$1</ul>\n');
    str = str.replace(orderedListHtmlLvl2, '<ol>$1</ol>\n');
    str = str.replace(orderedListHtmlLvl3, '<ol>$1</ol>\n');

    //Clean up temp classes used for grouping lists, keeping any alignment class written with them
    str = str.replace(tempClasses, function(match, align){
      return align ? ' class="' + align + '"' : '';
    });

  
    //Bold/italic/underline/strike share tokenizeInline with the MDF writer (markdownFic.js) rather
    //than being matched as four independent regexes. Independent regexes can't correctly handle
    //markers nested inside a *different* style that reuses the same character (e.g. italic inside
    //bold, since both use "*"): the outer marker's exclusion class can't span the inner marker, so
    //the whole outer span fails to match and its asterisks leak into the output as literal text.
    str = convertInlineStyles(str);

    //Bold/italic/underline/strike escapes (\**, \*, \~~, \__) are already stripped by
    //convertInlineStyles above, via tokenizeInline. This handles what's left: headings, alignment/
    //blockquote markers and list markers.
    //
    //An escape only means anything where the marker itself would have been read, exactly as in
    //consumeEscape (markdownFic.js) - "a \> b" is a backslash followed by a greater-than sign, not
    //an escaped quotation marker. By this point in the conversion, the start of a line has become
    //the start of an element's text, so that is where the escape is honoured. A list marker is
    //honoured after indent as well, since LIST_MARKER reads one there.
    const elementStart = '(<(?:p|h[1-4]|li|blockquote)(?:\\s[^>]*)?>';

    let escapedBlockMarkers = new RegExp(elementStart + ')\\\\(#|\\[>|>)', 'g');
    str = str.replace(escapedBlockMarkers, '$1$2');

    let escapedListMarkers = new RegExp(elementStart + '[\\t ]*)\\\\(-|\\+|(?:\\d+|[a-z])\\. )', 'g');
    str = str.replace(escapedListMarkers, '$1$2');
  
    return str;
  }

//The class each alignment marker renders as. "justified" rather than "justify" because that is the
//class the aligned <p> shapes have always used, and the stylesheets are written against it.
const ALIGN_CLASSES = { l: 'left', r: 'right', c: 'center', j: 'justified' };

//`marker` is the letter captured from an optional "[>x] " prefix, and is undefined when the line
//carried no alignment - in which case the element gets no class attribute at all, exactly as before.
function alignClass(marker){
  return marker ? ' class="' + ALIGN_CLASSES[marker] + '"' : '';
}

//A list item's alignment rides along in the same class attribute as the temporary ul/ol grouping
//token, since an element gets only one. tempClasses strips the grouping half back off once the
//whole-list detection has run, leaving the alignment behind.
function listItem(groupingClasses, alignMarker, text){
  var alignment = alignMarker ? ' ' + ALIGN_CLASSES[alignMarker] : '';
  return '<li class="' + groupingClasses + alignment + '">' + text + '</li>';
}

const INLINE_STYLE_TAGS = { bold: 'b', italic: 'i', underline: 'u', strike: 'del' };
const INLINE_STYLE_ORDER = ['bold', 'italic', 'underline', 'strike'];

function inlineStyleSet(attributes){
  var styles = { bold: false, italic: false, underline: false, strike: false };
  if(attributes){
    INLINE_STYLE_ORDER.forEach(function(name){
      styles[name] = Boolean(attributes[name]);
    });
  }
  return styles;
}

//Converts tokenizeInline's runs into HTML, always opening tags outermost-to-innermost in
//INLINE_STYLE_ORDER and closing in reverse. A style that stays active across a run boundary is left
//untouched, but when an outer style (say bold) closes while an inner one opened after it (italic)
//stays active, every style from that divergence point in, including the ones still active, is
//closed and then reopened - otherwise the tags would cross (e.g. "<b>...<i>...</b>...</i>"), which
//is not valid HTML nesting.
function styleTransition(from, to){
  var divergeAt = INLINE_STYLE_ORDER.findIndex(function(name){ return from[name] !== to[name]; });
  if(divergeAt === -1)
    return '';

  var out = '';
  for(let i = INLINE_STYLE_ORDER.length - 1; i >= divergeAt; i--){
    let name = INLINE_STYLE_ORDER[i];
    if(from[name])
      out += '</' + INLINE_STYLE_TAGS[name] + '>';
  }
  for(let i = divergeAt; i < INLINE_STYLE_ORDER.length; i++){
    let name = INLINE_STYLE_ORDER[i];
    if(to[name])
      out += '<' + INLINE_STYLE_TAGS[name] + '>';
  }
  return out;
}

function convertInlineStyles(str){
  var runs = tokenizeInline(str);
  var out = '';
  var openStyles = inlineStyleSet(null);

  runs.forEach(function(run){
    var styles = inlineStyleSet(run.attributes);
    out += styleTransition(openStyles, styles);
    out += run.text;
    openStyles = styles;
  });

  out += styleTransition(openStyles, inlineStyleSet(null));

  return out;
}

//A backslash before the marker escapes it, the same as anywhere else a marker is read - and a
//footnote reference is read anywhere in a line, so its escape is honoured anywhere (consumeEscape
//in markdownFic.js). Without the guard the marker was converted regardless, so "\[^1]" typed as
//prose came out as a real footnote link with the backslash still sitting in front of it, while the
//editor showed the literal "[^1]" it was written to mean.
//
//The escaped marker is left as it stands. convertInlineStyles runs tokenizeInline over the result
//further down, and that takes the backslash off, exactly as it does for an escaped "*" or "~~".
function convertFootnoteReferences(text){
    const footnoteRefMarker = /(\\)?\[\^(\d+)\]/gm;

    text = text.replace(footnoteRefMarker, function(match, escape, number){
      if(escape)
        return match;

      return '<sup><a href="#fnote_' + number + '" id="fnoteRef_' + number + '">' + number + '</a></sup>';
    });

    return text;
}

function convertFootnotes(text){
    const footnoteMarker = /^\[\^\d+\]:/gm;

    var allMarkers = text.match(footnoteMarker);

    //Every footnote needs its div, not just the ones written across several paragraphs. Without it
    //there is no #fnote_N for the reference in the body to link to, and the definition line falls
    //through to convertFootnoteReferences, which turns it into a second element carrying the same
    //id as the reference itself.
    if(allMarkers && allMarkers.length > 0){
        text = consolidateFootnotes(text, allMarkers);
    }
    return text;
}

function consolidateFootnotes(text, allMarkers){
    var uniqueMarkers = [...new Set(allMarkers)];

    uniqueMarkers.forEach(function(val,i,arr){
        const footnoteMarkerWithSpace = /^\[\^(\d+)\]: ?/gm;
        const thisFootnoteParas = new RegExp('^' + escapeRegExp(val) + ' ?(.*)\n?', 'gm');
        var fnMatches = text.match(thisFootnoteParas);
        
        //Give footnote div ID using original ID in markdown tag, sanitized
        const footnoteTagOpen = '<div class="footnote" id="fnote_' + footnoteMarkerWithSpace.exec(fnMatches[0])[1] + '">';
        const footnoteTagClose = '</div>';

        const footnoteInsertPoint = text.indexOf(fnMatches[0]);

        //Insert opening and closing tag just before first footnote parker
        text = text.slice(0,footnoteInsertPoint) + footnoteTagOpen + footnoteTagClose + '\n' + text.slice(footnoteInsertPoint);

        var indexCounter = footnoteInsertPoint + footnoteTagOpen.length;
        
        for(i=0;i<fnMatches.length;i++){
            //remove secondary paras from original text
            text = text.replace(fnMatches[i], '');

            if(i==0)
                fnMatches[i] = '<p>' + fnMatches[i].replace(footnoteMarkerWithSpace, '<sup><a href="#fnoteRef_$1">$1</a></sup>') + '</p>';
            //remove marker for additional paragraphs
            if(i > 0)
                fnMatches[i] = '<p>' + fnMatches[i].replace(footnoteMarkerWithSpace, '') + '</p>';

            //add to this footnote div
            text = text.slice(0,indexCounter) + fnMatches[i] + text.slice(indexCounter);
            indexCounter += fnMatches[i].length;
        }
    });

    return text;
}

function convertMdfcToHtmlPage(text, title, author = null, insertTitle = false){
    var titleElements = '';
    if(insertTitle){
        titleElements = '<h1 class="center">' + title + '<h1>';
        if(author)
            titleElements += '<h2 class="center">by ' + author + '</h2>';
        titleElements += '<br/>';
    }
        

    var htmlTemplate = getHtmlTemplate();
    htmlTemplate = htmlTemplate.replace('<!-- title -->', title);
    htmlTemplate = htmlTemplate.replace('<!-- page content -->', titleElements + convertMdfcToHtml(text));
  
    return htmlTemplate;
  }
  
  function getHtmlTemplate(){
    return "<!DOCTYPE html>" +
      "<html lang=\"en\">" +
      "  <head>" +
      "    <meta charset=\"utf-8\">" +
      "    <title><!-- title --></title>" +
      "    <style>" +
      "      h1 {" +
      "        white-space: pre-wrap;" +
      "      }" +
      "    p {" +
      "      white-space: pre-wrap;" +
      "      margin-top: 0px;" +
      "      margin-bottom: 0px;" +
      "    }" +
      "    .center {" +
      "      text-align: center;" +
      "    }" +
      "    .right {" +
      "      text-align: right;" +
      "    }" +
      "    .justified {" +
      "      text-align: justify;" +
      "    } " +
      "    blockquote {" +
      "      white-space: pre-wrap;" +
      "      margin-top: 0px;" +
      "      margin-bottom: 0px;" +
      "    }" +
      "    .footnote {" +
      "      text-indent: 1em;" +
      "    }" +
      "    .footnote p:nth-child(1n+2) {" +
      "      text-indent: 2em;" +
      "    }" +
      "    sup {" +
      "      margin-right: 0.25em;" +
      "    }" +
      "    </style>" +
      "  </head>" +
      "  <body>" +
      "    <!-- page content -->" +
      "  </body>" +
      "</html>";
  }

function escapeRegExp(string) {
  const specialCharacters = /[.*+?^${}()|[\]\\]/g; 
  return string.replace(specialCharacters, '\\$&');
}

function convertWindowsToLinuxLineEndings(text) {
    // Replace all occurrences of '\r\n' with '\n'
    return text.replace(/\r\n/g, '\n');
  }

module.exports = {
    convertMdfcToHtml,
    convertMdfcToHtmlPage
};