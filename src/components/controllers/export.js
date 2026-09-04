const fs = require('fs');
const { convertDeltaToMDF, parseMDF } = require('./markdownFic');
const { logError } = require('./error-log');
const { convertDeltaToDocx, saveDocx } = require('./delta-to-docx');
const { sanitizeFilename } = require('./utils');
const { convertMdfcToHtmlPage, convertMdfcToHtml } = require('./mdfc-to-html');
const { convertMdfcToMd } = require('./mdfc-to-md');
const { htmlChaptersToEpub } = require('./epub');
const { getCorkboardForExport } = require('./corkboard');
const { convertToPlainText } = require('./quill-utils');
const notesNamePrepend = '-notes_';

//Unlike compile.js (which merges everything into a single output file), export.js is meant to
//write one output file per chapter/notes/corkboard item - that's the whole point of this module,
//so each chapter (including .epub) getting its own file is intentional, not a bug.
function exportProject(project, userSettings, options, filepath){
  try{
    var dirName = project.title.length > 0 ? sanitizeFilename(project.title) : 'exports';
    var dir = filepath.concat("/").concat(dirName).concat("/");

    if(!fs.existsSync(dir))
        fs.mkdirSync(dir);

    var chapsToExport = options.what == 'project' ? project.chapters.concat(project.reference) : [ project.getActiveChapter() ];
    for(let i=0;i<chapsToExport.length;i++){
      //Each chapter is exported independently of the others, so one bad chapter (corrupt file,
      //parse failure) shouldn't stop the rest of the batch from being written.
      try{
        var chap = chapsToExport[i];
        var chapFile = chap.getContentsOrFile();
        var chapNumber = i < project.chapters.length ? i : i - project.chapters.length;
        var outName = generateChapterFilename(chapNumber, chap.title, options.what);

        if(project.trash.includes(chap))
          outName = '-trash_' + outName;
        else if(i > project.chapters.length - 1)
          outName = '-ref_' + outName;

        exportChapter(project, chap.title, project.author, chapFile, dir + outName, userSettings, options);

        var chapNotesDelta = chap.getNotesContentOrFile();

        if(chapNotesDelta)
          exportChapter(project, chap.title + ' Notes', project.author, chapNotesDelta, dir + notesNamePrepend + outName, userSettings, options);
      }
      catch(err){
        logError(err);
      }
    }

    if(options.what == 'project'){
      try{
        var projectNotesDelta = project.notesChap.getNotesContentOrFile();
        if(projectNotesDelta)
          exportChapter(project, 'Project Notes', project.author, projectNotesDelta, dir + notesNamePrepend + 'project_', userSettings, options);
      }
      catch(err){
        logError(err);
      }

      try{
        var corkboardMd = getCorkboardForExport(project.directory + project.chapsDirectory, options);
        if(corkboardMd){
          //Override heading styles for just this document since it is not a chapter
          options.styleHeadingAsChapter = false;
          exportChapter(project, 'Project Corkboard', project.author, parseMDF(corkboardMd), dir + notesNamePrepend + 'corkboard', userSettings, options);
        }
      }
      catch(err){
        logError(err);
      }
    }

  }
  catch(err){
    logError(err);
  }
}

function exportChapter(project, chapterTitle, author, chapDelta, filepathNameNoExt, userSettings, options){
  switch(options.type){
        case ".txt":
            exportChapAsText(project.title, chapterTitle, author, chapDelta, filepathNameNoExt, options.generateTitlePage);
            break;
        case ".docx":
            exportChapAsDocx(project, userSettings.addressInfo, chapDelta, filepathNameNoExt, options);
            break;
        case ".mdfc":
            exportChapAsMdf(project.title, chapterTitle, author, chapDelta, filepathNameNoExt, options.generateTitlePage);
            break;
        case ".md":
            exportChapAsMd(project.title, chapterTitle, author, chapDelta, filepathNameNoExt, options.generateTitlePage);
            break;
        case ".html":
            exportChapAsHtml(project.title, chapterTitle, author, chapDelta, filepathNameNoExt, options.generateTitlePage);
            break;
        case ".epub":
            exportChapAsEpub(project.title, chapterTitle, author, chapDelta, filepathNameNoExt, options.generateTitlePage);
            break;
        default:
            console.log("No valid filetype selected for export.");
    }
}

function exportChapAsText(projectTitle, chapTitle, author, chapDelta, filepathNameNoExt, generateTitlePage){
  fs.writeFileSync(filepathNameNoExt + ".txt", convertToPlainText(chapDelta));
}

function exportChapAsDocx(project, addressInfo, chapDelta, filepathNameNoExt, options){
  var doc = convertDeltaToDocx(chapDelta, options, project, addressInfo);
  saveDocx(filepathNameNoExt + ".docx", doc);
}

function exportChapAsMdf(projectTitle, chapTitle, author, chapDelta, filepathNameNoExt, generateTitlePage){
  fs.writeFileSync(filepathNameNoExt + '.mdfc', convertDeltaToMDF(chapDelta));
}

function exportChapAsMd(projectTitle, chapTitle, author, chapDelta, filepathNameNoExt, generateTitlePage){
  fs.writeFileSync(filepathNameNoExt + '.md', convertMdfcToMd(convertDeltaToMDF(chapDelta)));
}

function exportChapAsHtml(projectTitle, chapTitle, author, chapDelta, filepathNameNoExt, generateTitlePage){
  fs.writeFileSync(filepathNameNoExt + '.html', convertMdfcToHtmlPage(convertDeltaToMDF(chapDelta), projectTitle + ": " + chapTitle, author, generateTitlePage));
}

function exportChapAsEpub(projectTitle, chapTitle, author, chapDelta, filepathNameNoExt, generateTitlePage){
  var htmlChap = {
        title: chapTitle,
        html: convertMdfcToHtml(convertDeltaToMDF(chapDelta))
      }

  htmlChaptersToEpub(projectTitle + ': ' + chapTitle, author, [htmlChap], filepathNameNoExt + '.epub', generateTitlePage, function(resp){
    console.log('epub exported: ' + resp);
  });
}

function generateChapterFilename(num, title, what){
    var prefix = what == 'project' ? String(num + 1).padStart(4, '0') + '_' : '';
    return prefix + sanitizeFilename(title);
}

module.exports = {
  exportProject
}