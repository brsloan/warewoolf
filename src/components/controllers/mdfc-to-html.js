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

  
    //Heading, alignment/blockquote and list escapes, stripped here rather than by tokenizeInline
    //below: consumeEscape (markdownFic.js) only reads those three at the start of the text it is
    //handed, and by this point in the conversion the start of a line has become the start of an
    //element's text, which is not where tokenizeInline is looking. An escape only means anything
    //where the marker itself would have been read - "a \> b" is a backslash followed by a
    //greater-than sign, not an escaped quotation marker - so element start is where these are
    //honoured, and a list marker after indent as well, since LIST_MARKER reads one there.
    //
    //Ahead of convertInlineStyles, not after it, because an escaped backslash ("\\", the writer's
    //own backslash where the reader would otherwise take it for an escape) is one of the sequences
    //tokenizeInline unwraps. Running that first would turn "\\#head" into "\#head" and leave this
    //pass unable to tell it from an escaped heading marker, stripping a backslash the writer typed.
    //A real "\\" in front of one of these markers fails to match here for the same reason
    //consumeEscape passes it over: the character after the backslash is another backslash.
    const elementStart = '(<(?:p|h[1-4]|li|blockquote)(?:\\s[^>]*)?>';

    let escapedBlockMarkers = new RegExp(elementStart + ')\\\\(#|\\[>|>)', 'g');
    str = str.replace(escapedBlockMarkers, '$1$2');

    let escapedListMarkers = new RegExp(elementStart + '[\\t ]*)\\\\(-|\\+|(?:\\d+|[a-z])\\. )', 'g');
    str = str.replace(escapedListMarkers, '$1$2');

    //Bold/italic/underline/strike share tokenizeInline with the MDF writer (markdownFic.js) rather
    //than being matched as four independent regexes. Independent regexes can't correctly handle
    //markers nested inside a *different* style that reuses the same character (e.g. italic inside
    //bold, since both use "*"): the outer marker's exclusion class can't span the inner marker, so
    //the whole outer span fails to match and its asterisks leak into the output as literal text.
    //It takes the remaining escapes off as it goes - \**, \*, \~~, \__, \[^ and \\.
    str = convertInlineStyles(str);

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

//The measure a page is held to when the writer asks for one: 66 characters, the line length
//typography has long held easiest to read, instead of prose run the full width of a maximised
//browser window. In ch rather than px so the measure is counted in the reader's own font - a ch is
//the width of its "0" - and so holds to 66 characters whatever face and size the page is read at.
const READABLE_MAX_WIDTH = '66ch';

//The rules the "Justify left-aligned text" option writes, exported so epub.js's stylesheet can carry
//the same ones: both stylesheets dress the same converter's output, so the selectors are the same
//either way, and a writer who ticks the box in one format should not get a different page in the
//other.
//
//Only the text the writer never aligned by hand is touched: a bare paragraph, item or quotation,
//and one they explicitly set left. Headings are left out - "Justify left-aligned text" means the
//prose, and a justified heading is a line of stretched-out words.
//
//Two rules rather than one list, written into the stylesheet ahead of .center/.right/.justified,
//so an alignment actually chosen in the editor survives however the reading engine resolves the
//cascade. By the standard, each selector in a list carries its own specificity, so .center (0,1,0)
//would beat a bare "p" (0,0,1) wherever the rule sat - but jsdom, for one, takes a list's
//specificity from its strongest member, which would let a list containing "p.left" (0,1,1)
//outrank .center and justify a centered paragraph. Split in two, the bare-element rule can never
//outrank an alignment class, the ".left" rule only ever matches elements that carry no other
//alignment, and coming first means source order settles it the same way for an engine that
//ignores specificity altogether.
function getJustifyLeftCss(){
  return "      p, li, blockquote {" +
    "        text-align: justify;" +
    "      }" +
    "      p.left, li.left, blockquote.left {" +
    "        text-align: justify;" +
    "      }";
}

function convertMdfcToHtmlPage(text, title, author = null, insertTitle = false, maxWidth = false, justifyLeft = false){
    var titleElements = '';
    if(insertTitle){
        titleElements = '<h1 class="center">' + title + '<h1>';
        if(author)
            titleElements += '<h2 class="center">by ' + author + '</h2>';
        titleElements += '<br/>';
    }
        

    var htmlTemplate = getHtmlTemplate(maxWidth, justifyLeft);
    htmlTemplate = htmlTemplate.replace('<!-- title -->', title);
    htmlTemplate = htmlTemplate.replace('<!-- page content -->', titleElements + convertMdfcToHtml(text));
  
    return htmlTemplate;
  }

  //A compiled novel's PDF page: the same HTML the .html compile writes, with a printed book's
  //stylesheet on top - a serif face at 12pt, double spaced as manuscript format asks, every chapter
  //heading starting a fresh page, and the title page (when asked for) alone on the first. The page
  //size and margins are the printToPdf command's 'book' layout, not this page's.
  //
  //The title page is built here rather than through convertMdfcToHtmlPage's insertTitle, which
  //only stacks the title above chapter one - a book's title wants a page to itself, and some room
  //above it.
  function convertMdfcToPdfPage(text, title, author = null, insertTitle = false, justifyLeft = false){
    var titlePage = '';
    if(insertTitle){
      titlePage = '<div class="title-page"><h1 class="center">' + escapeHtmlText(title) + '</h1>';
      if(author)
        titlePage += '<h2 class="center">by ' + escapeHtmlText(author) + '</h2>';
      titlePage += '</div>';
    }

    //Escaped on the way in: the template writes the title into <title> as-is, ahead of the
    //stylesheet, so a title holding "</style>" would otherwise be what the replace below finds.
    var page = convertMdfcToHtmlPage(text, escapeHtmlText(title), author, false, false, justifyLeft);
    page = page.replace('</style>', getPrintCss() + getRunningHeaderCss(title, author, insertTitle) + '    </style>');
    return page.replace('<body>', '<body>' + titlePage);
  }

  //The manuscript running header - "Surname / Title / 12", top right - on every page but the first,
  //which is the title page or the opening of chapter one and carries none in manuscript format.
  //
  //A CSS page-margin box, not printToPDF's headerTemplate: a template is stamped on every page
  //alike and runs no script, so it cannot leave the first page out. Chromium has drawn @page
  //margin boxes since 131, and with them present it draws no header of its own. The surname is the
  //last word of the author's name; a missing author or title is left out of the line rather than
  //leaving an empty slot between slashes.
  //
  //Numbering starts on the first page of text. A title page, when there is one, does not step the
  //page counter, so the page after it is 1 rather than 2.
  function getRunningHeaderCss(title, author, hasTitlePage){
    var surname = author ? String(author).trim().split(/\s+/).pop() : '';
    var parts = [surname, title ? String(title).trim() : ''].filter(function(part){ return part.length > 0; });
    var lead = parts.length > 0 ? cssString(parts.join(' / ') + ' / ') + ' ' : '';

    return "    @page {" +
      "      @top-right {" +
      "        content: " + lead + "counter(page);" +
      "        font-family: Georgia, \"Times New Roman\", \"Liberation Serif\", \"DejaVu Serif\", serif;" +
      "        font-size: 10pt;" +
      "        vertical-align: bottom;" +
      "        padding-bottom: 0.25in;" +
      "      }" +
      "    }" +
      "    @page :first {" +
      (hasTitlePage ? "      counter-increment: page 0;" : "") +
      "      @top-right {" +
      "        content: none;" +
      "      }" +
      "    }";
  }

  //A CSS string literal. "<" is escaped too: this lands inside a <style> element, where a title
  //containing "</style>" would otherwise end the stylesheet early.
  function cssString(text){
    return '"' + String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/</g, '\\3C ').replace(/[\r\n]+/g, ' ') + '"';
  }

  function getPrintCss(){
    return "    body {" +
      "      font-family: Georgia, \"Times New Roman\", \"Liberation Serif\", \"DejaVu Serif\", serif;" +
      "      font-size: 12pt;" +
      "      line-height: 2;" +
      "      color: black;" +
      "      margin: 0;" +
      "    }" +
      "    h1 {" +
      "      break-before: page;" +
      "      margin-top: 2in;" +
      "      margin-bottom: 0.5in;" +
      "      text-align: center;" +
      "      font-weight: normal;" +
      "    }" +
      "    h1, h2, h3, h4 {" +
      "      break-after: avoid;" +
      "    }" +
      "    p {" +
      "      orphans: 2;" +
      "      widows: 2;" +
      "    }" +
      "    .title-page {" +
      "      break-after: page;" +
      "      padding-top: 3in;" +
      "    }" +
      "    .title-page h1 {" +
      "      break-before: auto;" +
      "      margin-top: 0;" +
      "    }" +
      "    .title-page h2 {" +
      "      font-weight: normal;" +
      "    }" +
      "    a {" +
      "      color: inherit;" +
      "      text-decoration: none;" +
      "    }";
  }

  function escapeHtmlText(text){
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  //An unasked-for page is written exactly as it always was, with no body rule at all, so a file
  //already styled by whatever reads it is not given a width it never had.
  function getHtmlTemplate(maxWidth = false, justifyLeft = false){
    //"margin: 0 auto" rather than a bare max-width: left and right margins of auto share whatever
    //the window has over the measure evenly, so the text block sits in the middle of the page
    //instead of hugging the left edge with all the empty space on one side.
    //
    //The padding is what the zeroed margin would otherwise cost a narrow window: below the measure
    //there is no spare width for "auto" to divide, so the lines would run right up against both
    //edges of a phone or a half-width window - where the browser's own default body margin had
    //always kept a few pixels of gutter. In em, so the gutter scales with the text as the measure
    //itself does.
    var bodyStyle = maxWidth ?
      "      body {" +
      "        max-width: " + READABLE_MAX_WIDTH + ";" +
      "        margin: 0 auto;" +
      "        padding: 0 1em;" +
      "      }" : "";

    return "<!DOCTYPE html>" +
      "<html lang=\"en\">" +
      "  <head>" +
      "    <meta charset=\"utf-8\">" +
      "    <title><!-- title --></title>" +
      "    <style>" +
      bodyStyle +
      "      h1 {" +
      "        white-space: pre-wrap;" +
      "      }" +
      "    p {" +
      "      white-space: pre-wrap;" +
      "      margin-top: 0px;" +
      "      margin-bottom: 0px;" +
      "    }" +
      (justifyLeft ? getJustifyLeftCss() : "") +
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
    convertMdfcToHtmlPage,
    convertMdfcToPdfPage,
    getJustifyLeftCss
};