const fs = require('fs');
const { convertDeltaToMDF } = require('./markdownFic');
const { logError } = require('./error-log');
const { convertDeltaToDocx, saveDocx } = require('./delta-to-docx');
const { sanitizeFilename } = require('./utils');
const { convertMdfcToHtmlPage, convertMdfcToHtml } = require('./mdfc-to-html');
const { convertMdfcToMd } = require('./mdfc-to-md');
const { htmlChaptersToEpub } = require('./epub');
const notesNamePrepend = '-notes_';

function exportProject(project, userSettings, options, filepath){
    //TODO: Need to create function to safely convert titles to folder/filenames
    var dirName = project.title.length > 0 ? project.title.replace(/[^a-z0-9]/gi, '_') : 'exports';
    var newDir = filepath.concat("/").concat(dirName).concat("/");

    if(!fs.existsSync(newDir))
        fs.mkdirSync(newDir);

    switch(options.type){
        case ".txt":
            exportAsText(project, newDir, options.what);
            break;
        case ".docx":
            exportAsWord(project, userSettings, newDir, options.what);
            break;
        case ".mdfc":
            exportAsMDF(project, newDir, options.what);
            break;
        case ".md":
            exportAsMd(project, newDir, options.what);
            break;
        case ".html":
            exportAsHtml(project, newDir, options.what);
            break;
        case ".epub":
            exportAsEpub(project, userSettings, newDir, options.what);
            break;
        default:
            console.log("No valid filetype selected for export.");
    }
}

function exportAsEpub(project, userSettings, dir, what){
  try{
    var chapsToExport = what == 'project' ? project.chapters.concat(project.reference) : [ project.getActiveChapter() ];
    for(let i=0;i<chapsToExport.length;i++){
      var chapFile = chapsToExport[i].getContentsOrFile();
      var chapNumber = i < project.chapters.length ? i : i - project.chapters.length;
      var outName = generateChapterFilename(chapNumber, chapsToExport[i].title, what);

      if(i > project.chapters.length - 1)
        outName = '-ref_' + outName;

      var htmlChap = {
        title: chapsToExport[i].title,
        html: convertMdfcToHtml(convertDeltaToMDF(chapFile))
      }

      htmlChaptersToEpub(project.title + ': ' + chapsToExport[i].title, project.author, [htmlChap], dir + outName + '.epub', userSettings.compileGenTitlePage, function(resp){
        console.log('epub exported: ' + resp);
      });

      var chapNotesDelta = chapsToExport[i].getNotesContentOrFile();

      if(chapNotesDelta){
        var htmlChapNotes = {
          title: chapsToExport[i].title + ' Notes',
          html: convertMdfcToHtml(convertDeltaToMDF(chapNotesDelta))
        }
        htmlChaptersToEpub(project.title + ': ' + chapsToExport[i].title + ' Notes', project.author, [htmlChapNotes], dir + notesNamePrepend + outName + '.epub', userSettings.compileGenTitlePage, function(resp){
          console.log('epub exported: ' + resp);
        });
  
      }
    }

    if(what == 'project'){
      var projectNotesDelta = project.notesChap.getNotesContentOrFile();
      if(projectNotesDelta){
        var htmlChap = {
          title: 'Project Notes',
          html: convertMdfcToHtml(convertDeltaToMDF(projectNotesDelta))
        }

        htmlChaptersToEpub('Project Notes', project.author, [htmlChap], dir + notesNamePrepend + 'project_.epub', userSettings.compileGenTitlePage, function(resp){
          console.log('epub exported: ' + resp);
        });
      }
    }

  }
  catch(err){
    logError(err);
  }
}

function getAllChapNotes(proj){
  return proj.chapters.map(function(chap){
    return chap.getNotesContentOrFile();
  }).filter(function(note){
    return note != null;
  });
}

function exportAsHtml(project, dir, what){
  try{
    var chapsToExport = what == 'project' ? project.chapters.concat(project.reference) : [ project.getActiveChapter() ];
    for(let i=0; i < chapsToExport.length; i++){
      var chapFile = chapsToExport[i].getContentsOrFile();
      var chapNumber = i < project.chapters.length ? i : i - project.chapters.length;
      var outName = generateChapterFilename(chapNumber, chapsToExport[i].title, what);

      if(i > project.chapters.length - 1)
        outName = '-ref_' + outName;

      fs.writeFileSync(dir + outName + '.html', convertMdfcToHtmlPage(convertDeltaToMDF(chapFile), project.title + ": " + chapsToExport[i].title));

      var chapNotesDelta = chapsToExport[i].getNotesContentOrFile();
      if(chapNotesDelta){
        fs.writeFileSync(dir + notesNamePrepend + outName + '.html', convertMdfcToHtmlPage(convertDeltaToMDF(chapNotesDelta), project.title + ": " + chapsToExport[i].title + ' Notes'));  
      }
    }

    if(what == 'project'){
      var projectNotesDelta = project.notesChap.getNotesContentOrFile();
      if(projectNotesDelta)
        fs.writeFileSync(dir + notesNamePrepend + "project_" + ".html", convertMdfcToHtmlPage(convertDeltaToMDF(projectNotesDelta), project.title + ": " + 'Notes'));
    }
  }
  catch(err){
    logError(err);
  }
}

function exportAsMd(project, dir, what){
  try{
    var chapsToExport = what == 'project' ? project.chapters.concat(project.reference) : [ project.getActiveChapter() ];
    for(let i=0; i < chapsToExport.length; i++){
      var chapFile = chapsToExport[i].getContentsOrFile();
      var chapNumber = i < project.chapters.length ? i : i - project.chapters.length;
      var outName = generateChapterFilename(chapNumber, chapsToExport[i].title, what);

      if(i > project.chapters.length - 1)
        outName = '-ref_' + outName;

      fs.writeFileSync(dir + outName + '.md', convertMdfcToMd(convertDeltaToMDF(chapFile)));

      var chapNotesDelta = chapsToExport[i].getNotesContentOrFile();
      if(chapNotesDelta)
        fs.writeFileSync(dir + notesNamePrepend + outName + '.md', convertMdfcToMd(convertDeltaToMDF(chapNotesDelta)));
    }

    if(what == 'project'){
      var projectNotesDelta = project.notesChap.getNotesContentOrFile();
      if(projectNotesDelta)
        fs.writeFileSync(dir + notesNamePrepend + "project_" + ".md", convertMdfcToMd(convertDeltaToMDF(projectNotesDelta)));
    }
      
  }
  catch(err){
    logError(err);
  }
}

function exportAsMDF(project, dir, what){
  try{
    var chapsToExport = what == 'project' ? project.chapters.concat(project.reference) : [ project.getActiveChapter() ];
    for(let i=0; i < chapsToExport.length; i++){
      var chapFile = chapsToExport[i].getContentsOrFile();
      var chapNumber = i < project.chapters.length ? i : i - project.chapters.length;
      var outName = generateChapterFilename(chapNumber, chapsToExport[i].title, what);

      if(i > project.chapters.length - 1)
        outName = '-ref_' + outName;

      fs.writeFileSync(dir + outName + '.mdfc', convertDeltaToMDF(chapFile));

      var chapNotesDelta = chapsToExport[i].getNotesContentOrFile();
      if(chapNotesDelta){
        fs.writeFileSync(dir + notesNamePrepend + outName + '.mdfc', convertDeltaToMDF(chapNotesDelta));
      }
    }

    if(what == 'project'){
      var projectNotesDelta = project.notesChap.getNotesContentOrFile();
      if(projectNotesDelta)
        fs.writeFileSync(dir + notesNamePrepend + "project_" + ".mdfc", convertDeltaToMDF(projectNotesDelta));
    }
      
  }
  catch(err){
    logError(err);
  }
}

function exportAsText(project, dir, what){
  try{
    var chapsToExport = what == 'project' ? project.chapters.concat(project.reference) : [ project.getActiveChapter() ];
    for(i=0; i<chapsToExport.length; i++){
        var chapFile = chapsToExport[i].getContentsOrFile();
        var chapNumber = i < project.chapters.length ? i : i - project.chapters.length;
        var outName = generateChapterFilename(chapNumber, chapsToExport[i].title, what);

        if(i > project.chapters.length - 1)
          outName = '-ref_' + outName;
       
        fs.writeFileSync(dir + outName + ".txt", convertToPlainText(chapFile));

        var chapNotesDelta = chapsToExport[i].getNotesContentOrFile();
        if(chapNotesDelta)
          fs.writeFileSync(dir + notesNamePrepend + outName + ".txt", convertToPlainText(chapNotesDelta));
    }

    if(what == 'project'){
      var projectNotesDelta = project.notesChap.getNotesContentOrFile();
      if(projectNotesDelta)
         fs.writeFileSync(dir + notesNamePrepend + "project_" + ".txt", convertToPlainText(projectNotesDelta));
    }
  }
  catch(err){
    logError(err);
  }
}

function convertToPlainText(delt){
  var text = '';
  delt.ops.forEach(op => {
    text += op.insert;
  });
  return text;
}

function exportAsWord(project, userSettings, dir, what){
    exportChapsAsWord(project, userSettings, dir, what);
    if(what == 'project')
      exportNotesAsWord(project, userSettings, dir);
}

function exportChapsAsWord(project, userSettings, dir, what){
    var chapsToExport = what == 'project' ? project.chapters.concat(project.reference) : [ project.getActiveChapter() ];
    for(let i=0; i < chapsToExport.length;i++){
      var chapFile = chapsToExport[i].getContentsOrFile();
      var chapNumber = i < project.chapters.length ? i : i - project.chapters.length;
      var outName = generateChapterFilename(chapNumber, chapsToExport[i].title, what);

      if(i > project.chapters.length - 1)
        outName = '-ref_' + outName;

      var doc = convertDeltaToDocx(chapFile, { generateTitlePage: false }, project, userSettings);
      saveDocx(dir + outName + ".docx", doc);

      var chapNotesDelta = chapsToExport[i].getNotesContentOrFile();
    }
}

function exportNotesAsWord(project, userSettings, dir){
    var chapFile = project.notes;

    var doc = convertDeltaToDocx(chapFile, { generateTitlePage: false }, project, userSettings);
    saveDocx(dir + "notes" + ".docx", doc);
}

function generateChapterFilename(num, title, what){
    var prefix = what == 'project' ? String(num + 1).padStart(4, '0') + '_' : '';
    return prefix + sanitizeFilename(title);
}

module.exports = {
  exportProject
}