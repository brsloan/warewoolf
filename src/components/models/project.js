const fs = require('fs');
const newChapter = require('./chapter');
const chapterList = require('../controllers/chapter-list');
const { logError } = require('../controllers/error-log');
const defaultProjectNotesName = 'project_.txt'; //Will have default notes prepend ('-notes_') as well (added by Chapter object's save function)

function newProject(){
    return {
        filename: "",
        directory: "",
        chapsDirectory: "",
        title: "",
        author: "",
        notesChap: {}, //notesChap is a chapter file for which we never use chapter content but only chapter notes (in order to save project-wide notes)
        chapters: [],
        reference: [],
        filters: [],
        trash: [],
        activeChapterIndex: 0,
        wordGoal: 0,
        hasUnsavedChanges: false,
        textCursorPosition: 0,
        corkboardColumns: 4,
        getActiveChapter: getActiveChapter,
        loadFile: loadFile,
        saveFile: saveFile,
        saveAs: saveAs,
        testChapsDirectory: testChapsDirectory,
        initNotesChap: initNotesChap
    };

    function getActiveChapter(){
      return chapterList.chapterAt(this, this.activeChapterIndex);
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

        //Named rather than reached for as `this`, which inside these callbacks is not the project.
        var proj = this;

        var chaps = [];
        this.chapters.forEach(function (chap) {
          chaps.push(newChapter(proj).parseChapter(chap));
        });
        this.chapters = chaps;

        var refChaps = [];
        this.reference.forEach(function(rf){
          refChaps.push(newChapter(proj).parseChapter(rf));
        })
        this.reference = refChaps;

        var trashChaps = [];
        this.trash.forEach(function (tr) {
          trashChaps.push(newChapter(proj).parseChapter(tr));
        });
        this.trash = trashChaps;

        this.initNotesChap();

        this.hasUnsavedChanges = false;
        return this.testChapsDirectory();
      }
      catch(err){
        logError(err);
      }
    }

    function initNotesChap(){
      var notesChap = newChapter(this);
      notesChap.filename = defaultProjectNotesName;
      this.notesChap = notesChap;
      return this.notesChap;
    }

    function saveFile(){
      try{
        var proj = this;
        if(proj.filename != "" && proj.directory != ""){

          proj.chapters.forEach(function(chap){
            if(chap.hasUnsavedChanges)
              chap.saveFile();
          });
          proj.reference.forEach(function(rf){
            if(rf.hasUnsavedChanges)
              rf.saveFile();
          });
          proj.trash.forEach(function(tr){
            if(tr.hasUnsavedChanges)
              tr.saveFile();
          });

          if(proj.notesChap.hasUnsavedChanges)
            proj.notesChap.saveNotesFile();

          var fileString = stringifyProject(proj);

          fs.writeFileSync(proj.directory + proj.filename, fileString, 'utf8');

          return true;
        }
        else
          throw new Error("Cannot save without filepath. Use Save As.");
      }
      catch(err){
        logError(err);
        return false;
      }
    }

    function stringifyProject(proj){
      return JSON.stringify(proj, function(k,v){
        if (k == "contents") return undefined;
        //Each chapter points back at the project it belongs to, so this has to come out or
        //JSON.stringify walks in a circle.
        else if (k == "parentProject") return undefined;
        else if (k == "hasUnsavedChanges") return undefined;
        //else if (k == "filename") return undefined;
        else if (k == "directory") return undefined;
        else if (k == "wordCountOnLoad") return undefined;
        else if (k == "notes") return undefined;
        else if (k == "notesChap") return undefined;
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
        var extIndex = newFilename.lastIndexOf(".");
        var newSubDir = (extIndex > -1 ? newFilename.substring(0, extIndex) : newFilename).concat("_chapters/");

        //Create new directories
        if(!fs.existsSync(newDirectory))
          fs.mkdirSync(newDirectory);
        if(!fs.existsSync(newDirectory + newSubDir))
          fs.mkdirSync(newDirectory + newSubDir);

        //Copy any existing chapters over to new location and change name accordingly.
        //A chapter whose file is missing from disk (flagged by testChapsDirectory) shouldn't
        //abort the whole Save As - log it and move on to the rest.
        function copyChapterToNewLocation(chap){
          if(chap.filename != null){
            var newChapFilename = chap.filename.split("/").pop();
            try{
              fs.copyFileSync(proj.directory + proj.chapsDirectory + chap.filename,
                newDirectory + newSubDir + newChapFilename);
              if(useSaveCopy == false)
                chap.filename = newChapFilename;
            }
            catch(copyErr){
              logError(copyErr);
            }
          }
        }
        proj.chapters.forEach(copyChapterToNewLocation);
        proj.reference.forEach(copyChapterToNewLocation);
        proj.trash.forEach(copyChapterToNewLocation);

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
        proj.reference.forEach(function(rf){
          if(rf.hasUnsavedChanges){
            if(useSaveCopy)
              rf.saveCopy();
            else
              rf.saveFile();
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
        return false;
      }
    }

    function testChapsDirectory(){
      var missingChaps = [];
      for(let i=0;i<this.chapters.length;i++){
        if(!fs.existsSync(this.directory + this.chapsDirectory + this.chapters[i].filename))
          missingChaps.push(this.chapters[i]);
      }
      return missingChaps;
    }
}

module.exports = newProject;