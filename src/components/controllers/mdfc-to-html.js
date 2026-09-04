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
    //[^"]* rather than .* so the match stops at the closing quote of the class attribute. A greedy
    //.* runs on to the last quote on the line, which swallows the item's text whenever it contains
    //dialogue.
    let tempClasses = / class="(?:ol|ul)[^"]*"/g;

    let listUnordered = /^(?:-|\*|\+) (.*)/gm; 
    let listUnorderedTwo = /^(\t)(?:-|\*|\+) (.*)/gm;
    let listUnorderedThreePlus = /^(\t){2,}(?:-|\*|\+) (.*)/gm;
    let listOrdered = /^((?:\d+|[a-z])\.) (.*)/gm;
    let listOrderedTwo = /^(\t)((?:\d+|[a-z])\.) (.*)/gm;
    let listOrderedThreePlus = /^(\t){2,}((?:\d+|[a-z])\.) (.*)/gm;
    let blockquote = /^>+ {0,1}(.+)/gm;
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
    str = str.replace(listUnorderedThreePlus, '<li class="ul ul-three">$2</li>');
    str = str.replace(listUnorderedTwo, '<li class="ul ul-two">$2</li>');
    str = str.replace(listUnordered, '<li class="ul">$1</li>');
    str = str.replace(listOrderedThreePlus, '<li class="ol ol-three">$3</li>');
    str = str.replace(listOrderedTwo, '<li class="ol ol-two">$3</li>');
    str = str.replace(listOrdered, '<li class="ol">$2</li>');
    

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
    str = str.replace(alignLeft, '<p class="left">$1</p>');
    str = str.replace(alignRight, '<p class="right">$1</p>');
    str = str.replace(alignCenter, '<p class="center">$1</p>');
    str = str.replace(alignJustified, '<p class="justified">$1</p>');
    str = str.replace(blockquote, '<blockquote>$1</blockquote>');
    str = str.replace(normal, '<p>$1</p>');
    str = str.replace(blankLines, '\n<br/>\n');

    //Now add outer list tags for entire lists
    str = str.replace(unorderedListHtml, '<ul>$1</ul>\n');
    str = str.replace(orderedListHtml, '<ol>$1</ol>\n');
    str = str.replace(unorderedListHtmlLvl2, '<ul>$1</ul>\n');
    str = str.replace(unorderedListHtmlLvl3, '<ul>$1</ul>\n');
    str = str.replace(orderedListHtmlLvl2, '<ol>$1</ol>\n');
    str = str.replace(orderedListHtmlLvl3, '<ol>$1</ol>\n');

    //Clean up temp classes used for grouping lists
    str = str.replace(tempClasses, '');

  
    let bold = /(?<!\\|\\\*\*)\*\*([^\*\*]+)\*\*/g;
    let italic = /(?<!\\|\\\*)\*([^\*]+)\*/g;
    let underline = /(?<!\\|\\__)__([^__]+)__/g;
    let strike = /(?<!\\|\\~~)~~([^~~]+)~~/g;
  
    str = str.replace(bold, '<b>$1</b>');
    str = str.replace(italic, '<i>$1</i>');
    str = str.replace(underline, '<u>$1</u>');
    str = str.replace(strike, '<del>$1</del>');
  
    //List markers are in this set to match markdownFic.js. Without them a line of prose that
    //happens to open with "- " or "1984. " keeps the backslash it was escaped with.
    let escapedMarkers = /\\(\*\*|\*|~~|__|#|\[>|>|\[\^|-|\+|(?:\d+|[a-z])\. )/g;
    str = str.replace(escapedMarkers, '$1');
  
    return str;
  }
  
function convertFootnoteReferences(text){
    const footnoteRefMarker = /\[\^(\d+)\]/gm;
    text = text.replace(footnoteRefMarker, '<sup><a href="#fnote_$1" id="fnoteRef_$1">$1</a></sup>');
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