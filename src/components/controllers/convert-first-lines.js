 const { getTempQuill } = require('./quill-utils');

function convertFirstLinesToTitles(project){
  console.log('converting');
  //var tempQuill = getTempQuill();

  project.chapters.forEach(function(chap){
    var result = convertFirstLineToTitle(chap.contents ? chap.contents : chap.getFile());

    if(result.changed > 0){
      chap.contents = result.delta;
      chap.hasUnsavedChanges = true;
    }
  });

}

function convertFirstLineToTitle(delt){
  var tempQuill = getTempQuill();

  var changes = 0;

  tempQuill.setContents(delt);
  var firstLineFormat = tempQuill.getFormat(1, 1);

  if(!firstLineFormat.header || firstLineFormat.header != 1){
    tempQuill.formatLine(1, 1, 'header', 1);
    changes++;
  }
  if(!firstLineFormat.align || firstLineFormat.align != 'center'){
    tempQuill.formatLine(1, 1, 'align', 'center');
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