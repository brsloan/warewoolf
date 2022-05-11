function convertMarkedItalics(marker){
  //var italRegx = /\*([^\*]+)\*/;
  marker = marker.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
  var italRegx = new RegExp(marker + '([^' + marker + ']+)' + marker);

  var tempQuill = getTempQuill();
  var counter = 0;

  project.chapters.forEach(function(chap){
      var chapContents = chap.contents ? chap.contents : chap.getFile();
      tempQuill.setContents(chapContents);
      var text = tempQuill.getText();

      var foundIndex = 0;
      var startingIndex = 0;
      var matchResult;
      var markedText = "";

      while(foundIndex > -1){

          matchResult = text.match(italRegx);
          foundIndex = matchResult ? matchResult.index : -1;

          if(foundIndex > -1){
              counter++;

              tempQuill.deleteText(foundIndex, matchResult[0].length);
              tempQuill.insertText(foundIndex, matchResult[1]);
              tempQuill.formatText(matchResult.index, matchResult[1].length, 'italic', true);
              chap.contents = tempQuill.getContents();
              chap.hasUnsavedChanges = true;
              startingIndex = foundIndex + matchResult[1].length;
              text = tempQuill.getText();
          }
      }
  });

  return counter;


};
