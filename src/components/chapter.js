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
      saveFile: saveFile
    };

    function deleteChapterFile(){
      var chap = this;

      fs.unlinkSync(project.directory + chap.filename);
    }

    function parseChapter(chap){
      return Object.assign(this, chap);
    }

    function getFile(){
      var chap = this;

      var chapterObj = JSON.parse(fs.readFileSync(project.directory + chap.filename, "utf8"));

      return chapterObj;
    }


    function saveFile(){
      var chap = this;
      var subDir = project.filename.split(".")[0].concat("_pups/");

      if(chap.filename == undefined || chap.filename == null)
        chap.filename = getNewFilename();

      fs.writeFileSync(project.directory + chap.filename, JSON.stringify(chap.contents), "utf8");
      chap.contents = null;
      chap.hasUnsavedChanges = false;


      function getNewFilename(){
        var largestFilename = 0;

        fs.readdirSync(project.directory + subDir).forEach(file => {
          var nameNumber = parseInt(file.split(".")[0]);
          if(nameNumber > largestFilename)
            largestFilename = nameNumber;
        });

        return subDir + (largestFilename + 1).toString() + ".pup";
    }
  }

}
