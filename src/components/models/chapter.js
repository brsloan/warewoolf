const fs = require('fs');
const { logError } = require('../controllers/error-log');
const { parseMDF, convertDeltaToMDF } = require('../controllers/markdownFic');
const { sanitizeFilename } = require('../controllers/utils');
const notesNamePrepend = '-notes_';

//A chapter's files live in its project's chapters directory, so every file operation below needs
//the project that owns it. It arrives here as an argument rather than being read off a bare
//`project` global, which is what this used to do - the app happened to supply one only because
//render.js is loaded as a plain <script> tag, so its top-level `var project` landed on `window`.
//Nothing outside that one arrangement could use this model at all, and the tests had to hand-set a
//global to stand in for it.
function newChapter(parentProject){
    return {
      parentProject: parentProject || null,
      title: "new",
      filename: null,
      filter: null,
      contents: null,
      summary: null,
      hasUnsavedChanges: null,
      notes: null,
      deleteFile: deleteChapterFile,
      parseChapter: parseChapter,
      getFile: getFile,
      saveFile: saveFile,
      saveCopy: saveCopy,
      getContentsOrFile: getContentsOrFile,
      getNotesFile: getNotesFile,
      getNotesContentOrFile: getNotesContentOrFile,
      saveNotesFile: saveNotesFile
    };

    //Resolved on each use rather than captured once, because Save As moves a project (and every
    //chapter in it) to a new directory in place.
    function chaptersDirectory(chap){
      if(!chap.parentProject)
        throw new Error('Chapter "' + chap.title + '" has no parent project, so its file path cannot be resolved.');

      return chap.parentProject.directory + chap.parentProject.chapsDirectory;
    }

    function deleteChapterFile(){
      var chap = this;
      try{
        const filepathRoot = chaptersDirectory(chap);
        if(fs.existsSync(filepathRoot + chap.filename))
          fs.unlinkSync(filepathRoot + chap.filename);
        if(fs.existsSync(filepathRoot + notesNamePrepend + chap.filename))
          fs.unlinkSync(filepathRoot + notesNamePrepend + chap.filename);
      }
      catch(err){
        logError(err);
      }
    }

    //The saved form of a chapter carries no parentProject (project.js strips it, since it is a
    //reference back up), but restore it explicitly so a stray one in an old file cannot replace the
    //project this chapter was actually built for.
    function parseChapter(chap){
      var owner = this.parentProject;
      Object.assign(this, chap);
      this.parentProject = owner;
      return this;
    }

    function getFile(){
      try{
        var chap = this;
        
        //Temporarily support both old chapter JSON files (.pup) and new markdown (.txt)
        var chapterObj;
        var fileText = fs.readFileSync(chaptersDirectory(chap) + chap.filename, "utf8");
        if(chap.filename.includes('.pup'))
          chapterObj = JSON.parse(fileText);
        else
          chapterObj = parseMDF(fileText);

        return chapterObj;
      }
      catch(err){
        logError(err);
      }
    }

    function getContentsOrFile(){
      var chap = this;

      var cont = chap.contents ? chap.contents : null;
      if(cont == null && chap.filename != null)
        cont = chap.getFile();

      return cont;
    }

    function getNotesContentOrFile(){
      var chap = this;

      var notes = chap.notes ? chap.notes : null;
      if(notes == null && chap.filename != null)
        notes = chap.getNotesFile();

      return notes;
    }


    function saveCopy(){
      try{
        var chap = this;
        var newFilename = getNewFilename(chaptersDirectory(chap), chap.title);

        fs.writeFileSync(chaptersDirectory(chap) + newFilename, convertDeltaToMDF(chap.contents), "utf8")

        //Only point the chapter at the new file once the write has actually succeeded
        chap.filename = newFilename;
      }
      catch(err){
        logError(err);
      }
    }

    function saveFile(){
      try{
        const oldVersionFlag = 'old_v_temp';
        var chap = this;
        const filepathRoot = chaptersDirectory(chap);

        if(chap.contents == null && chap.filename != null)
          chap.contents = chap.getFile();

        //Because I'm paranoid about the tiny possibility of something going wrong between deleting old verison of file and creating new,
        //we rename the old version with the oldVersionFlag, create new version, verify success, THEN delete old version
        var oldFilename = chap.filename;
        if(oldFilename != undefined && oldFilename != null && fs.existsSync(filepathRoot + oldFilename))
          fs.renameSync(filepathRoot + oldFilename, filepathRoot + oldVersionFlag + oldFilename);

        var newFilename = getNewFilename(filepathRoot, chap.title);

        try{
          fs.writeFileSync(filepathRoot + newFilename, convertDeltaToMDF(chap.contents), "utf8")
        }
        catch(writeErr){
          //Write failed - put the old version back so the chapter isn't left without a file on disk
          if(oldFilename != undefined && oldFilename != null && fs.existsSync(filepathRoot + oldVersionFlag + oldFilename))
            fs.renameSync(filepathRoot + oldVersionFlag + oldFilename, filepathRoot + oldFilename);
          throw writeErr;
        }

        //Only point the chapter at the new file once the write has actually succeeded
        chap.filename = newFilename;

        //If filename has changed and new file successfully created, delete old file
        if(oldFilename != undefined && oldFilename != null && fs.existsSync(filepathRoot + oldVersionFlag + oldFilename)){
          try{
            fs.unlinkSync(filepathRoot + oldVersionFlag + oldFilename);
          }
          catch(unlinkErr){
            logError(unlinkErr);
          }
        }

        //If filename has changed and notes exist, rename notes to match
        if(oldFilename != undefined && oldFilename != null && oldFilename != chap.filename){
          if(fs.existsSync(filepathRoot + notesNamePrepend + oldFilename)){
            fs.renameSync(filepathRoot + notesNamePrepend + oldFilename, filepathRoot + notesNamePrepend + chap.filename);
          }
        }
        
        chap.contents = null;
      
        chap.hasUnsavedChanges = false;
        if(chap.notes != null){
          chap.saveNotesFile();
        }
      }
      catch(err){
        logError(err);
      }
    }

    function getNotesFile(){
      try{
        var chap = this;
        var fullNotesPath = chaptersDirectory(chap) + notesNamePrepend + chap.filename;

        var fileText = null;
        if(fs.existsSync(fullNotesPath)){
          fileText = fs.readFileSync(fullNotesPath, "utf8");
        }
        

        return fileText ? parseMDF(fileText) : null;
      }
      catch(err){
        logError(err);
      }
    }

    function saveNotesFile(){
      try{
        var chap = this;
        const filepathRoot = chaptersDirectory(chap);

        if(chap.notes != null)
          fs.writeFileSync(filepathRoot + notesNamePrepend + chap.filename, convertDeltaToMDF(chap.notes), "utf8")

        chap.notes = null;
        chap.hasUnsavedChanges = false;
      }
      catch(err){
        logError(err);
      }
    }
    

  function getNewFilename(chaptersDir, title){
    
    const fileExt = '.txt';    
    var copyNum = 1;
    var filenameRoot = sanitizeFilename(title && title != '' ? title : 'untitled');
    var filename = filenameRoot + fileExt;

    while(fs.existsSync(chaptersDir + filename)){
      copyNum++;
      filename = filenameRoot + '_' + copyNum + fileExt;
    }
    
    return filename;
  }

}

module.exports = newChapter;