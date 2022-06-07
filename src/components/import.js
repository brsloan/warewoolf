function initiateImport(docPath, options){
  var filepaths = getImportFilepaths(docPath, {
    name: options.fileType.name,
    extensions: options.fileType.extensions
  });

  try{
    importFiles(filepaths, options);
  }
  catch(err){
    logError(err);
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
  try{
    var inText = fs.readFileSync(filepath, 'utf8');

    var tempQuill = getTempQuill();
    tempQuill.setText(inText);
    var newChapContents = tempQuill.getContents();
    var filename = getFilenameFromFilepath(filepath);

    var packagedDeltas = [{
      filename: filename,
      delta: newChapContents
    }];

    if(options.splitChapters.split){
      packagedDeltas = [];
      var splitDeltas = splitDeltAtMarker(newChapContents, options.splitChapters.marker);

      splitDeltas.forEach((delt, i) => {
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
  catch(err){
    logError(err);
  }
}

function splitDeltAtMarker(delt, marker){
  var tempQuill = getTempQuill();
  tempQuill.setContents(delt);

  var splitMarkerRegx = new RegExp('\n{0,2}' + marker + '\n{0,2}');
  var splitDeltas = [];

  if(splitMarkerRegx.test(tempQuill.getText())){
    var splitIndices = getRegxIndices(tempQuill.getText(), splitMarkerRegx);

    splitDeltas = splitDeltaAtIndices(delt, splitIndices);

    splitDeltas.forEach((delt, i) => {
      //remove split marker
      if(i != 0)
        splitDeltas[i] = removeChapterMarker(delt, splitMarkerRegx);
    });
  }
  else {
    splitDeltas.push(delt);
  }

  return splitDeltas;
}

function getRegxIndices(txt, regx){
    let regxIndices = [];
    let foundIndex = 0;
    let startingIndex = 0;

    while(foundIndex > -1){
      var searchResult = regx.exec(txt);
      foundIndex = searchResult ? txt.indexOf(searchResult[0], startingIndex) : -1;
      if(foundIndex > -1){
        regxIndices.push(foundIndex);
        startingIndex = foundIndex + searchResult.length;
      }
    }

    return regxIndices;
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
  try{
    var inText = fs.readFileSync(filepath, 'utf8');
    var delta = markdownFic().parseMDF(inText);
    var filename = getFilenameFromFilepath(filepath);

    return [{
      filename: filename,
      delta: delta
    }];
  }
  catch(err){
    logError(err);
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
