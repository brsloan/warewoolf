function breakHeadingsIntoChapters(headingLevel = 1){
  var headerIndices = getHeaderIndices(editorQuill.getText(), headingLevel);

  if(headerIndices.length > 0){
    var generatedChaps = splitDeltaAtIndices(editorQuill.getContents(), headerIndices);

    editorQuill.setContents(generatedChaps.shift(), "user");
    generatedChaps.forEach(function(chap){
      addImportedChapter(chap, generateChapTitleFromFirstLine(chap));
    });
  }
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

function splitDeltaAtIndices(delt, splitPoints){
  var generatedChaps = [];
  if (splitPoints.length > 0) {
    var tempQuill = getTempQuill();
    tempQuill.setContents(delt);

    //Add beginning fragment before first splitPoint
    if(splitPoints[0] != 0)
      generatedChaps.push(tempQuill.getContents(0, splitPoints[0]));
      //Add middle chapters
      for(let i = 0; i < splitPoints.length - 1; i++){
        var chapLength = splitPoints[i + 1] - splitPoints[i];
        generatedChaps.push(tempQuill.getContents(splitPoints[i], chapLength));
      }
      //Add last chapter from index to end of delta
      generatedChaps.push(tempQuill.getContents(splitPoints[splitPoints.length - 1]));
  }

  return generatedChaps;
}

function generateChapTitleFromFirstLine(delt){
    const titleCharacterLimit = 100;
    return delt.ops[0].insert.slice(0,titleCharacterLimit);
}
