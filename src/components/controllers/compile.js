const fs = require('fs');
const { convertDeltaToMDF } = require('./markdownFic');
const Quill = require('quill');
const { convertDeltaToDocx, saveDocx } = require('./delta-to-docx');
const { logError } = require('./error-log');
const { convertMdfcToHtmlPage, convertMdfcToHtml } = require('./mdfc-to-html');
const { convertMdfcToMd } = require('./mdfc-to-md');
const { htmlChaptersToEpub } = require('./epub');
const { convertToPlainText } = require('./quill-utils');
const { getTotalWordCount } = require('./wordcount');

//Async because assembling the chapters reads any that are not already in memory off disk, which now
//goes through the platform facade. The callback is left exactly as it was: .epub finishes writing
//asynchronously through archiver and always did, so callers already wait on cback rather than on
//this function returning.
async function compileProject(project, userSettings, options, filepath, cback = function(){}){
    var allChaps = await compileChapterDeltas(project, options);

    switch(options.type){
        case ".txt":
            compilePlainText(filepath, allChaps);
            cback();
            break;
        case ".docx":
            await compileDocx(filepath, allChaps, options, project, userSettings);
            cback();
            break;
        case ".mdfc":
            compileMDF(filepath, allChaps);
            cback();
            break;
        case ".md":
            compileMd(filepath, allChaps);
            cback();
            break;
        case ".html":
            compileHtml(filepath, allChaps, project.title, project.author, options.generateTitlePage);
            cback();
            break;
          case ".epub":
            await compileEpub(filepath, project.chapters, project.title, project.author, options.generateTitlePage, options.insertHead, cback);
            break;
        default:
            console.log("No valid filetype selected for compile.");
            cback();
    }
}

async function compileEpub(dir, chapters, title, author, insertTitle, insertHead, cback = function(){}){
  try {
    var htmlChaps = [];

    for(let i = 0; i < chapters.length; i++){
      htmlChaps.push({
        title: chapters[i].title,
        html: convertMdfcToHtml(convertDeltaToMDF(await chapterDeltaWithHeader(chapters[i], insertHead)))
      })
    }

    htmlChaptersToEpub(title, author, htmlChaps, dir, insertTitle, function(resp){
      console.log('Conversion done: ' + resp);
      cback();
    })

  }
  catch(err){
    logError(err);
    cback();
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

async function chapterDeltaWithHeader(chapter, insertHead){
  var Delta = Quill.import('delta');
  var compiled = new Delta();
  if(insertHead){
    compiled.insert(chapter.title);
    compiled.insert('\n', { header: 1 } );
  }
  return compiled.concat(new Delta(await chapter.getContentsOrFile()));
}

async function compileChapterDeltas(project, options){
    var divider = options.insertStrng;
    var Delta = Quill.import('delta');
    var compiled = new Delta().concat(await chapterDeltaWithHeader(project.chapters[0], options.insertHead));

    for(let i=1; i<project.chapters.length; i++){
        compiled.insert(divider + '\n');
        compiled = compiled.concat(await chapterDeltaWithHeader(project.chapters[i], options.insertHead));
    }

    return compiled;
}


//The manuscript title page carries a project-wide word count, which delta-to-docx no longer works
//out for itself - reading the chapters it needs is asynchronous now, and it is a document generator
//with no other I/O in it. Counted here, and only when a title page is actually being generated.
async function compileDocx(filepath, delt, options, project, userSettings) {
  try{
    var totalWordCount = options && options.generateTitlePage ? await getTotalWordCount(project) : 0;
    var doc = convertDeltaToDocx(delt, options, project, userSettings.addressInfo, totalWordCount);
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