const { getTempQuill } = require('./quill-utils');

//Indexed loop rather than forEach because reading a chapter off disk is asynchronous now - see
//center-all-heads.js.
async function convertMarkedItalicsForAllChapters(project, marker){
  var anyChanged = false;

  for(let i = 0; i < project.chapters.length; i++){
    let chap = project.chapters[i];
    var result = convertMarkedItalics(chap.contents ? chap.contents : await chap.getFile(), marker);
    if(result.changed > 0){
      chap.contents = result.delta;
      chap.hasUnsavedChanges = true;
      anyChanged = true;
    }
  }

  if(anyChanged)
    project.hasUnsavedChanges = true;
}

function convertMarkedItalics(delt, marker){
  if(!marker)
    return { changed: 0, delta: delt };

  marker = marker.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
  var italRegx = new RegExp(marker + '((?:(?!' + marker + ')[\\s\\S])+)' + marker);

  var tempQuill = getTempQuill();
  tempQuill.setContents(delt);
  var text = tempQuill.getText();

  var foundIndex = 0;
  var matchResult;
  var counter = 0;

  while(foundIndex > -1){

      matchResult = text.match(italRegx);
      foundIndex = matchResult ? matchResult.index : -1;

      if(foundIndex > -1){
          counter++;

          tempQuill.deleteText(foundIndex, matchResult[0].length);
          tempQuill.insertText(foundIndex, matchResult[1]);
          tempQuill.formatText(matchResult.index, matchResult[1].length, 'italic', true);
          text = tempQuill.getText();
      }
  }

  return {
    changed: counter,
    delta: tempQuill.getContents()
  }
}

module.exports = {
  convertMarkedItalicsForAllChapters,
  convertMarkedItalics
}