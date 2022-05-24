function breakHeadingsIntoChapters(headingLevel = 1){
  var totalText = editorQuill.getText();
  var onHeader = false;
  var headerIndices = [];


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

  console.log(headerIndices);


  if(headerIndices.length > 0){
    var generatedChaps = [];

    //Add beginning fragment if it does not begin with a heading
    if(headerIndices[0] != 0)
      generatedChaps.push(editorQuill.getContents(0, headerIndices[0]));
    //Add middle chapters
    for(let i = 0; i < headerIndices.length - 1; i++){
      var chapLength = headerIndices[i + 1] - headerIndices[i];
      generatedChaps.push(editorQuill.getContents(headerIndices[i], chapLength));
    }
    //Add last chapter from index to end of delta
    generatedChaps.push(editorQuill.getContents(headerIndices[headerIndices.length - 1]))

    editorQuill.setContents(generatedChaps.shift(), "user");
    generatedChaps.forEach(function(chap){
      const titleCharacterLimit = 100;
      addImportedChapter(chap, chap.ops[0].insert.slice(0,titleCharacterLimit));
    });
  }

}
