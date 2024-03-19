const fs = require('fs');
const { convertDeltaToMDF } = require('./markdownFic');
const { logError } = require('./error-log');
const { getTempQuill } = require('./quill-utils');
const { convertDeltaToDocx, saveDocx } = require('./delta-to-docx');

function exportProject(project, userSettings, options, filepath){
    //TODO: Need to create function to safely convert titles to folder/filenames
    var dirName = project.title.length > 0 ? project.title.replace(/[^a-z0-9]/gi, '_') : 'exports';
    var newDir = filepath.concat("/").concat(dirName).concat("/");

    if(!fs.existsSync(newDir))
        fs.mkdirSync(newDir);

    switch(options.type){
        case ".txt":
            exportAsText(project, newDir);
            break;
        case ".docx":
            exportAsWord(project, userSettings, newDir);
            break;
        case ".mdfc":
            exportAsMDF(project, newDir);
            break;
        default:
            console.log("No valid filetype selected for export.");
    }
}

function exportAsMDF(project, dir){
  try{
    for(let i=0; i < project.chapters.length; i++){
      var chapFile = project.chapters[i].getContentsOrFile();
      var outName = generateChapterFilename(i, project.chapters[i].title);

      fs.writeFileSync(dir + outName + '.mdfc', convertDeltaToMDF(chapFile));
    }

    fs.writeFileSync(dir + "notes" + ".mdfc", convertDeltaToMDF(project.notes));
  }
  catch(err){
    logError(err);
  }
}

function exportAsText(project, dir){
  try{
    for(i=0; i<project.chapters.length; i++){
        var chapFile = project.chapters[i].getContentsOrFile();
        var outName = generateChapterFilename(i, project.chapters[i].title);

        fs.writeFileSync(dir + outName + ".txt", convertToPlainText(chapFile));
    }

    fs.writeFileSync(dir + "notes" + ".txt", convertToPlainText(project.notes));
  }
  catch(err){
    logError(err);
  }
}

function convertToPlainText(chapFile){
    var tempQuill = getTempQuill();

    tempQuill.setContents(chapFile);

    return tempQuill.getText();
}

function exportAsWord(project, userSettings, dir){
    exportChapsAsWord(project, userSettings, dir);
    exportNotesAsWord(project, userSettings, dir);
}

function exportChapsAsWord(project, userSettings, dir, num = 0){
    for(let i=0; i<project.chapters.length;i++){
      var chapFile = project.chapters[i].getContentsOrFile();
      var outName = generateChapterFilename(i, project.chapters[i].title);

      var doc = convertDeltaToDocx(chapFile, { generateTitlePage: false }, project, userSettings);
      saveDocx(dir + outName + ".docx", doc);
    }
}

function exportNotesAsWord(project, userSettings, dir){
    var chapFile = project.notes;

    var doc = convertDeltaToDocx(chapFile, { generateTitlePage: false }, project, userSettings);
    saveDocx(dir + "notes" + ".docx", doc);
}

function generateChapterFilename(num, title){
    return String(num + 1).padStart(4, '0') + "_" + title.replace(/[^a-z0-9-]/gi, '_');
}

module.exports = {
  exportProject
}