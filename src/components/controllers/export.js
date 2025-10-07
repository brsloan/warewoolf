const fs = require('fs');
const { convertDeltaToMDF, parseMDF } = require('./markdownFic');
const { logError } = require('./error-log');
const { convertDeltaToDocx, saveDocx } = require('./delta-to-docx');
const { sanitizeFilename } = require('./utils');
const { convertMdfcToHtmlPage, convertMdfcToHtml } = require('./mdfc-to-html');
const { convertMdfcToMd } = require('./mdfc-to-md');
const { htmlChaptersToEpub } = require('./epub');
const { getCorkboardAsMd } = require('./corkboard');
const notesNamePrepend = '-notes_';

function exportProject(project, userSettings, options, filepath){
  try{
    var dirName = project.title.length > 0 ? sanitizeFilename(project.title) : 'exports';
    var dir = filepath.concat("/").concat(dirName).concat("/");

    if(!fs.existsSync(dir))
        fs.mkdirSync(dir);

    var chapsToExport = options.what == 'project' ? project.chapters.concat(project.reference) : [ project.getActiveChapter() ];
    for(let i=0;i<chapsToExport.length;i++){
      var chapFile = chapsToExport[i].getContentsOrFile();
      var chapNumber = i < project.chapters.length ? i : i - project.chapters.length;
      var outName = generateChapterFilename(chapNumber, chapsToExport[i].title, options.what);

      if(i > project.chapters.length - 1)
        outName = '-ref_' + outName;

      exportChapter(project, chapsToExport[i].title, project.author, chapFile, dir + outName, userSettings, options);

      var chapNotesDelta = chapsToExport[i].getNotesContentOrFile();

      if(chapNotesDelta)
        exportChapter(project, chapsToExport[i].title + ' Notes', project.author, chapNotesDelta, dir + notesNamePrepend + outName, userSettings, options); 
    }

    if(options.what == 'project'){
      var projectNotesDelta = project.notesChap.getNotesContentOrFile();
      if(projectNotesDelta)
        exportChapter(project, 'Project Notes', project.author, projectNotesDelta, dir + notesNamePrepend + 'project_', userSettings, options);
      var corkboardMd = getCorkboardAsMd(project.directory + project.chapsDirectory);
      if(corkboardMd)
        exportChapter(project, 'Project Corkboard', project.author, parseMDF(corkboardMd), dir + notesNamePrepend + 'corkboard', userSettings, options);
    }

  }
  catch(err){
    logError(err);
  }  
}

function exportChapter(project, chapterTitle, author, chapDelta, filepathNameNoExt, userSettings, options){
  switch(options.type){
        case ".txt":
            exportChapAsText(project.title, chapterTitle, author, chapDelta, filepathNameNoExt, options.compileGenTitlePage);
            break;
        case ".docx":
            exportChapAsDocx(project, userSettings.addressInfo, chapDelta, filepathNameNoExt, options.compileGenTitlePage);
            break;
        case ".mdfc":
            exportChapAsMdf(project.title, chapterTitle, author, chapDelta, filepathNameNoExt, options.compileGenTitlePage);
            break;
        case ".md":
            exportChapAsMd(project.title, chapterTitle, author, chapDelta, filepathNameNoExt, options.compileGenTitlePage);
            break;
        case ".html":
            exportChapAsHtml(project.title, chapterTitle, author, chapDelta, filepathNameNoExt, options.compileGenTitlePage);
            break;
        case ".epub":
            exportChapAsEpub(project.title, chapterTitle, author, chapDelta, filepathNameNoExt, options.compileGenTitlePage);
            break;
        default:
            console.log("No valid filetype selected for export.");
    }
}

function exportChapAsText(projectTitle, chapTitle, author, chapDelta, filepathNameNoExt, generateTitlePage){
  fs.writeFileSync(filepathNameNoExt + ".txt", convertToPlainText(chapDelta));
}

function exportChapAsDocx(project, addressInfo, chapDelta, filepathNameNoExt, generateTitlePage){
  var doc = convertDeltaToDocx(chapDelta, { generateTitlePage: generateTitlePage }, project, addressInfo);
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

function convertToPlainText(delt){
  var text = '';
  delt.ops.forEach(op => {
    text += op.insert;
  });
  return text;
}

function generateChapterFilename(num, title, what){
    var prefix = what == 'project' ? String(num + 1).padStart(4, '0') + '_' : '';
    return prefix + sanitizeFilename(title);
}

module.exports = {
  exportProject
}