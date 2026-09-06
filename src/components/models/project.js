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
        //Set for a project opened out of the read-only install directory (the bundled Help doc).
        //saveFile() refuses to write while it is set, so nothing can silently fail with EACCES
        //against a file the user cannot write; render.js routes an explicit save to Save As
        //instead, which clears it by way of saveAs().
        isReadOnly: false,
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
      //Cleared up front so it always describes this load, not an earlier one.
      this.loadError = null;

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
        //After the Object.assign above, so a .woolf file that carries the key (hand-edited - it is
        //never written by stringifyProject) cannot mark a writable project read-only. Callers that
        //want it set, like openHelpDoc(), set it after the load returns.
        this.isReadOnly = false;
        return this.testChapsDirectory();
      }
      catch(err){
        logError(err);
        //Every caller does missingChaps.length on this return value, so a failed load has to hand
        //back an array like every other path. Returning undefined here threw instead, and on the
        //startup path (loadInitialProject -> setProject) that killed render.js before it had
        //registered a single ipcRenderer handler - including the exit-app-clicked one that
        //index.js's close guard waits for, leaving a window nothing but the task manager could
        //close. Callers tell a failed load from a clean one by checking loadError.
        this.loadError = err;
        return [];
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
        //Guarded here rather than at each call site: chapter deletion, legacy conversion and the
        //autosave/Ctrl+S path all reach saveFile(), and every one of them already treats a false
        //return as "not saved". Writing anyway would fail with EACCES and be swallowed by the
        //catch below, which is the silent data loss this flag exists to prevent.
        if(proj.isReadOnly)
          return false;
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
        //Records why the last load failed, for the caller that has to report it - never part of
        //the saved project.
        else if (k == "loadError") return undefined;
        //Describes where this copy was opened from, not the project itself - never saved.
        else if (k == "isReadOnly") return undefined;
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
        else
          //The project now lives where the user chose, which is writable - so it is no longer the
          //read-only bundled copy. Not cleared for Save a Copy, which leaves the open project
          //pointing back at the original.
          proj.isReadOnly = false;

        return proj.directory + proj.filename;
      }
      catch(err){
        logError(err);
        return false;
      }
    }

    //Scans all three lists, not just chapters. A reference document or a trashed chapter is a real
    //file this project manages - saveAs() copies all three, saveFile() writes all three - but a
    //missing one used to go unreported, so the repair screen never opened and the reader only found
    //out on navigating onto it, by way of a blank editor and an ENOENT in the error log. The usual
    //cause (a renamed or mistyped chapters subdirectory) breaks all three at once, and that is
    //exactly what the repair screen fixes, so it needs the whole set to work from.
    function testChapsDirectory(){
      var proj = this;
      var missingChaps = [];

      chapterList.LIST_ORDER.forEach(function(listName){
        chapterList.listOf(proj, listName).forEach(function(chap){
          //A chapter that has never been saved has no file yet, so there is no missing one to
          //report - only a filename that was expected on disk and is not there counts.
          if(chap.filename == null)
            return;

          if(!fs.existsSync(proj.directory + proj.chapsDirectory + chap.filename))
            missingChaps.push(chap);
        });
      });

      return missingChaps;
    }
}

module.exports = newProject;