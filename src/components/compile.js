
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