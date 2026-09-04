

function convertMdfcToMd(mdfText){
    mdfText = convertWindowsToLinuxLineEndings(mdfText);

    const alignmentMarker = /\[>.\] ?/gm;
    //regex below looks for paragraphs that begin with a tab but are not list items, and it includes 1 to 2 newlines before the indented
    //paragaph so that any matches can be replaced with two new lines, which will standardize paragraphs to have 1 empty line between them
    //for markdown. (If only one one newline, it will add one during the replace. If two, it stays at two.)
    //The leading ^ alternative catches the first paragraph of a chapter, which has no newline in
    //front of it to consume and so would otherwise keep its indenting tab.
    const indentedParas = /(?:^|\n{1,2})\t(?!(\t*(?:\d+|[a-z])\. )|(\t*(?:-|\*|\+) ))/g;

    var converted = mdfText.replaceAll(alignmentMarker,'');
    converted = converted.replace(indentedParas, function(match){
      //Nothing to separate the first paragraph from, so it just loses the tab.
      return match.startsWith('\n') ? '\n\n' : '';
    });

    converted = convertFootnotes(converted); 
  
    return converted;
  }

  function convertFootnotes(text){
    const footnoteMarker = /^\[\^\d+\]:/gm;

    var allMarkers = text.match(footnoteMarker);

    if(checkIfDuplicateExists(allMarkers)){
        text = consolidateMultiParaFootnotes(text, allMarkers);
    }
    return text;
}

function consolidateMultiParaFootnotes(text, allMarkers){
    //Different markdown implementations use either a tab or 2-4 spaces to mark additional paragraphs in a multi-paragraph footnote.
    //This can be changed here to alter export to work with different requirements.
    const fnParaMarker = '\t';

    var uniqueMarkers = [...new Set(allMarkers)];

    uniqueMarkers.forEach(function(val){
        const footnoteMarkerWithSpace = /^\[\^\d+\]: ?/gm;
        const thisFootnoteParas = new RegExp('^' + escapeRegExp(val) + ' ?(.*)\n?', 'gm');
        var fnMatches = text.match(thisFootnoteParas);

        var indexCounter = text.indexOf(fnMatches[0]) + fnMatches[0].length;

        for(var i=1;i<fnMatches.length;i++){
            //remove secondary paras from original text
            text = text.replace(fnMatches[i], '');

            //remove marker, plus any indent the source already put after it, so the
            //fnParaMarker we add below doesn't end up stacked on top of a second tab
            fnMatches[i] = fnMatches[i].replace(footnoteMarkerWithSpace, '').replace(/^\t/, '');

            //add to first para of this footnote
            text = text.slice(0,indexCounter) + fnParaMarker + fnMatches[i] + text.slice(indexCounter);
            indexCounter += fnMatches[i].length + fnParaMarker.length;
        }
    });

    return text;
}

function checkIfDuplicateExists(arr) {
    if(arr && arr.length > 0)
        return new Set(arr).size !== arr.length
    return false;
}

function escapeRegExp(string) {
  const specialCharacters = /[.*+?^${}()|[\]\\]/g;
  return string.replace(specialCharacters, '\\$&');
}

function convertWindowsToLinuxLineEndings(text) {
  return text.replace(/\r\n/g, '\n');
}

  module.exports = {
    convertMdfcToMd
  };