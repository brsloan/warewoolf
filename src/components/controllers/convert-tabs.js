const { replaceAllInDelta } = require('./findreplace');

function convertMarkedTabs(delt, marker){
  return replaceAllInDelta(marker, '\t', true, delt);
}

//Indexed loop rather than forEach because reading a chapter off disk is asynchronous now - see
//center-all-heads.js.
async function convertMarkedTabsForAllChapters(project, marker){
  var anyChanged = false;

  for(let i = 0; i < project.chapters.length; i++){
    let chap = project.chapters[i];
    var result = convertMarkedTabs(await chap.getContentsOrFile(), marker);
    if(result.changed > 0){
      chap.contents = result.delta;
      chap.hasUnsavedChanges = true;
      anyChanged = true;
    }
  }

  if(anyChanged)
    project.hasUnsavedChanges = true;
}

module.exports = {
  convertMarkedTabs,
  convertMarkedTabsForAllChapters
}