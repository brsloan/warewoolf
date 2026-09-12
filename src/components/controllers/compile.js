const { convertDeltaToMDF } = require('./markdownFic');
const Quill = require('quill');
const { convertDeltaToDocx, saveDocx } = require('./delta-to-docx');
const { logError } = require('./error-log');
const { convertMdfcToHtmlPage, convertMdfcToHtml } = require('./mdfc-to-html');
const { convertMdfcToMd } = require('./mdfc-to-md');
const { htmlChaptersToEpub } = require('./epub');
const { convertToPlainText } = require('./quill-utils');
const { reconcileFootnotes, namespaceFootnotes } = require('./reconcile-footnotes');
const { getTotalWordCount } = require('./wordcount');
const { markSceneBreaks } = require('./mark-scene-breaks');
const { createPlatform } = require('./platform');
const { createIpcBacking } = require('./platform-ipc');

//writeTextFile takes no injected config - every path here is already a full path - so this holds
//its own standing instance, the same reason export.js/file-manager.js do.
var platform = createPlatform(createIpcBacking());

//Async because assembling the chapters reads any that are not already in memory off disk, which now
//goes through the platform facade. The callback is left exactly as it was: .epub finishes writing
//asynchronously through archiver and always did, so callers already wait on cback rather than on
//this function returning.
async function compileProject(project, userSettings, options, filepath, cback = function(){}){
    //Whole-project compile concatenates every chapter into one delta, so each chapter's own
    //footnote numbers collide (a five-chapter book would otherwise emit five notes numbered "1" -
    //duplicate id="fnote_1" anchors, wrong backlinks, delta-to-docx resolving every "[^1]" to the
    //first chapter's body). Reconciling the concatenated copy renumbers globally and fixes that;
    //the writer's own chapters, still separate deltas, are never touched.
    var allChaps = reconcileFootnotes(await compileChapterDeltas(project, options));

    switch(options.type){
        case ".txt":
            await compilePlainText(filepath, allChaps);
            cback();
            break;
        case ".docx":
            await compileDocx(filepath, allChaps, options, project, userSettings);
            cback();
            break;
        case ".mdfc":
            await compileMDF(filepath, allChaps);
            cback();
            break;
        case ".md":
            await compileMd(filepath, allChaps);
            cback();
            break;
        case ".html":
            await compileHtml(filepath, allChaps, project.title, project.author, options.generateTitlePage);
            cback();
            break;
          case ".epub":
            await compileEpub(filepath, project.chapters, project.title, project.author, options, cback);
            break;
        default:
            console.log("No valid filetype selected for compile.");
            cback();
    }
}

async function compileEpub(dir, chapters, title, author, options, cback = function(){}){
  try {
    var htmlChaps = [];

    for(let i = 0; i < chapters.length; i++){
      htmlChaps.push({
        title: chapters[i].title,
        html: convertMdfcToHtml(convertDeltaToMDF(await chapterDeltaWithHeader(chapters[i], options)))
      })
    }

    htmlChaptersToEpub(title, author, htmlChaps, dir, options.generateTitlePage, function(resp){
      console.log('Conversion done: ' + resp);
      cback();
    })

  }
  catch(err){
    logError(err);
    cback();
  }
}

async function compileHtml(dir, allChaps, title, author, insertTitle){
  try{
    var allText = convertMdfcToHtmlPage(convertDeltaToMDF(allChaps), title, author, insertTitle);
    await platform.writeTextFile({ path: dir, contents: allText });
  }
  catch(err){
    logError(err);
  }
}

async function compileMd(dir, allChaps){
  try{
    var allText = convertMdfcToMd(convertDeltaToMDF(allChaps));
    await platform.writeTextFile({ path: dir, contents: allText });
  }
  catch(err){
    logError(err);
  }
}

async function compileMDF(dir, allChaps){
  try{
    var allText = convertDeltaToMDF(allChaps);
    await platform.writeTextFile({ path: dir, contents: allText });
  }
  catch(err){
    logError(err);
  }
}

async function compilePlainText(dir, allChaps){
  try{
    var allText = convertToPlainText(allChaps);
    await platform.writeTextFile({ path: dir, contents: allText });
  }
  catch(err){
    logError(err);
  }
}

//Scene breaks are marked here, on one chapter at a time, rather than on the concatenated document
//compileChapterDeltas builds - which is what keeps the promise the option makes about the ends of
//chapters. Once every chapter is joined end to end, the blank lines a writer left trailing at the
//bottom of chapter one sit between two ordinary paragraphs like any other gap, and would be marked.
//Marked before the heading is prepended for the same reason: the heading is not part of the
//chapter's own text, and a chapter that opens on a blank line has nothing above it either way.
async function chapterDeltaWithHeader(chapter, options){
  var Delta = Quill.import('delta');
  var compiled = new Delta();
  if(options.insertHead){
    compiled.insert(chapter.title);
    compiled.insert('\n', { header: 1 } );
  }

  var contents = await chapter.getContentsOrFile();

  if(options.markSceneBreaks)
    contents = markSceneBreaks(contents);

  return compiled.concat(new Delta(contents));
}

//A single chapter numbers its own footnotes starting at 1, so two chapters concatenated as-is would
//each contribute a marker/body pair literally named "1" - indistinguishable, once merged, from one
//marker genuinely referenced twice. Each chapter's ids are namespaced by its own index before it
//joins the concatenated delta, so they stay globally unique going into compileProject's reconcile
//pass, which is what assigns the compiled document's real, sequential footnote numbers.
async function compileChapterDeltas(project, options){
    var divider = options.insertStrng;
    var Delta = Quill.import('delta');
    var compiled = new Delta().concat(new Delta(
      namespaceFootnotes(await chapterDeltaWithHeader(project.chapters[0], options), 'c0')
    ));

    for(let i=1; i<project.chapters.length; i++){
        compiled.insert(divider + '\n');
        compiled = compiled.concat(new Delta(
          namespaceFootnotes(await chapterDeltaWithHeader(project.chapters[i], options), 'c' + i)
        ));
    }

    return compiled;
}


//The manuscript title page carries a project-wide word count, which delta-to-docx no longer works
//out for itself - reading the chapters it needs is asynchronous now, and it is a document generator
//with no other I/O in it. Counted here, and only when a title page is actually being generated.
//
//Regression: saveDocx is fire-and-forget when called without a completion callback (its own
//docx.Packer promise chain keeps running after this function returns), so compileDocx used to call
//it bare - meaning compileProject's cback() could fire, and compile_display.js could report the
//compile done, while the .docx was still mid-write. Waiting on saveDocx's own completion callback
//closes that gap, the same property .epub already had via htmlChaptersToEpub's callback.
//
//Regression: the awaited result used to be discarded outright. saveDocx already logs the underlying
//failure itself (see delta-to-docx.js) and resolves with the string 'error' rather than rejecting -
//so with nothing checking that result, compileProject reached its unconditional cback() exactly as
//if the write had succeeded, and compile_display.js reported the compile done while the .docx did
//not exist on disk. Thrown instead, below the try/catch above it so this doesn't log the same
//failure a second time - it propagates through compileProject (uncaught there, same as any other
//rejection from a compile* function) to compile_display.js's own .catch, which already logs and
//still closes the "Working..." popup.
async function compileDocx(filepath, delt, options, project, userSettings) {
  var result;
  try{
    var totalWordCount = options && options.generateTitlePage ? await getTotalWordCount(project) : 0;
    var doc = convertDeltaToDocx(delt, options, project, userSettings.addressInfo, totalWordCount);

    result = await new Promise(function(resolve){
      saveDocx(filepath, doc, resolve);
    });
  }
  catch(err){
    logError(err);
    return;
  }

  if(result === 'error')
    throw new Error('compileDocx: saveDocx failed to write ' + filepath);
}

module.exports = {
  compileProject,
  compileChapterDeltas
}