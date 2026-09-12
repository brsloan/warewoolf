const { stemOfPath } = require('./path-utils');
const showFileDialog = require('../views/file-dialog_display');
const { logError } = require('./error-log');
const { showWorking, hideWorking } = require('../views/working_display');
const { importDocx } = require('./docx-import');
const { importEpub } = require('./epub-import');
const { convertHtmlToDelta } = require('./html-import');
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

//`bookMetadata` accumulates the title and author of the first imported file that carries any - only
//an epub does today. It travels out through cback rather than through a parameter of its own,
//because "the import has finished" is exactly the moment a project would want to take its defaults
//from it, and that callback already marks it. Everything that ignores the argument (every caller
//before this) behaves as it always did.
function importFilesAsync(filepaths, options, addImportedChapter, cback, sysDirectories, importedDeltas = [], bookMetadata = null){
  showWorking('Importing file...');
  if(importedDeltas.length > 0)
    showWorking('Chapters Generated So Far: ' + importedDeltas.length);
  var filepath = filepaths.shift();

  if(options.fileType.id == 'docxSelect'){
    importDocx(filepath, options.docxOptions.splitChapters, function(delts){
        recurse(packageDeltas(delts, getFilenameFromFilepath(filepath), options.docxOptions.chapLabels));
    })
  }
  else if(options.fileType.id == 'htmlSelect'){
    importHtml(filepath, options.htmlOptions, function(delts){
      recurse(delts);
    });
  }
  else if(options.fileType.id == 'epubSelect'){
    importEpubFile(filepath, options.epubOptions, function(delts, metadata){
      //First book wins, so importing several at once does not have the last one's title quietly
      //replace the first one's.
      if(!bookMetadata && metadata && (metadata.title || metadata.author))
        bookMetadata = metadata;
      recurse(delts);
    });
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
    //Should be unreachable from the UI (import_display.js only ever offers these fileType ids),
    //but without this the working overlay hangs forever with no error surfaced if it happens.
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
      importFilesAsync(filepaths, options, addImportedChapter, cback, sysDirectories, importedDeltas, bookMetadata);
    }
    else {
      importedDeltas.forEach((delt, i) => {
        addImportedChapter(delt.delta, delt.title);
      });
      hideWorking();
      cback(bookMetadata);
    }
  }
}

//Both the docx and the HTML importer turn one file into any number of chapters, so both need the
//same answer to "what is each one called". Extracted rather than written twice: the numbering below
//is a regression fix (see the test of the same name in test/import.test.js) and having one copy of
//it is the only way a second importer inherits the fix rather than reintroducing the bug.
function packageDeltas(deltas, filename, chapLabels){
  return deltas.map(function(delta, i, arr){
    //A single file split into several chapters can't label every one of them with the same bare
    //filename - number them so they stay distinguishable.
    var filenameTitle = arr.length > 1 ? filename + ' ' + (i + 1) : filename;

    return {
      title: chapLabels == 'filename' ? filenameTitle : generateChapTitleFromFirstLine(delta),
      delta: delta
    };
  });
}

//Unlike the docx importer, the whole conversion is pure string/DOM work (see html-import.js), so
//this only has to read the file - there is no native side to an HTML import at all.
function importHtml(filepath, options, callback){
  platform.readTextFile({ path: filepath }).then(function(html){
    //htmlOptions is already the converter's own option shape (import_display.js builds it that way),
    //so it passes straight through - convertHtmlToDelta applies its own defaults to anything absent.
    var deltas = convertHtmlToDelta(html, options);

    callback(packageDeltas(deltas, getFilenameFromFilepath(filepath), options.chapLabels));
  }).catch(function(err){
    //Same policy as importPlainText below: a read failure is logged and skipped via an empty result
    //rather than thrown, so the rest of a multi-file import keeps going.
    logError(err);
    callback([]);
  });
}

//An epub knows its own title and author, and a project imported from one usually wants them. Only a
//*blank* field is filled: a writer who has already named their manuscript does not want importing a
//reference book to rename it, and a project field has no undo. Both stay theirs to edit under
//File > Properties either way.
function applyBookMetadata(project, bookMetadata){
  if(!project || !bookMetadata)
    return false;

  var changed = false;

  if(!project.title && bookMetadata.title){
    project.title = bookMetadata.title;
    changed = true;
  }

  if(!project.author && bookMetadata.author){
    project.author = bookMetadata.author;
    changed = true;
  }

  //Only when something actually moved: marking a project dirty for a no-op would have the writer
  //prompted to save a file nothing changed in.
  if(changed)
    project.hasUnsavedChanges = true;

  return changed;
}

//Named importEpubFile rather than importEpub so it does not shadow epub-import.js's own export, the
//one it delegates to. Its callback takes a second argument the others do not: the book's own title
//and author, which no other format carries.
function importEpubFile(filepath, options, callback){
  importEpub(filepath, options, function(book){
    //Reported only when asked for. The project applies it to a blank title/author and never over one
    //the writer has already set, but a writer who does not want an imported book's name anywhere
    //near their manuscript can say so outright.
    var metadata = options.useMetadata === false ? null : book.metadata;

    //An epub already knows what each of its chapters is called - the table of contents says so - and
    //that is a better name than the first line of the text in every case where the two differ. So
    //the label options mean something slightly different here: "filename" still numbers chapters
    //after the file, and anything else prefers the book's own name for the chapter, falling back to
    //the first line only where the table of contents named nothing.
    if(options.chapLabels == 'filename'){
      callback(packageDeltas(book.chapters.map(function(chapter){
        return chapter.delta;
      }), getFilenameFromFilepath(filepath), 'filename'), metadata);
      return;
    }

    callback(book.chapters.map(function(chapter){
      return {
        title: chapter.title || generateChapTitleFromFirstLine(chapter.delta),
        delta: chapter.delta
      };
    }), metadata);
  });
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
  importHtml,
  importEpubFile,
  applyBookMetadata,
  importPlainText,
  importMDF,
  getFilenameFromFilepath
}