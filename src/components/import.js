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
  var inText = fs.readFileSync(filepath, 'utf8');

  var tempQuill = getTempQuill();
  tempQuill.setText(inText);
  var newChapContents = tempQuill.getContents();
  var filename = getFilenameFromFilepath(filepath);

  var packagedDeltas = [{
    filename: filename,
    delta: newChapContents
  }];

  console.log(tempQuill.getContents());
  var splitMarkerRegx = new RegExp('\n{0,2}' + options.splitChapters.marker + '\n{1,2}');

  if(options.splitChapters.split && splitMarkerRegx.test(tempQuill.getText())){
    packagedDeltas = [];
    let splitIndices = [];
    let foundIndex = 0;
    let startingIndex = 0;



    while(foundIndex > -1){
      var searchResult = splitMarkerRegx.exec(tempQuill.getText());
      foundIndex = searchResult ? tempQuill.getText().indexOf(searchResult[0], startingIndex) : -1;
      if(foundIndex > -1)
        splitIndices.push(foundIndex);
      startingIndex = foundIndex + options.splitChapters.marker.length + 2;
    }

    var splitDeltas = splitDeltaAtIndices(newChapContents, splitIndices);

    splitDeltas.forEach((delt, i) => {
      //remove split marker
      if(i != 0)
        delt = removeChapterMarker(delt, splitMarkerRegx);

      packagedDeltas.push({
        filename: generateChapTitleFromFirstLine(delt),
        delta: delt
      });
    });
  }

  packagedDeltas.forEach((deltPack, i) => {
    if(options.convertFirstLines)
      deltPack.delta = convertFirstLineToTitle(deltPack.delta).delta;
    if(options.convertItalics.convert)
      deltPack.delta = convertMarkedItalics(deltPack.delta, options.convertItalics.marker).delta;
    if(options.convertTabs.convert)
      deltPack.delta = convertMarkedTabs(deltPack.delta, options.convertTabs.marker).delta;
  });

  return packagedDeltas;
}

function removeChapterMarker(delt, markerRegx){
  var tempQuill = getTempQuill();
  tempQuill.setContents(delt);
  var txt = tempQuill.getText();
  tempQuill.setText(txt.replace(markerRegx, ''));

  delt = tempQuill.getContents();

  return delt;
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
