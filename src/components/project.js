function newProject(){
    return {
        filename: "",
        directory: "",
        chapsDirectory: "",
        title: "",
        author: "",
        notes: {},
        chapters: [],
        filters: [],
        trash: [],
        activeChapterIndex: 0,
        wordGoal: 0,
        hasUnsavedChanges: false,
        getActiveChapter: getActiveChapter,
        loadFile: loadFile,
        saveFile: saveFile,
        saveAs: saveAs
    };

    function getActiveChapter(){
      var chap;
        if(this.activeChapterIndex < this.chapters.length)
            chap =  this.chapters[this.activeChapterIndex];
        else
            chap = this.trash[this.activeChapterIndex - this.chapters.length];
        return chap;
    }

    function loadFile(projPath){
      try{
        //Convert Windows filepaths to maintain linux/windows compatibility
        projPath = projPath.replaceAll('\\', '/');

        var projectFile = JSON.parse(fs.readFileSync(projPath, "utf8"));

        Object.assign(this, projectFile);
        var projPathParts = projPath.split('/');

        this.filename = projPathParts.pop();
        this.directory = projPathParts.join('/').concat("/");


        var chaps = [];
        this.chapters.forEach(function (chap) {
          chaps.push(newChapter().parseChapter(chap));
        });
        this.chapters = chaps;


        var trashChaps = [];
        this.trash.forEach(function (tr) {
          trashChaps.push(newChapter().parseChapter(tr));
        });
        this.trash = trashChaps;

        testChapsDirectory();
      }
      catch(err){
        logError(err);
      }
    }

    function saveFile(){
      try{
        var proj = this;
        if(proj.filename != "" && proj.directory != ""){

          proj.chapters.forEach(function(chap){
            if(chap.hasUnsavedChanges)
              chap.saveFile();
          });
          proj.trash.forEach(function(tr){
            if(tr.hasUnsavedChanges)
              tr.saveFile();
          });


          var fileString = stringifyProject(proj);

          fs.writeFileSync(proj.directory + proj.filename, fileString, 'utf8');

        }
        else
          alert("Cannot save without filepath. Use Save As.");
      }
      catch(err){
        logError(err);
      }
    }

    function stringifyProject(proj){
      return JSON.stringify(proj, function(k,v){
        if (k == "contents") return undefined;
        else if (k == "hasUnsavedChanges") return undefined;
        //else if (k == "filename") return undefined;
        else if (k == "directory") return undefined;
        else return v;
      }, '\t');
    }

    function saveAs(filepath, useSaveCopy = false){
      try{
        //Convert Windows filepaths to maintain linux/windows compatibility
        filepath = filepath.replaceAll('\\', '/');

        var proj = this;
        var filepathParts = filepath.split('/');
        var newFilename = filepathParts.pop();
        var newDirectory = filepathParts.join('/').concat("/");
        var newSubDir = newFilename.split(".")[0].concat("_pups/");

        //Create new directories
        if(!fs.existsSync(newDirectory))
          fs.mkdirSync(newDirectory);
        if(!fs.existsSync(newDirectory + newSubDir))
          fs.mkdirSync(newDirectory + newSubDir);

        //Copy any existing chapters over to new location and change name accordingly
        proj.chapters.forEach(function(chap){
          if(chap.filename != null){
            var newChapFilename =  chap.filename.split("/").pop();
            fs.copyFileSync(proj.directory + proj.chapsDirectory + chap.filename,
              newDirectory + newSubDir + newChapFilename);
            if(useSaveCopy == false)
              chap.filename = newChapFilename;
          }
        });
        proj.trash.forEach(function(chap){
          if(chap.filename != null){
            var newChapFilename = chap.filename.split("/").pop();
            fs.copyFileSync(proj.directory + proj.chapsDirectory + chap.filename, newDirectory + newSubDir + newChapFilename);
            if(useSaveCopy == false)
              chap.filename = newChapFilename;
          }
        });

        //Save old values for re-assignment with SaveCopy
        var oldFn = proj.filename;
        var oldDir = proj.directory;
        var oldChapsDir = proj.chapsDirectory;

        //Update project info for new locations
        proj.filename = newFilename;
        if(proj.filename.substr(proj.filename.length - 6, 6) != ".woolf")
          proj.filename += ".woolf";
        proj.directory = newDirectory;
        proj.chapsDirectory = newSubDir;

        //Save any new or altered chapters
        proj.chapters.forEach(function(chap){
          if(chap.hasUnsavedChanges){
            if(useSaveCopy)
              chap.saveCopy();
            else
              chap.saveFile();
          }
        });
        proj.trash.forEach(function(tr){
          if(tr.hasUnsavedChanges){
            if(useSaveCopy)
              tr.saveCopy();
            else
              tr.saveFile();
          }
        });


        //Save new project file
        var fileString = stringifyProject(proj);

        fs.writeFileSync(proj.directory + proj.filename, fileString, 'utf8');

        //reset porject details if using saveCopy
        if(useSaveCopy){
          proj.filename = oldFn;
          proj.directory = oldDir;
          proj.chapsDirectory = oldChapsDir;
        }

        return proj.directory + proj.filename;
      }
      catch(err){
        logError(err);
      }
    }

    function testChapsDirectory(){
      var firstChapExists = fs.existsSync(project.directory + project.chapsDirectory + '1.pup');

      if(!firstChapExists){
          promptForMissingPups();
      }
    }
}
