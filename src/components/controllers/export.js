const fs = require('fs');
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
const notesNamePrepend = '-notes_';

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

    if(!fs.existsSync(dir))
        fs.mkdirSync(dir);

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
        var chapNumber = i < project.chapters.length ? i : i - project.chapters.length;
        var outName = generateChapterFilename(chapNumber, chap.title, options.what);

        if(project.trash.includes(chap))
          outName = '-trash_' + outName;
        else if(i > project.chapters.length - 1)
          outName = '-ref_' + outName;

        exportChapter(project, chap.title, project.author, chapFile, dir + outName, userSettings, options, taskStarted, taskDone, totalWordCount);

        var chapNotesDelta = await chap.getNotesContentOrFile();

        if(chapNotesDelta)
          exportChapter(project, chap.title + ' Notes', project.author, chapNotesDelta, dir + notesNamePrepend + outName, userSettings, options, taskStarted, taskDone, totalWordCount);
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
          exportChapter(project, 'Project Notes', project.author, projectNotesDelta, dir + notesNamePrepend + 'project_', userSettings, options, taskStarted, taskDone, totalWordCount);
      }
      catch(err){
        errorCount++;
        logError(err);
      }

      try{
        var corkboardMd = getCorkboardForExport(project.directory + project.chapsDirectory, options);
        if(corkboardMd){
          //Override heading styles for just this document since it is not a chapter
          options.styleHeadingAsChapter = false;
          exportChapter(project, 'Project Corkboard', project.author, parseMDF(corkboardMd), dir + notesNamePrepend + 'corkboard', userSettings, options, taskStarted, taskDone, totalWordCount);
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

function exportChapter(project, chapterTitle, author, chapDelta, filepathNameNoExt, userSettings, options, taskStarted, taskDone, totalWordCount){
  switch(options.type){
        case ".txt":
            exportChapAsText(project.title, chapterTitle, author, chapDelta, filepathNameNoExt, options.generateTitlePage);
            break;
        case ".docx":
            exportChapAsDocx(project, userSettings.addressInfo, chapDelta, filepathNameNoExt, options, taskStarted, taskDone, totalWordCount);
            break;
        case ".mdfc":
            exportChapAsMdf(project.title, chapterTitle, author, chapDelta, filepathNameNoExt, options.generateTitlePage);
            break;
        case ".md":
            exportChapAsMd(project.title, chapterTitle, author, chapDelta, filepathNameNoExt, options.generateTitlePage);
            break;
        case ".html":
            exportChapAsHtml(project.title, chapterTitle, author, chapDelta, filepathNameNoExt, options.generateTitlePage);
            break;
        case ".epub":
            exportChapAsEpub(project.title, chapterTitle, author, chapDelta, filepathNameNoExt, options.generateTitlePage, taskStarted, taskDone);
            break;
        default:
            console.log("No valid filetype selected for export.");
    }
}

function exportChapAsText(projectTitle, chapTitle, author, chapDelta, filepathNameNoExt, generateTitlePage){
  fs.writeFileSync(filepathNameNoExt + ".txt", convertToPlainText(chapDelta));
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

function exportChapAsMdf(projectTitle, chapTitle, author, chapDelta, filepathNameNoExt, generateTitlePage){
  fs.writeFileSync(filepathNameNoExt + '.mdfc', convertDeltaToMDF(chapDelta));
}

function exportChapAsMd(projectTitle, chapTitle, author, chapDelta, filepathNameNoExt, generateTitlePage){
  fs.writeFileSync(filepathNameNoExt + '.md', convertMdfcToMd(convertDeltaToMDF(chapDelta)));
}

function exportChapAsHtml(projectTitle, chapTitle, author, chapDelta, filepathNameNoExt, generateTitlePage){
  fs.writeFileSync(filepathNameNoExt + '.html', convertMdfcToHtmlPage(convertDeltaToMDF(chapDelta), projectTitle + ": " + chapTitle, author, generateTitlePage));
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