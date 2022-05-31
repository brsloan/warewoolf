function initiateImport(docPath, options){
  var filepaths = getImportFilepaths(docPath, {
    name: options.fileType.name,
    extensions: options.fileType.extensions
  });

  try{
    importFiles(filepaths, options);
  }
  catch(err){
    console.log(err);
  }
}

function importFiles(filepaths, options){
  filepaths.forEach(function(path){
    var importedDeltas;

    if(options.fileType.id == 'txtSelect')
      importedDeltas = importPlainText(path, options.txtOptions);
    else if(options.fileType.id == 'mdfcSelect')
      importedDeltas = importMDF(path);

    importedDeltas.forEach((delt, i) => {
      addImportedChapter(delt.delta, delt.filename);
    });
  });
}

function getImportFilepaths(docPath, filter){
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
  console.log(options);
  var packagedDeltas = [];
  var inText = fs.readFileSync(filepath, 'utf8');

  var tempQuill = getTempQuill();
  tempQuill.setText(inText);
  var newChapContents = tempQuill.getContents();

  var filename = getFilenameFromFilepath(filepath);


  //Need to re-order so converting first lines happens after splitting.
  if(options.convertFirstLines)
    newChapContents = convertFirstLineToTitle(newChapContents).delta;
  if(options.convertItalics.convert)
    newChapContents = convertMarkedItalics(newChapContents, options.convertItalics.marker).delta;
  if(options.convertTabs.convert)
    newChapContents = convertMarkedTabs(newChapContents, options.convertTabs.marker).delta;
  if(options.splitChapters.split){
    let splitIndices = [];
    let foundIndex = 0;
    let startingIndex = 0;
    while(foundIndex > -1){
      foundIndex = inText.indexOf(options.splitChapters.marker, startingIndex);
      if(foundIndex > -1)
        splitIndices.push(foundIndex);
      startingIndex = foundIndex + options.splitChapters.marker.length;
    }

    var splitDeltas = splitDeltaAtIndices(newChapContents, splitIndices);
    splitDeltas.forEach((delt, i) => {
      //remove split marker
      if(i != 0)
        delt = removeFirstLine(delt);

      packagedDeltas.push({
        filename: generateChapTitleFromFirstLine(delt),
        delta: delt
      });
    });
  }
  else {
    packagedDeltas.push({
      filename: filename,
      delta: newChapContents
    });
  }


  return packagedDeltas;
}

function importMDF(filepath){
  var inText = fs.readFileSync(filepath, 'utf8');
  var delta = markdownFic().parseMDF(inText);
  var filename = getFilenameFromFilepath(filepath);

  return [{
    filename: filename,
    delta: delta
  }];
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
