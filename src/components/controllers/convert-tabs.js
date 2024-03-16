const { replaceAllInDelta } = require('./findreplace');

function convertMarkedTabs(chap, marker){
  return replaceAllInDelta(marker, '\t', false, chap);
}

function convertMarkedTabsForAllChapters(project, marker){
  project.chapters.forEach(function(chap){
    var result = convertMarkedTabs(chap.contents ? chap.contents : chap.getFile(), marker);
    if(result.changed > 0){
      chap.contents = result.delta;
      chap.hasUnsavedChanges = true;
    }
  });
}

module.exports = {
  convertMarkedTabs,
  convertMarkedTabsForAllChapters
}