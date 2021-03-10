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
        default: 
            console.log("No valid filetype selected for export.");
    }
}

function exportAsText(dir){
    for(i=0; i<project.chapters.length; i++){
        var chapFile = project.chapters[i].getFile();
        var outName = generateChapterFilename(i);

        fs.writeFileSync(dir + outName + ".txt", convertToPlainText(chapFile));
    }

    fs.writeFileSync(dir + "notes" + ".txt", convertToPlainText(project.notes));
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
    if (num < project.chapters.length){
        var chapFile = project.chapters[num].getFile();
        var outName = generateChapterFilename(num);

        quillToWord.generateWord(chapFile, {exportAs: 'buffer'}).then(doc => {
            fs.writeFileSync(dir + outName + ".docx", doc);
            exportChapsAsWord(dir, num + 1);
        });
    }
}

function exportNotesAsWord(dir){
    var chapFile = project.notes;

    quillToWord.generateWord(chapFile, {exportAs: 'buffer'}).then(doc => {
        fs.writeFileSync(dir + "notes" + ".docx", doc);
        });
}

function generateChapterFilename(num){
    return String(num + 1).padStart(4, '0') + "_" + project.chapters[num].title.replace(/[^a-z0-9]/gi, '_');
}