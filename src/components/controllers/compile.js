const fs = require('fs');
const { convertDeltaToMDF } = require('./markdownFic');
const Quill = require('quill');
const { convertDeltaToDocx, saveDocx } = require('./delta-to-docx');
const { logError } = require('./error-log');
const { convertMdfcToHtmlPage, convertMdfcToHtml } = require('./mdfc-to-html');
const { convertMdfcToMd } = require('./mdfc-to-md');
const { htmlChaptersToEpub } = require('./epub');

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
        case ".md":
            compileMd(filepath, allChaps);
            break;
        case ".html":
            compileHtml(filepath, allChaps, project.title, project.author, options.generateTitlePage);
            break;
          case ".epub":
            compileEpub(filepath, project.chapters, project.title, project.author, options.generateTitlePage);
            break;
        default:
            console.log("No valid filetype selected for compile.");
    }
}

function compileEpub(dir, allChaps, title, author, insertTitle){
  try {
    var htmlChaps = [];

    allChaps.forEach(function(chap){
      htmlChaps.push({
        title: chap.title,
        html: convertMdfcToHtml(convertDeltaToMDF(chap.getContentsOrFile()))
      })
    })

    htmlChaptersToEpub(title, author, htmlChaps, dir, insertTitle, function(resp){
      console.log('Conversion done: ' + resp);
    })

  }
  catch(err){
    logError(err);
  }
}

function compileHtml(dir, allChaps, title, author, insertTitle){
  try{
    var allText = convertMdfcToHtmlPage(convertDeltaToMDF(allChaps), title, author, insertTitle);
    fs.writeFileSync(dir, allText);
  }
  catch(err){
    logError(err);
  }
}

function compileMd(dir, allChaps){
  try{
    var allText = convertMdfcToMd(convertDeltaToMDF(allChaps));
    fs.writeFileSync(dir, allText);
  }
  catch(err){
    logError(err);
  }
}

function compileMDF(dir, allChaps){
  try{
    var allText = convertDeltaToMDF(allChaps);
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
  var doc = convertDeltaToDocx(delt, options, project, userSettings.addressInfo);
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