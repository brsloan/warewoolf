const quillToWord = require('quill-to-word');

//*************Export Functions************

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
    var tempQuill = new Quill(document.createElement('div'), {
        modules: {
            history: {
            userOnly: true
            }
        }
        });

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

//***********Compile Functions */

function compileProject(options, filepath){
    console.log(options);
    console.log(filepath);
    var allChaps = compileChapterDeltas();

    switch(options.type){
        case ".txt":
            compilePlainText(filepath, allChaps);
            break;
        case ".docx":
            compileDocx(filepath, allChaps);
            break;
        default: 
            console.log("No valid filetype selected for compile.");
    }
}

function compileDocx(filepath, allChaps){
    quillToWord.generateWord(allChaps, {exportAs: 'buffer'}).then(doc => {
        fs.writeFileSync(filepath, doc);
        });
}

function compilePlainText(dir, allChaps){
    var allText = convertToPlainText(allChaps);
    fs.writeFileSync(dir, allText);
}

function compileChapterDeltas(divider = ''){
    var Delta = Quill.import('delta');
    var compiled = new Delta(project.chapters[0].getFile());

    for(i=1; i<project.chapters.length; i++){
        var thisDelta = new Delta(project.chapters[i].getFile());
        compiled.insert(divider + '\n');
        compiled = compiled.concat(thisDelta);
    }

    return compiled;
}