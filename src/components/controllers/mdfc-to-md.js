

function convertMdfcToMd(mdfText){
    const alignmentMarker = /\[>.\] ?/gm;
    const tabsAtStartOfLine = /^\t+/gm;
  
    var converted = mdfText.replaceAll(alignmentMarker,'');
    converted = converted.replaceAll('\n\n\t','\n\n');
    converted = converted.replaceAll('\n\t','\n\n');
    converted = converted.replace(tabsAtStartOfLine, '');
    
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

    uniqueMarkers.forEach(function(val,i,arr){
        const footnoteMarkerWithSpace = /^\[\^\d+\]: ?/gm;
        const thisFootnoteParas = new RegExp('^' + escapeRegExp(val) + ' ?(.*)\n?', 'gm');
        var fnMatches = text.match(thisFootnoteParas);

        var indexCounter = text.indexOf(fnMatches[0]) + fnMatches[0].length;
        
        for(i=1;i<fnMatches.length;i++){
            //remove secondary paras from original text
            text = text.replace(fnMatches[i], '');

            //remove marker 
            fnMatches[i] = fnMatches[i].replace(footnoteMarkerWithSpace, '');

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
}

function escapeRegExp(string) {
  const specialCharacters = /[.*+?^${}()|[\]\\]/g; 
  return string.replace(specialCharacters, '\\$&');
}

  module.exports = {
    convertMdfcToMd
  };