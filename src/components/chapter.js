



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
      saveFile: saveFile,
      saveFileNew: saveFileNew
    };

    function deleteChapterFile(){
      var chap = this;

      fs.unlinkSync("output/" + chap.filename);
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

        fs.readdirSync("./output/").forEach(file => {
          var nameNumber = parseInt(file.split(".")[0]);
          if(nameNumber > largestFilename)
            largestFilename = nameNumber;
        });
        
        return (largestFilename + 1).toString() + ".pup";
      }
    }

    function saveFileNew(){
      var chap = this;

      if(chap.filename == undefined || chap.filename == null)
        chap.filename = getNewFilename();
    
      fs.writeFileSync(project.directory + chap.filename, JSON.stringify(chap.contents), "utf8");

      function getNewFilename(){
        var largestFilename = 0;

        fs.readdirSync(project.directory).forEach(file => {
          var nameNumber = parseInt(file.split(".")[0]);
          if(nameNumber > largestFilename)
            largestFilename = nameNumber;
        });
        
        return (largestFilename + 1).toString() + ".pup";
    }
  }

}

  
