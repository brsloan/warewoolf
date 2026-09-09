const { convertDeltaToMDF, parseMDF } = require('./markdownFic');
const { logError } = require('./error-log');
const { convertDeltaToDocx, saveDocx } = require('./delta-to-docx');
const { sanitizeFilename } = require('./utils');
const { convertMdfcToHtmlPage, convertMdfcToHtml } = require('./mdfc-to-html');
const { convertMdfcToMd } = require('./mdfc-to-md');
const { htmlChaptersToEpub } = require('./epub');
const { getCorkboardForExport } = require('./corkboard');
const { convertToPlainText } = require('./quill-utils');
const { getTotalWordCount } = require('./wordcount');
const { markSceneBreaks } = require('./mark-scene-breaks');
const { createPlatform } = require('./platform');
const { createIpcBacking } = require('./platform-ipc');
const notesNamePrepend = '-notes_';

//Every command this module calls (ensureDirectory, writeTextFile) takes a full path and no
//injected config, so this holds its own standing instance, the same reason file-manager.js/
//epub.js/delta-to-docx.js do.
var platform = createPlatform(createIpcBacking());

//Unlike compile.js (which merges everything into a single output file), export.js is meant to
//write one output file per chapter/notes/corkboard item - that's the whole point of this module,
//so each chapter (including .epub) getting its own file is intentional, not a bug.
//
//.docx and .epub each finish writing asynchronously (docx.Packer's promise, an archiver stream),
//so exportProject can't just return when the loop below ends - cback (which callers use to know
//it's safe to report the export as done) has to wait for every outstanding async write too.
//pendingTasks/loopDone track that: taskStarted/taskDone bracket each async write, and cback only
//fires once the loop has finished queuing work AND every task it queued has completed.
//Async because reading a chapter that is not already in memory now goes through the platform
//facade. That does not replace the pendingTasks bookkeeping below: .docx and .epub still finish
//writing on their own callbacks after this function returns, so callers still wait on cback.
async function exportProject(project, userSettings, options, filepath, cback = function(){}){
  var errorCount = 0;
  var pendingTasks = 0;
  var loopDone = false;

  function taskStarted(){
    pendingTasks++;
  }

  function taskDone(failed){
    if(failed)
      errorCount++;
    pendingTasks--;
    if(loopDone && pendingTasks == 0)
      cback(errorCount);
  }

  try{
    var dirName = project.title.length > 0 ? sanitizeFilename(project.title) : 'exports';
    var dir = filepath.concat("/").concat(dirName).concat("/");

    await platform.ensureDirectory({ path: dir });

    //Counted once for the whole run, not once per chapter. The manuscript title page carries a
    //project-wide word count, which delta-to-docx no longer works out for itself - and it was being
    //recomputed inside every single chapter's conversion, re-reading the entire project each time.
    var totalWordCount = options.type == '.docx' && options.generateTitlePage
      ? await getTotalWordCount(project) : 0;

    var chapsToExport = options.what == 'project' ? project.chapters.concat(project.reference) : [ project.getActiveChapter() ];
    for(let i=0;i<chapsToExport.length;i++){
      //Each chapter is exported independently of the others, so one bad chapter (corrupt file,
      //parse failure) shouldn't stop the rest of the batch from being written.
      try{
        var chap = chapsToExport[i];
        var chapFile = await chap.getContentsOrFile();

        //Only the chapter's own text. Notes, the project notes and the corkboard go out through the
        //same exportChapter below, but none of them is manuscript - a hash dropped into the gap
        //between two notes would be marking a scene break that isn't there.
        if(options.markSceneBreaks)
          chapFile = markSceneBreaks(chapFile);

        var chapNumber = i < project.chapters.length ? i : i - project.chapters.length;
        var outName = generateChapterFilename(chapNumber, chap.title, options.what);

        if(project.trash.includes(chap))
          outName = '-trash_' + outName;
        else if(i > project.chapters.length - 1)
          outName = '-ref_' + outName;

        await exportChapter(project, chap.title, project.author, chapFile, dir + outName, userSettings, options, taskStarted, taskDone, totalWordCount);

        var chapNotesDelta = await chap.getNotesContentOrFile();

        if(chapNotesDelta)
          await exportChapter(project, chap.title + ' Notes', project.author, chapNotesDelta, dir + notesNamePrepend + outName, userSettings, options, taskStarted, taskDone, totalWordCount);
      }
      catch(err){
        errorCount++;
        logError(err);
      }
    }

    if(options.what == 'project'){
      try{
        var projectNotesDelta = await project.notesChap.getNotesContentOrFile();
        if(projectNotesDelta)
          await exportChapter(project, 'Project Notes', project.author, projectNotesDelta, dir + notesNamePrepend + 'project_', userSettings, options, taskStarted, taskDone, totalWordCount);
      }
      catch(err){
        errorCount++;
        logError(err);
      }

      try{
        var corkboardMd = await getCorkboardForExport(project.directory + project.chapsDirectory, options);
        if(corkboardMd){
          //Override heading styles for just this document since it is not a chapter
          options.styleHeadingAsChapter = false;
          await exportChapter(project, 'Project Corkboard', project.author, parseMDF(corkboardMd), dir + notesNamePrepend + 'corkboard', userSettings, options, taskStarted, taskDone, totalWordCount);
        }
      }
      catch(err){
        errorCount++;
        logError(err);
      }
    }

  }
  catch(err){
    errorCount++;
    logError(err);
  }

  loopDone = true;
  if(pendingTasks == 0)
    cback(errorCount);
}

//.txt/.mdfc/.md/.html are awaited directly rather than routed through taskStarted/taskDone: their
//writes are a single platform call each with no further async work of their own (unlike .docx and
//.epub, which finish on their own callback well after this returns), so awaiting them here is what
//keeps exportProject's loop - and therefore its own completion - from moving on before they land.
async function exportChapter(project, chapterTitle, author, chapDelta, filepathNameNoExt, userSettings, options, taskStarted, taskDone, totalWordCount){
  switch(options.type){
        case ".txt":
            await exportChapAsText(project.title, chapterTitle, author, chapDelta, filepathNameNoExt, options.generateTitlePage);
            break;
        case ".docx":
            exportChapAsDocx(project, userSettings.addressInfo, chapDelta, filepathNameNoExt, options, taskStarted, taskDone, totalWordCount);
            break;
        case ".mdfc":
            await exportChapAsMdf(project.title, chapterTitle, author, chapDelta, filepathNameNoExt, options.generateTitlePage);
            break;
        case ".md":
            await exportChapAsMd(project.title, chapterTitle, author, chapDelta, filepathNameNoExt, options.generateTitlePage);
            break;
        case ".html":
            await exportChapAsHtml(project.title, chapterTitle, author, chapDelta, filepathNameNoExt, options.generateTitlePage);
            break;
        case ".epub":
            exportChapAsEpub(project.title, chapterTitle, author, chapDelta, filepathNameNoExt, options.generateTitlePage, taskStarted, taskDone);
            break;
        default:
            console.log("No valid filetype selected for export.");
    }
}

async function exportChapAsText(projectTitle, chapTitle, author, chapDelta, filepathNameNoExt, generateTitlePage){
  await platform.writeTextFile({ path: filepathNameNoExt + ".txt", contents: convertToPlainText(chapDelta) });
}

function exportChapAsDocx(project, addressInfo, chapDelta, filepathNameNoExt, options, taskStarted, taskDone, totalWordCount){
  var doc = convertDeltaToDocx(chapDelta, options, project, addressInfo, totalWordCount);
  taskStarted();
  //taskStarted() has already been counted as pending, so a synchronous throw here (as opposed to
  //an async rejection, which saveDocx already reports through its own callback) must still reach
  //taskDone - otherwise pendingTasks never comes back down and cback never fires.
  try{
    saveDocx(filepathNameNoExt + ".docx", doc, function(result){
      taskDone(result === 'error');
    });
  }
  catch(err){
    logError(err);
    taskDone(true);
  }
}

async function exportChapAsMdf(projectTitle, chapTitle, author, chapDelta, filepathNameNoExt, generateTitlePage){
  await platform.writeTextFile({ path: filepathNameNoExt + '.mdfc', contents: convertDeltaToMDF(chapDelta) });
}

async function exportChapAsMd(projectTitle, chapTitle, author, chapDelta, filepathNameNoExt, generateTitlePage){
  await platform.writeTextFile({ path: filepathNameNoExt + '.md', contents: convertMdfcToMd(convertDeltaToMDF(chapDelta)) });
}

async function exportChapAsHtml(projectTitle, chapTitle, author, chapDelta, filepathNameNoExt, generateTitlePage){
  await platform.writeTextFile({
    path: filepathNameNoExt + '.html',
    contents: convertMdfcToHtmlPage(convertDeltaToMDF(chapDelta), projectTitle + ": " + chapTitle, author, generateTitlePage)
  });
}

function exportChapAsEpub(projectTitle, chapTitle, author, chapDelta, filepathNameNoExt, generateTitlePage, taskStarted, taskDone){
  var htmlChap = {
        title: chapTitle,
        html: convertMdfcToHtml(convertDeltaToMDF(chapDelta))
      }

  taskStarted();
  //Same reasoning as exportChapAsDocx: guard against a synchronous throw leaving pendingTasks
  //stuck above zero forever.
  try{
    htmlChaptersToEpub(projectTitle + ': ' + chapTitle, author, [htmlChap], filepathNameNoExt + '.epub', generateTitlePage, function(resp){
      console.log('epub exported: ' + resp);
      taskDone(resp === 'error');
    });
  }
  catch(err){
    logError(err);
    taskDone(true);
  }
}

function generateChapterFilename(num, title, what){
    var prefix = what == 'project' ? String(num + 1).padStart(4, '0') + '_' : '';
    return prefix + sanitizeFilename(title);
}

module.exports = {
  exportProject
}