const fs = require('fs');
const markdownFic = require('./markdownFic');
const Quill = require('quill');
const { convertDeltaToDocx, saveDocx } = require('./delta-to-docx');
const { logError } = require('./error-log');

function compileProject(project, options, filepath){
    console.log(options);
    console.log(filepath);
    var allChaps = compileChapterDeltas(project, options);

    switch(options.type){
        case ".txt":
            compilePlainText(filepath, allChaps);
            break;
        case ".docx":
            compileDocx(filepath, allChaps, options);
            break;
        case ".mdfc":
            compileMDF(filepath, allChaps);
            break;
        default:
            console.log("No valid filetype selected for compile.");
    }
}

function compileMDF(dir, allChaps){
  try{
    var allText = markdownFic().convertDeltaToMDF(allChaps);
    fs.writeFileSync(dir, allText);
  }
  catch(err){
    logError(err);
  }
}

function compilePlainText(dir, allChaps){
  try{
    var allText = convertToPlainText(allChaps);
    fs.writeFileSync(dir, allText);
  }
  catch(err){
    logError(err);
  }
}

function compileChapterDeltas(project, options){
    var divider = options.insertStrng;
    var Delta = Quill.import('delta');
    var compiled = new Delta();
    if(options.insertHead){
      compiled.insert(project.chapters[0].title);
      compiled.insert('\n', { header: 1 } );
    }
    compiled = compiled.concat(new Delta(project.chapters[0].getContentsOrFile()));

    for(i=1; i<project.chapters.length; i++){
        var thisDelta = new Delta(project.chapters[i].getContentsOrFile());
        compiled.insert(divider + '\n');

        if(options.insertHead){
          compiled.insert(project.chapters[i].title);
          compiled.insert('\n', { header: 1 } );
        }

        compiled = compiled.concat(thisDelta);
    }

    return compiled;
}


function compileDocx(filepath, delt, options) {
  var doc = convertDeltaToDocx(delt, options, project, userSettings);
  saveDocx(filepath, doc);
}

function convertToPlainText(delt){
  var text = '';
  delt.ops.forEach(op => {
    text += op.insert;
  });
  return text;
}

module.exports = {
  compileProject,
  compileChapterDeltas
}