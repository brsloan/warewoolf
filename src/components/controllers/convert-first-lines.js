const { getTempQuill } = require('./quill-utils');

//Indexed loop rather than forEach because reading a chapter off disk is asynchronous now - see
//center-all-heads.js.
async function convertFirstLinesToTitles(project){
  var anyChanged = false;

  for(let i = 0; i < project.chapters.length; i++){
    let chap = project.chapters[i];
    //A chapter whose file failed to load reads back as null/undefined, which Quill treats as an
    //empty document - one with no header/align formatting at index 0. Without this check that
    //looks indistinguishable from a real chapter needing conversion, and the chapter's actual
    //content would be overwritten with a blank titled line below.
    var contents = await chap.getContentsOrFile();
    if(contents == null)
      continue;

    var result = convertFirstLineToTitle(contents);

    if(result.changed > 0){
      chap.contents = result.delta;
      chap.hasUnsavedChanges = true;
      anyChanged = true;
    }
  }

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