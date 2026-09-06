const newChapter = require('./chapter');
const chapterList = require('../controllers/chapter-list');
const { logError } = require('../controllers/error-log');
const defaultProjectNotesName = 'project_.txt'; //Will have default notes prepend ('-notes_') as well (added by Chapter object's save function)

//Group B of the platform contract (see platform.js). Like chapter.js, this module no longer knows
//how a project is laid out on disk: openProject hands back the path already split, saveProjectAs
//names the chapters subdirectory and returns the filenames the chapter files landed under, and
//nothing here composes a path or decides an extension any more.
let platform = null;

function setPlatform(p){
  platform = p;
}

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
        //Set for a project opened out of the read-only install directory (the bundled Help doc, and
        //the Frankenstein example when its copy out to userData fails).
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

    async function loadFile(projPath){
      //Cleared up front so it always describes this load, not an earlier one.
      this.loadError = null;

      try{
        requirePlatform();

        //openProject reads and parses the file and splits the path (normalizing Windows separators
        //to maintain linux/windows compatibility), so all three used to happen here and no longer
        //do.
        var opened = await platform.openProject({ path: projPath });

        Object.assign(this, opened.project);

        this.filename = opened.filename;
        this.directory = opened.directory;

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
        return await this.testChapsDirectory();
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

    async function saveFile(){
      try{
        requirePlatform();

        var proj = this;
        //Guarded here rather than at each call site: chapter deletion, legacy conversion and the
        //autosave/Ctrl+S path all reach saveFile(), and every one of them already treats a false
        //return as "not saved". Writing anyway would fail with EACCES and be swallowed by the
        //catch below, which is the silent data loss this flag exists to prevent.
        //
        //Deliberately still here rather than pushed into the platform: isReadOnly describes where
        //this copy was *opened from*, which is renderer-side policy the native side cannot know and
        //which is never written into the .woolf. It also has to sit above the chapter saves below,
        //not just above the project-file write - a read-only project's chapter files are equally
        //unwritable. PERMISSION_DENIED coming back from a command is the backstop for when this
        //flag is wrong, not a replacement for it. See platform.js's CODES.PERMISSION_DENIED.
        if(proj.isReadOnly)
          return false;
        if(proj.filename != "" && proj.directory != ""){

          await saveDirtyChapters(proj);

          await platform.saveProject({
            directory: proj.directory,
            filename: proj.filename,
            contents: stringifyProject(proj)
          });

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

    //Sequential rather than concurrent on purpose. Two chapters with the same title race for the
    //same allocated filename if their saves overlap, and saveChapterAtomic can only close that race
    //within one call - it stashes, allocates and writes as a unit, but two of those interleaved
    //would both see the name free.
    async function saveDirtyChapters(proj){
      var everyChapter = proj.chapters.concat(proj.reference, proj.trash);

      for(let i = 0; i < everyChapter.length; i++){
        if(everyChapter[i].hasUnsavedChanges)
          await everyChapter[i].saveFile();
      }

      if(proj.notesChap.hasUnsavedChanges)
        await proj.notesChap.saveNotesFile();
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

    //Save As, and (with useSaveCopy) Save a Copy.
    //
    //Three steps in this order, and the order is forced rather than chosen:
    //
    //  1. saveProjectAs - parse the target path, make the project and chapters directories, copy
    //     every chapter file that already exists across. Six filesystem operations that succeed or
    //     fail together, which is why they are one command.
    //  2. Save any chapter with unsaved changes, into the new location. This cannot be folded into
    //     step 1: saveChapterAtomic/saveChapter *allocate* the filename, so the names the .woolf
    //     has to list are not known until these have run - and they cannot run before step 1,
    //     because the directory they write into does not exist yet.
    //  3. saveProject - write the .woolf, now that every filename in it is final. See the note on
    //     saveProject in platform.js for why this is a separate command rather than part of step 1.
    async function saveAs(filepath, useSaveCopy = false){
      try{
        requirePlatform();

        var proj = this;
        //One flat list in a fixed order, so what saveProjectAs reports back can be lined up against
        //the chapters it was asked about. A chapter that has never been saved has a null filename
        //and takes a slot without being a failure.
        var everyChapter = proj.chapters.concat(proj.reference, proj.trash);

        var moved = await platform.saveProjectAs({
          fromDirectory: proj.directory,
          fromChapsDir: proj.chapsDirectory,
          targetPath: filepath,
          chapterFilenames: everyChapter.map(function(chap){ return chap.filename; })
        });

        //A chapter whose file is missing from disk (flagged by testChapsDirectory) shouldn't
        //abort the whole Save As - log it and move on to the rest.
        moved.failed.forEach(function(failure){
          logError(new Error('Could not copy chapter file "' + failure.filename
            + '" into the new project location (' + failure.code + '): ' + failure.message));
        });

        //Save old values for re-assignment with SaveCopy
        var oldFn = proj.filename;
        var oldDir = proj.directory;
        var oldChapsDir = proj.chapsDirectory;

        //Update project info for new locations. Has to happen before the chapter saves below, which
        //resolve their directory through the project on each use - that is what carries them to the
        //new location rather than writing back into the old one.
        proj.filename = moved.filename;
        proj.directory = moved.directory;
        proj.chapsDirectory = moved.chapsDirectory;

        //Save a Copy leaves the open project pointing at its original files, so only a real Save As
        //repoints them. A chapter that failed to copy comes back as null and is not repointed at a
        //file that was never created.
        if(useSaveCopy == false)
          everyChapter.forEach(function(chap, i){
            if(moved.chapterFilenames[i] != null)
              chap.filename = moved.chapterFilenames[i];
          });

        //Sequential for the same reason saveDirtyChapters is - see its comment.
        for(let i = 0; i < everyChapter.length; i++){
          if(everyChapter[i].hasUnsavedChanges){
            if(useSaveCopy)
              await everyChapter[i].saveCopy();
            else
              await everyChapter[i].saveFile();
          }
        }

        //Save new project file
        await platform.saveProject({
          directory: proj.directory,
          filename: proj.filename,
          contents: stringifyProject(proj)
        });

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
    //
    //verifyProjectFiles answers in filenames, so the chapters are matched back against them by
    //name rather than by position: the same file can legitimately be named by more than one list.
    async function testChapsDirectory(){
      var proj = this;
      var candidates = [];

      chapterList.LIST_ORDER.forEach(function(listName){
        chapterList.listOf(proj, listName).forEach(function(chap){
          //A chapter that has never been saved has no file yet, so there is no missing one to
          //report - only a filename that was expected on disk and is not there counts.
          if(chap.filename == null)
            return;

          candidates.push(chap);
        });
      });

      try{
        requirePlatform();

        var missing = await platform.verifyProjectFiles({
          directory: proj.directory,
          chapsDirectory: proj.chapsDirectory,
          chapterFilenames: candidates.map(function(chap){ return chap.filename; })
        });

        return candidates.filter(function(chap){
          return missing.indexOf(chap.filename) > -1;
        });
      }
      catch(err){
        //Callers treat the return value as "which chapters need repairing", and every one of them
        //does .length on it - so a check that could not run reports nothing missing rather than
        //throwing out of a load or an unawaited view callback. Logged, because a repair screen that
        //silently never opens is the failure mode this whole function exists to end.
        logError(err);
        return [];
      }
    }
}

//Louder than a silent no-op, which for a save would be data loss behind a clean-looking return.
function requirePlatform(){
  if(platform == null)
    throw new Error('This project cannot reach the filesystem: no platform has been configured. Call setPlatform() first.');
}

module.exports = newProject;
//Hung off the factory rather than exported alongside it, so every existing
//`require('./project')` call site keeps working unchanged.
module.exports.setPlatform = setPlatform;
