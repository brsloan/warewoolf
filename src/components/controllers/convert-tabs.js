const { replaceAllInDelta } = require('./findreplace');

function convertMarkedTabs(delt, marker){
  return replaceAllInDelta(marker, '\t', true, delt);
}

function convertMarkedTabsForAllChapters(project, marker){
  var anyChanged = false;

  project.chapters.forEach(function(chap){
    var result = convertMarkedTabs(chap.getContentsOrFile(), marker);
    if(result.changed > 0){
      chap.contents = result.delta;
      chap.hasUnsavedChanges = true;
      anyChanged = true;
    }
  });

  if(anyChanged)
    project.hasUnsavedChanges = true;
}

module.exports = {
  convertMarkedTabs,
  convertMarkedTabsForAllChapters
}