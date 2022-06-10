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
      saveCopy: saveCopy
    };

    function deleteChapterFile(){
      var chap = this;

      fs.unlinkSync(project.directory + chap.filename);
    }

    function parseChapter(chap){
      return Object.assign(this, chap);
    }

    function getFile(){
      try{
        var chap = this;

        var chapterObj = JSON.parse(fs.readFileSync(project.directory + project.chapsDirectory + chap.filename, "utf8"));

        return chapterObj;
      }
      catch(err){
        logError(err);
      }
    }


    function saveCopy(){
      try{
        var chap = this;

        var filename = chap.filename == undefined || chap.filename == null ? getNewFilename() : chap.filename;


        fs.writeFileSync(project.directory + project.chapsDirectory + filename, JSON.stringify(chap.contents), "utf8");


        function getNewFilename(){
          var largestFilename = 0;

          fs.readdirSync(project.directory + project.chapsDirectory).forEach(file => {
            var nameNumber = parseInt(file.split(".")[0]);
            if(nameNumber > largestFilename)
              largestFilename = nameNumber;
          });

          return (largestFilename + 1).toString() + ".pup";
        }
      }
      catch(err){
        logError(err);
      }
    }

    function saveFile(){
      try{
        var chap = this;

        if(chap.filename == undefined || chap.filename == null)
          chap.filename = getNewFilename();

        fs.writeFileSync(project.directory + project.chapsDirectory + chap.filename, JSON.stringify(chap.contents), "utf8");
        chap.contents = null;
        chap.hasUnsavedChanges = false;


        function getNewFilename(){
          var largestFilename = 0;

          fs.readdirSync(project.directory + project.chapsDirectory).forEach(file => {
            var nameNumber = parseInt(file.split(".")[0]);
            if(nameNumber > largestFilename)
              largestFilename = nameNumber;
          });

          return (largestFilename + 1).toString() + ".pup";
        }
      }
      catch(err){
        logError(err);
      }
  }
}
