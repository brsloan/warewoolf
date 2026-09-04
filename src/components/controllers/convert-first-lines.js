const { getTempQuill } = require('./quill-utils');

function convertFirstLinesToTitles(project){
  var anyChanged = false;

  project.chapters.forEach(function(chap){
    var result = convertFirstLineToTitle(chap.getContentsOrFile());

    if(result.changed > 0){
      chap.contents = result.delta;
      chap.hasUnsavedChanges = true;
      anyChanged = true;
    }
  });

  if(anyChanged)
    project.hasUnsavedChanges = true;
}

function convertFirstLineToTitle(delt){
  var tempQuill = getTempQuill();

  var changes = 0;

  tempQuill.setContents(delt);
  var firstLineFormat = tempQuill.getFormat(0, 1);

  if(!firstLineFormat.header || firstLineFormat.header != 1){
    tempQuill.formatLine(0, 1, 'header', 1);
    changes++;
  }
  if(!firstLineFormat.align || firstLineFormat.align != 'center'){
    tempQuill.formatLine(0, 1, 'align', 'center');
    changes++;
  }

  return {
    changed: changes,
    delta: tempQuill.getContents()
  }

}

module.exports = {
  convertFirstLinesToTitles,
  convertFirstLineToTitle
}