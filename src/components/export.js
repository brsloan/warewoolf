function exportProject(options, filepath){
    //TODO: Need to create function to safely convert titles to folder/filenames
    var newDir = filepath.concat("/").concat(project.title.replace(/[^a-z0-9]/gi, '_')).concat("/");

    if(!fs.existsSync(newDir))
        fs.mkdirSync(newDir);

    switch(options.type){
        case ".txt":
            exportAsText(newDir);
            break;
        case ".docx":
            exportAsWord(newDir);
            break;
        case ".mdfc":
            exportAsMDF(newDir);
            break;
        default:
            console.log("No valid filetype selected for export.");
    }
}

function exportAsMDF(dir){
  try{
    for(let i=0; i < project.chapters.length; i++){
      var chapFile = project.chapters[i].getFile();
      var outName = generateChapterFilename(i);

      fs.writeFileSync(dir + outName + '.mdfc', markdownFic().convertDeltaToMDF(chapFile));
    }

    fs.writeFileSync(dir + "notes" + ".mdfc", markdownFic().convertDeltaToMDF(project.notes));
  }
  catch(err){
    logError(err);
  }
}

function exportAsText(dir){
  try{
    for(i=0; i<project.chapters.length; i++){
        var chapFile = project.chapters[i].getFile();
        var outName = generateChapterFilename(i);

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

function exportAsWord(dir){
    exportChapsAsWord(dir);
    exportNotesAsWord(dir);
}

function exportChapsAsWord(dir, num = 0){
    for(let i=0; i<project.chapters.length;i++){
      var chapFile = project.chapters[i].getFile();
      var outName = generateChapterFilename(i);

      var doc = convertDeltaToDocx(chapFile);
      saveDocx(dir + outName + ".docx", doc);
    }
}

function exportNotesAsWord(dir){
    var chapFile = project.notes;

    var doc = convertDeltaToDocx(chapFile);
    saveDocx(dir + "notes" + ".docx", doc);
}

function generateChapterFilename(num){
    return String(num + 1).padStart(4, '0') + "_" + project.chapters[num].title.replace(/[^a-z0-9-]/gi, '_');
}
