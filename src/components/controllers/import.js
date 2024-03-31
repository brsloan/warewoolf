const fs = require('fs');
const showFileDialog = require('../views/file-dialog_display');
const { logError } = require('./error-log');
const { showWorking, hideWorking } = require('../views/working_display');
const { importDocx } = require('./docx-import');
const { generateChapTitleFromFirstLine } = require('./quill-utils');
const { convertFirstLineToTitle } = require('./convert-first-lines')
const { convertMarkedItalics } = require('./convert-italics');
const { convertMarkedTabs } = require('./convert-tabs');
const { parseMDF } = require('./markdownFic');

function initiateImport(sysDirectories, options, addImportedChapter, cback){

  const dialogOptions = {
    title: 'Import files...',
    defaultPath: sysDirectories.docs,
    filters: [
      { name: options.fileType.name, extensions: options.fileType.extensions }
    ],
    bookmarkedPaths: [sysDirectories.docs, sysDirectories.home],
    dialogType: 'open'
  };

  showFileDialog(dialogOptions, function(filepaths){
    try{
      importFilesAsync(filepaths, options, addImportedChapter, cback);
    }
    catch(err){
      logError(err);
      hideWorking();
    }
  });
}

function importFilesAsync(filepaths, options, addImportedChapter, cback, importedDeltas = []){
  showWorking('Importing file...');
  if(importedDeltas.length > 0)
    showWorking('Chapters Generated So Far: ' + importedDeltas.length);
  var path = filepaths.shift();

  if(options.fileType.id == 'docxSelect'){
    importDocx(path, options.docxOptions.splitChapters, function(delts){
        recurse(delts.map(function(delt, i, arr){
          return {
            title: generateChapTitleFromFirstLine(delt),
            delta: delt
          };
        }));
    })
  }
  else if(options.fileType.id == 'txtSelect'){
    importPlainText(path, options.txtOptions, function(delts){
      recurse(delts);
    });
  }
  else if(options.fileType.id == 'mdfcSelect')
    importMDF(path, function(delts){
      recurse(delts);
    });

  function recurse(packagedDelts){
    packagedDelts.forEach((packagedDelt, i) => {
        importedDeltas.push(packagedDelt);
    });

    if(filepaths.length > 0){
      importFilesAsync(filepaths, options, addImportedChapter, cback, importedDeltas);
    }
    else {
      importedDeltas.forEach((delt, i) => {
        addImportedChapter(delt.delta, delt.title);
      });
      hideWorking();
      cback();
    }
  }
}

function importPlainText(filepath, options, callback){
  try{
    fs.readFile(filepath, 'utf8', function(err, inText){
      var filename = getFilenameFromFilepath(filepath);
      var packagedDeltas = [];

      if(options.splitChapters.split){
        var chapTxts = inText.split(new RegExp(options.splitChapters.marker + '\r?\n'));
        chapTxts.forEach(function(txt, i){
          packagedDeltas.push({
            title: generateTitleFromFirstLineText(txt),
            delta: {
              ops:[{ insert: txt }]
            }
          })
        });
      }
      else {
        packagedDeltas.push({
          title: generateTitleFromFirstLineText(inText),
          delta: {
            ops: [{ insert: inText }]
          }
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

      callback(packagedDeltas);
    });
  }
  catch(err){
    logError(err);
  }
}

function generateTitleFromFirstLineText(str){
   const titleCharacterLimit = 100;
  return str.split(/\r?\n/)[0].slice(0,titleCharacterLimit).replaceAll(/<|>/g,'');
}

function importMDF(filepath, callback){
  try{
    fs.readFile(filepath, 'utf8', function(err, data){
      var delta = parseMDF(data);
      var filename = getFilenameFromFilepath(filepath);

      callback([{
        title: filename,
        delta: delta
      }]);
    });
  }
  catch(err){
    logError(err);
  }
}

function getFilenameFromFilepath(filepath){
  return filepath.replaceAll('\\', '/').split('/').pop().split('.')[0];
}

module.exports = {
  initiateImport
}