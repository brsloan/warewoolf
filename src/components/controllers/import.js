const fs = require('fs');
const path = require('path');
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
      importFilesAsync(filepaths, options, addImportedChapter, cback, sysDirectories);
    }
    catch(err){
      logError(err);
      hideWorking();
    }
  });
}

function importFilesAsync(filepaths, options, addImportedChapter, cback, sysDirectories, importedDeltas = []){
  showWorking('Importing file...');
  if(importedDeltas.length > 0)
    showWorking('Chapters Generated So Far: ' + importedDeltas.length);
  var filepath = filepaths.shift();

  if(options.fileType.id == 'docxSelect'){
    var filename = getFilenameFromFilepath(filepath);
    importDocx(filepath, sysDirectories, options.docxOptions.splitChapters, function(delts){
        recurse(delts.map(function(delt, i, arr){
          //A single docx split into several chapters can't label every one of them with the same
          //bare filename - number them so they stay distinguishable.
          var filenameTitle = arr.length > 1 ? filename + ' ' + (i + 1) : filename;
          return {
            title: options.docxOptions.chapLabels == 'filename' ? filenameTitle : generateChapTitleFromFirstLine(delt),
            delta: delt
          };
        }));
    })
  }
  else if(options.fileType.id == 'txtSelect'){
    importPlainText(filepath, options.txtOptions, function(delts){
      recurse(delts);
    });
  }
  else if(options.fileType.id == 'mdfcSelect')
    importMDF(filepath, options.mdfcOptions, function(delts){
      recurse(delts);
    });
  else {
    //Should be unreachable from the UI (import_display.js only ever offers these three fileType
    //ids), but without this the working overlay hangs forever with no error surfaced if it happens.
    logError(new Error('importFilesAsync: unrecognized fileType.id "' + options.fileType.id + '"'));
    hideWorking();
    cback();
    return;
  }

  function recurse(packagedDelts){
    packagedDelts.forEach((packagedDelt, i) => {
        importedDeltas.push(packagedDelt);
    });

    if(filepaths.length > 0){
      importFilesAsync(filepaths, options, addImportedChapter, cback, sysDirectories, importedDeltas);
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
      //fs.readFile's callback runs on its own tick, outside this try/catch, so an unchecked error
      //here would leave inText undefined and throw uncaught the moment it's used below - logging
      //and skipping the file (via an empty result) keeps the rest of a multi-file import going.
      if(err){
        logError(err);
        callback([]);
        return;
      }

      var filename = getFilenameFromFilepath(filepath);
      var packagedDeltas = [];

      if(options.splitChapters.split){
        //The split marker is free text from the user (see import_display.js's "Chapter Split
        //Marker" field), so it must be escaped before going into a RegExp - same as
        //convert-italics.js does for its marker - otherwise a marker containing regex
        //metacharacters (e.g. "(scene)") either throws or matches the wrong thing.
        var escapedMarker = options.splitChapters.marker.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
        var chapTxts = inText.split(new RegExp(escapedMarker + '\r?\n'));
        chapTxts.forEach(function(txt, i){
          packagedDeltas.push({
            title: options.chapLabels == 'filename' ? filename : generateTitleFromFirstLineText(txt),
            delta: {
              ops:[{ insert: txt }]
            }
          })
        });
      }
      else {
        packagedDeltas.push({
          title: options.chapLabels == 'filename' ? filename : generateTitleFromFirstLineText(inText),
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

function importMDF(filepath, options, callback){
  try{
    fs.readFile(filepath, 'utf8', function(err, data){
      if(err){
        logError(err);
        callback([]);
        return;
      }

      var delta = parseMDF(data);
      var filename = getFilenameFromFilepath(filepath);

      callback([{
        title: options.chapLabels == 'filename' ? filename : generateChapTitleFromFirstLine(delta), 
        delta: delta
      }]);
    });
  }
  catch(err){
    logError(err);
  }
}

//Splits off only the final extension (via path.basename/extname), not every "." in the filename -
//splitting on the first "." lost everything after it for a multi-dot name (e.g. "chapter 1.5.txt"
//became "chapter 1", "my.novel.draft.txt" became "my"). Same fix as file-manager.js applies for
//the same reason.
function getFilenameFromFilepath(filepath){
  var normalized = filepath.replaceAll('\\', '/');
  return path.basename(normalized, path.extname(normalized));
}

module.exports = {
  initiateImport,
  importFilesAsync,
  importPlainText,
  importMDF,
  getFilenameFromFilepath
}