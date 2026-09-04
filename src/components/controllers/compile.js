const fs = require('fs');
const { convertDeltaToMDF } = require('./markdownFic');
const Quill = require('quill');
const { convertDeltaToDocx, saveDocx } = require('./delta-to-docx');
const { logError } = require('./error-log');
const { convertMdfcToHtmlPage, convertMdfcToHtml } = require('./mdfc-to-html');
const { convertMdfcToMd } = require('./mdfc-to-md');
const { htmlChaptersToEpub } = require('./epub');
const { convertToPlainText } = require('./quill-utils');

function compileProject(project, userSettings, options, filepath){
    var allChaps = compileChapterDeltas(project, options);

    switch(options.type){
        case ".txt":
            compilePlainText(filepath, allChaps);
            break;
        case ".docx":
            compileDocx(filepath, allChaps, options, project, userSettings);
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
            compileEpub(filepath, project.chapters, project.title, project.author, options.generateTitlePage, options.insertHead);
            break;
        default:
            console.log("No valid filetype selected for compile.");
    }
}

function compileEpub(dir, chapters, title, author, insertTitle, insertHead){
  try {
    var htmlChaps = [];

    chapters.forEach(function(chap){
      htmlChaps.push({
        title: chap.title,
        html: convertMdfcToHtml(convertDeltaToMDF(chapterDeltaWithHeader(chap, insertHead)))
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

function chapterDeltaWithHeader(chapter, insertHead){
  var Delta = Quill.import('delta');
  var compiled = new Delta();
  if(insertHead){
    compiled.insert(chapter.title);
    compiled.insert('\n', { header: 1 } );
  }
  return compiled.concat(new Delta(chapter.getContentsOrFile()));
}

function compileChapterDeltas(project, options){
    var divider = options.insertStrng;
    var Delta = Quill.import('delta');
    var compiled = new Delta().concat(chapterDeltaWithHeader(project.chapters[0], options.insertHead));

    for(let i=1; i<project.chapters.length; i++){
        compiled.insert(divider + '\n');
        compiled = compiled.concat(chapterDeltaWithHeader(project.chapters[i], options.insertHead));
    }

    return compiled;
}


function compileDocx(filepath, delt, options, project, userSettings) {
  try{
    var doc = convertDeltaToDocx(delt, options, project, userSettings.addressInfo);
    saveDocx(filepath, doc);
  }
  catch(err){
    logError(err);
  }
}

module.exports = {
  compileProject,
  compileChapterDeltas
}