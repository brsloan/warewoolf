function initiateImport(docPath, options){
  console.log(options);

  var filepaths = getImportFilepaths(docPath, {
    name: options.fileType.name,
    extensions: options.fileType.extensions
  });
  //importPlainText(filepaths);
  console.log(filepaths);
  try{
    importFiles(filepaths, options);
  }
  catch(err){
    console.log(err);
  }
}

function importFiles(filepaths, options){
  filepaths.forEach(function(path){
    var importedFile;

    if(options.fileType.id == 'txtSelect')
      importedFile = importPlainText(path, options.txtOptions);
    else if(options.fileType.id == 'mdfcSelect')
      importedFile = importMDF(path);

    addImportedChapter(importedFile.delta, importedFile.filename);
  });
}

function getImportFilepaths(docPath, filter){
  console.log('filter: ');
  console.log(filter);
    const options = {
      title: 'Import files...',
      defaultPath: docPath,
      properties: ['openFile', 'multiSelections'],
      filters: [filter]
    };
    var filepaths = dialog.showOpenDialogSync(options);
    return filepaths;
}

function importPlainText(filepath, options){
  var inText = fs.readFileSync(filepath, 'utf8');

  var tempQuill = getTempQuill();
  tempQuill.setText(inText);
  var newChapContents = tempQuill.getContents();

  var filename = getFilenameFromFilepath(filepath);

  if(options.convertFirstLines)
    newChapContents = convertFirstLineToTitle(newChapContents).delta;
  if(options.convertItalics.convert)
    newChapContents = convertMarkedItalics(newChapContents, options.convertItalics.marker).delta;
  if(options.convertTabs.convert)
    newChapContents = convertMarkedTabs(newChapContents, options.convertTabs.marker).delta;

  return {
    filename: filename,
    delta: newChapContents
  };

}

function importMDF(filepath){
  var inText = fs.readFileSync(filepath, 'utf8');
  var delta = markdownFic().parseMDF(inText);
  var filename = getFilenameFromFilepath(filepath);

  return {
    filename: filename,
    delta: delta
  }
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

function getFilenameFromFilepath(filepath){
  return filepath.replaceAll('\\', '/').split('/').pop().split('.')[0];
}
