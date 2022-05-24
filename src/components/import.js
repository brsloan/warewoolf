function importFiles(filepaths, options){
  filepaths.forEach(function(path){
    var importedFile = importPlainText(path);
    if(options.convertFirstLines)
      importedFile.delta = convertFirstLineToTitle(importedFile.delta).delta;
    if(options.convertItalics.convert)
      importedFile.delta = convertMarkedItalics(importedFile.delta, options.convertItalics.marker).delta;
    if(options.convertTabs.convert)
      importedFile.delta = convertMarkedTabs(importedFile.delta, options.convertTabs.marker).delta;

    addImportedChapter(importedFile.delta, importedFile.filename);
  });
}

function getImportFilepaths(docPath){
    const options = {
      title: 'Import files...',
      defaultPath: docPath,
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Text Files', extensions: ['txt'] }
      ]
    };
    var filepaths = dialog.showOpenDialogSync(options);
    return filepaths;
}

function importPlainText(filepath){
  var inText = fs.readFileSync(filepath, 'utf8');

  var tempQuill = getTempQuill();
  tempQuill.setText(inText);
  var newChapContents = tempQuill.getContents();

  var filename = filepath.replaceAll('\\', '/').split('/').pop().split('.')[0];

  return {
    filename: filename,
    delta: newChapContents
  };

}

function addImportedChapter(chapDelta, title){
    var newChap = newChapter();
    newChap.hasUnsavedChanges = true;
    newChap.contents = chapDelta;
    newChap.title = title;

    project.chapters.splice(project.activeChapterIndex + 1, 0, newChap);
    updateFileList();
    var thisIndex = project.chapters.indexOf(newChap);
    displayChapterByIndex(thisIndex);
}
