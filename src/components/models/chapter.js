const fs = require('fs');
const { logError } = require('../controllers/error-log');
const { parseMDF, convertDeltaToMDF } = require('../controllers/markdownFic');
const { sanitizeFilename } = require('../controllers/utils');
const notesNamePrepend = '-notes_';

function newChapter(){
    return {
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

    function deleteChapterFile(){
      var chap = this;
      try{
        if(fs.existsSync(project.directory + project.chapsDirectory + chap.filename))
          fs.unlinkSync(project.directory + project.chapsDirectory + chap.filename);
      }
      catch(err){
        logError(err);
      }
    }

    function parseChapter(chap){
      return Object.assign(this, chap);
    }

    function getFile(){
      try{
        var chap = this;
        
        //Temporarily support both old chapter JSON files (.pup) and new markdown (.txt)
        var chapterObj;
        var fileText = fs.readFileSync(project.directory + project.chapsDirectory + chap.filename, "utf8");
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
        chap.filename = getNewFilename(chap.title); 

        fs.writeFileSync(project.directory + project.chapsDirectory + chap.filename, convertDeltaToMDF(chap.contents), "utf8")
      }
      catch(err){
        logError(err);
      }
    }

    function saveFile(){
      try{
        const oldVersionFlag = 'old_v_temp';
        var chap = this;
        const filepathRoot = project.directory + project.chapsDirectory;

        if(chap.contents == null)
          chap.contents = chap.getFile();

        //Because I'm paranoid about the tiny possibility of something going wrong between deleting old verison of file and creating new,
        //we rename the old version with the oldVersionFlag, create new version, verify success, THEN delete old version
        var oldFilename = chap.filename;
        if(oldFilename != undefined && oldFilename != null && fs.existsSync(filepathRoot + oldFilename))
          fs.renameSync(filepathRoot + oldFilename, filepathRoot + oldVersionFlag + oldFilename);

        chap.filename = getNewFilename(chap.title);

        fs.writeFileSync(filepathRoot + chap.filename, convertDeltaToMDF(chap.contents), "utf8")
        
        //If filename has changed and new file successfully created, delete old file
        if(oldFilename != undefined && oldFilename != null && fs.existsSync(filepathRoot + chap.filename) && fs.existsSync(filepathRoot + oldVersionFlag + oldFilename))
          fs.unlink(filepathRoot + oldVersionFlag + oldFilename, function(err){
            if(err)
              logError(err);
          });

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
        var fullNotesPath = project.directory + project.chapsDirectory + notesNamePrepend + chap.filename;

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
        const filepathRoot = project.directory + project.chapsDirectory;

        if(chap.notes == null)
          chap.notes = chap.getNotesFile();

        if(chap.notes != null)
          fs.writeFileSync(filepathRoot + notesNamePrepend + chap.filename, convertDeltaToMDF(chap.notes), "utf8")
        
        chap.notes = null;
      }
      catch(err){
        logError(err);
      }
    }
    

  function getNewFilename(title){
    
    const fileExt = '.txt';    
    var copyNum = 1;
    var filenameRoot = sanitizeFilename(title && title != '' ? title : 'untitled');
    var filename = filenameRoot + fileExt;

    while(fs.existsSync(project.directory + project.chapsDirectory + filename)){
      copyNum++;
      filename = filenameRoot + '_' + copyNum + fileExt;
    }
    
    return filename;
  }

}

module.exports = newChapter;