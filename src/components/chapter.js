



function newChapter(){
    return {
      title: "new",
      filename: null,
      filter: null,
      contents: null,
      hasUnsavedChanges: null,
      deleteFile: deleteChapterFile,
      parseChapter: parseChapter,
      getFile: getFile,
      saveFile: saveFile
    };

    function deleteChapterFile(){
      var chap = this;
      var indexToDelete = fakeFileSys.findIndex(function(f){
        return f.filename == chap.filename;
      });
      
      if(indexToDelete > -1)
        fakeFileSys.splice(indexToDelete, 1);
    }

    function parseChapter(chap){
      return Object.assign(this, chap);
    }

    function getFile(){
      var chap = this;

      var chapterObj = JSON.parse(fs.readFileSync("output/" + chap.filename, "utf8"));

      return chapterObj;
    }

    function saveFile(){
      var chap = this;

      if(chap.filename == undefined || chap.filename == null)
        chap.filename = getNewFilename();

      ipcRenderer.invoke('save-file', chap.filename, JSON.stringify(chap.contents));

      function getNewFilename(){
        var largestFilename = 0;
        fakeFileSys.forEach(function(ch){
          if(ch.filename != null){
            var nameNumber = parseInt(ch.filename.split(".")[0]);
            if(nameNumber > largestFilename)
              largestFilename = nameNumber;  
          }
        });
        return (largestFilename + 1).toString() + ".pup";
      }
    }
  }

  
