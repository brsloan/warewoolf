const fs = require('fs');
const { convertDeltaToMDF } = require('./markdownFic');
const { logError } = require('./error-log');
const { convertDeltaToDocx, saveDocx } = require('./delta-to-docx');
const { sanitizeFilename } = require('./utils');
const { convertMdfcToHtmlPage } = require('./mdfc-to-html');
const { convertMdfcToMd } = require('./mdfc-to-md');

function exportProject(project, userSettings, options, filepath){
    //TODO: Need to create function to safely convert titles to folder/filenames
    var dirName = project.title.length > 0 ? project.title.replace(/[^a-z0-9]/gi, '_') : 'exports';
    var newDir = filepath.concat("/").concat(dirName).concat("/");

    if(!fs.existsSync(newDir))
        fs.mkdirSync(newDir);

    switch(options.type){
        case ".txt":
            exportAsText(project, newDir, options.what);
            break;
        case ".docx":
            exportAsWord(project, userSettings, newDir, options.what);
            break;
        case ".mdfc":
            exportAsMDF(project, newDir, options.what);
            break;
        case ".md":
            exportAsMd(project, newDir, options.what);
            break;
        default:
            console.log("No valid filetype selected for export.");
    }
}

function exportAsMd(project, dir, what){
  try{
    var chapsToExport = what == 'project' ? project.chapters : [ project.getActiveChapter() ];
    for(let i=0; i < chapsToExport.length; i++){
      var chapFile = chapsToExport[i].getContentsOrFile();
      var outName = generateChapterFilename(i, chapsToExport[i].title, what);

      fs.writeFileSync(dir + outName + '.mdfc', convertMdfcToMd(convertDeltaToMDF(chapFile)));
    }

    if(what == 'project')
      fs.writeFileSync(dir + "notes" + ".mdfc", convertMdfcToMd(convertDeltaToMDF(project.notes)));
  }
  catch(err){
    logError(err);
  }
}

function exportAsMDF(project, dir, what){
  try{
    var chapsToExport = what == 'project' ? project.chapters : [ project.getActiveChapter() ];
    for(let i=0; i < chapsToExport.length; i++){
      var chapFile = chapsToExport[i].getContentsOrFile();
      var outName = generateChapterFilename(i, chapsToExport[i].title, what);

      fs.writeFileSync(dir + outName + '.mdfc', convertDeltaToMDF(chapFile));
    }

    if(what == 'project')
      fs.writeFileSync(dir + "notes" + ".mdfc", convertDeltaToMDF(project.notes));
  }
  catch(err){
    logError(err);
  }
}

function exportAsText(project, dir, what){
  try{
    var chapsToExport = what == 'project' ? project.chapters : [ project.getActiveChapter() ];
    for(i=0; i<chapsToExport.length; i++){
        var chapFile = chapsToExport[i].getContentsOrFile();
        var outName = generateChapterFilename(i, chapsToExport[i].title, what);

        fs.writeFileSync(dir + outName + ".txt", convertToPlainText(chapFile));
    }

    if(what == 'project')
      fs.writeFileSync(dir + "notes" + ".txt", convertToPlainText(project.notes));
  }
  catch(err){
    logError(err);
  }
}

function convertToPlainText(delt){
  var text = '';
  delt.ops.forEach(op => {
    text += op.insert;
  });
  return text;
}

function exportAsWord(project, userSettings, dir, what){
    exportChapsAsWord(project, userSettings, dir, what);
    if(what == 'project')
      exportNotesAsWord(project, userSettings, dir);
}

function exportChapsAsWord(project, userSettings, dir, what){
    var chapsToExport = what == 'project' ? project.chapters : [ project.getActiveChapter() ];
    for(let i=0; i < chapsToExport.length;i++){
      var chapFile = chapsToExport[i].getContentsOrFile();
      var outName = generateChapterFilename(i, chapsToExport[i].title, what);

      var doc = convertDeltaToDocx(chapFile, { generateTitlePage: false }, project, userSettings);
      saveDocx(dir + outName + ".docx", doc);
    }
}

function exportNotesAsWord(project, userSettings, dir){
    var chapFile = project.notes;

    var doc = convertDeltaToDocx(chapFile, { generateTitlePage: false }, project, userSettings);
    saveDocx(dir + "notes" + ".docx", doc);
}

function generateChapterFilename(num, title, what){
    var prefix = what == 'project' ? String(num + 1).padStart(4, '0') + '_' : '';
    return prefix + sanitizeFilename(title);
}

module.exports = {
  exportProject
}