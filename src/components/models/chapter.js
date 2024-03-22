const fs = require('fs');
const { logError } = require('../controllers/error-log');
const { parseMDF, convertDeltaToMDF } = require('../controllers/markdownFic');
const { sanitizeFilename } = require('../controllers/utils');

function newChapter(){
    return {
      title: "new",
      filename: null,
      filter: null,
      contents: null,
      summary: null,
      hasUnsavedChanges: null,
      deleteFile: deleteChapterFile,
      parseChapter: parseChapter,
      getFile: getFile,
      saveFile: saveFile,
      saveCopy: saveCopy,
      getContentsOrFile: getContentsOrFile
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
        var chap = this;
        if(chap.contents !== null){
          var oldFilename = chap.filename;
          const filepathRoot = project.directory + project.chapsDirectory;

          chap.filename = getNewFilename(chap.title);

          fs.writeFileSync(filepathRoot + chap.filename, convertDeltaToMDF(chap.contents), "utf8")
          
          //If filename has changed and new file successfully created, delete old file
          if(oldFilename != undefined && oldFilename != null && fs.existsSync(filepathRoot + chap.filename) && fs.existsSync(filepathRoot + oldFilename))
            fs.unlink(filepathRoot + oldFilename, function(err){
              if(err)
                logError(err);
            });
          
          chap.contents = null;
        }
        chap.hasUnsavedChanges = false;
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