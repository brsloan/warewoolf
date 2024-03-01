function breakHeadingsIntoChapters(headingLevel = 1){

  var headerIndices = getHeaderIndices(editorQuill.getText(), headingLevel);

  if(headerIndices.length > 0){
    var generatedChaps = splitDeltaAtIndices(editorQuill.getContents(), headerIndices);

    editorQuill.setContents(generatedChaps.shift(), "user");
    generatedChaps.forEach(function(chap){
      addImportedChapter(chap, generateChapTitleFromFirstLine(chap));
    });
  }
  hideWorking();
}

function getHeaderIndices(totalText, headingLevel){
  var headerIndices = [];
  var onHeader = false;
  for(let i = 0 ; i < totalText.length; i++){
    var frmt = editorQuill.getFormat(i, 1);

    if(frmt.header && frmt.header == headingLevel){
      if(onHeader == false){
        onHeader = true;
        headerIndices.push(i);
      }
    }
    else {
      onHeader = false;
    }
  }
  return headerIndices;
}
