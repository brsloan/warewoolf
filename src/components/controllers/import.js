const { stemOfPath } = require('./path-utils');
const showFileDialog = require('../views/file-dialog_display');
const { logError } = require('./error-log');
const { showWorking, hideWorking } = require('../views/working_display');
const { importDocx } = require('./docx-import');
const { generateChapTitleFromFirstLine } = require('./quill-utils');
const { convertFirstLineToTitle } = require('./convert-first-lines')
const { convertMarkedItalics } = require('./convert-italics');
const { convertMarkedTabs } = require('./convert-tabs');
const { parseMDF } = require('./markdownFic');
const { createPlatform } = require('./platform');
const { createIpcBacking } = require('./platform-ipc');

//readTextFile takes no injected config - path is a full path - so this holds its own standing
//instance, the same reason file-manager.js/docx-import.js do.
var platform = createPlatform(createIpcBacking());

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
    importDocx(filepath, options.docxOptions.splitChapters, function(delts){
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
  platform.readTextFile({ path: filepath }).then(function(inText){
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
  }).catch(function(err){
    //A read failure (missing file, permission denied) is logged and skipped - via an empty
    //result - rather than thrown, so the rest of a multi-file import keeps going.
    logError(err);
    callback([]);
  });
}

function generateTitleFromFirstLineText(str){
   const titleCharacterLimit = 100;
  return str.split(/\r?\n/)[0].slice(0,titleCharacterLimit).replaceAll(/<|>/g,'');
}

function importMDF(filepath, options, callback){
  platform.readTextFile({ path: filepath }).then(function(data){
    var delta = parseMDF(data);
    var filename = getFilenameFromFilepath(filepath);

    callback([{
      title: options.chapLabels == 'filename' ? filename : generateChapTitleFromFirstLine(delta),
      delta: delta
    }]);
  }).catch(function(err){
    logError(err);
    callback([]);
  });
}

//Splits off only the final extension, not every "." in the filename - splitting on the first "."
//lost everything after it for a multi-dot name (e.g. "chapter 1.5.txt" became "chapter 1",
//"my.novel.draft.txt" became "my"). stemOfPath is the shared helper file-manager.js applies for
//the same reason, and it does the backslash normalization this used to do inline before handing
//the name back.
function getFilenameFromFilepath(filepath){
  return stemOfPath(filepath);
}

module.exports = {
  initiateImport,
  importFilesAsync,
  importPlainText,
  importMDF,
  getFilenameFromFilepath
}