
function compileProject(options, filepath){
    console.log(options);
    console.log(filepath);
    var allChaps = compileChapterDeltas(options);

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

function compilePlainText(dir, allChaps){
    var allText = convertToPlainText(allChaps);
    fs.writeFileSync(dir, allText);
}

function compileChapterDeltas(options){
    var divider = options.insertStrng;
    var Delta = Quill.import('delta');
    var compiled = new Delta();
    if(options.insertHead){
      compiled.insert(project.chapters[0].title);
      compiled.insert('\n', { header: 1 } );
    }
    compiled = compiled.concat(new Delta(project.chapters[0].getFile()));

    for(i=1; i<project.chapters.length; i++){
        var thisDelta = new Delta(project.chapters[i].getFile());
        compiled.insert(divider + '\n');

        if(options.insertHead){
          compiled.insert(project.chapters[i].title);
          compiled.insert('\n', { header: 1 } );
        }

        compiled = compiled.concat(thisDelta);
    }

    return compiled;
}


function compileDocx(filepath, delt) {
  var doc = convertDeltaToDocx(delt);
  saveDocx(filepath, doc);
}
