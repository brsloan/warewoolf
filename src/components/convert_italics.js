function convertMarkedItalicsForAllChapters(marker){
  project.chapters.forEach(function(chap){
    var result = convertMarkedItalics(chap.contents ? chap.contents : chap.getFile(), marker);
    if(result.changed > 0){
      chap.contents = result.delta;
      chap.hasUnsavedChanges = true;
    }
  });
}

function convertMarkedItalics(delt, marker){
  marker = marker.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
  var italRegx = new RegExp(marker + '([^' + marker + ']+)' + marker);

  var tempQuill = getTempQuill();
  tempQuill.setContents(delt);
  var text = tempQuill.getText();

  var foundIndex = 0;
  var startingIndex = 0;
  var matchResult;
  var markedText = "";
  var counter = 0;

  while(foundIndex > -1){

      matchResult = text.match(italRegx);
      foundIndex = matchResult ? matchResult.index : -1;

      if(foundIndex > -1){
          counter++;

          tempQuill.deleteText(foundIndex, matchResult[0].length);
          tempQuill.insertText(foundIndex, matchResult[1]);
          tempQuill.formatText(matchResult.index, matchResult[1].length, 'italic', true);
          startingIndex = foundIndex + matchResult[1].length;
          text = tempQuill.getText();
      }
  }

  return {
    changed: counter,
    delta: tempQuill.getContents()
  }
}
