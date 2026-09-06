const { logError } = require('../controllers/error-log');
const { parseMDF, convertDeltaToMDF } = require('../controllers/markdownFic');

//Group C of the platform contract (see platform.js). This module used to be the largest single
//user of `fs` in the renderer; it now knows nothing about where a chapter lives on disk beyond the
//project directory it was built with and the filename it was handed back.
//
//Three things left with the filesystem, and their absence is the point of the exercise:
//
//  - The chapter-file extension and the notes-file prefix. A notes file's name is derived from its
//    chapter's, and deriving it here meant the renderer had to know that layout in three separate
//    places and keep them in step. A test asserts neither literal appears in this file any more.
//  - The find-a-free-filename loop. It is now inside saveChapterAtomic, because reading the
//    directory to pick a free name and then writing under it is a race whoever owns both halves
//    has to close - and that is the native side, not this one. saveFile() therefore hands over the
//    chapter's *title* and is told which filename it got.
//  - The rename/write/restore-on-failure rollback saveFile() used to run by hand. Same command,
//    same reason: the ordering is load-bearing, and it is no longer this file's to get wrong.
//
//Injected, not global, exactly as platform.js requires - a test hands this module a node-backed
//platform pointed at a temp directory, which is how the suite goes on asserting against real files.
let platform = null;

//Called once at renderer startup with the node-backed platform instance (render.js's
//loadPlatformState), and by each test's setup with one of its own. Group C is plain fs, so it does
//not cross IPC yet; that instance is what has to be swapped at Phase 9.
function setPlatform(p){
  platform = p;
}

//A chapter's files live in its project's chapters directory, so every file operation below needs
//the project that owns it. It arrives here as an argument rather than being read off a bare
//`project` global, which is what this used to do - the app happened to supply one only because
//render.js is loaded as a plain <script> tag, so its top-level `var project` landed on `window`.
//Nothing outside that one arrangement could use this model at all, and the tests had to hand-set a
//global to stand in for it.
function newChapter(parentProject){
    return {
      parentProject: parentProject || null,
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

    //Resolved on each use rather than captured once, because Save As moves a project (and every
    //chapter in it) to a new directory in place.
    function chapterLocation(chap){
      if(!chap.parentProject)
        throw new Error('Chapter "' + chap.title + '" has no parent project, so its file path cannot be resolved.');
      //Louder than a silent no-op, which for a save would be data loss with a clean-looking return.
      if(platform == null)
        throw new Error('Chapter "' + chap.title + '" cannot reach the filesystem: no platform has been configured. Call setPlatform() first.');

      return {
        projectDir: chap.parentProject.directory,
        chapsDir: chap.parentProject.chapsDirectory
      };
    }

    async function deleteChapterFile(){
      var chap = this;
      try{
        //A chapter added but never saved has no file to delete, and asking for one by a null name
        //is not a failure worth logging.
        if(chap.filename == null)
          return;

        var where = chapterLocation(chap);
        //The chapter's notes go with it - one command, so the renderer cannot delete one and leave
        //the other stranded under a name nothing in the UI can reach.
        await platform.deleteChapterFiles({
          projectDir: where.projectDir,
          chapsDir: where.chapsDir,
          filename: chap.filename
        });
      }
      catch(err){
        logError(err);
      }
    }

    //The saved form of a chapter carries no parentProject (project.js strips it, since it is a
    //reference back up), but restore it explicitly so a stray one in an old file cannot replace the
    //project this chapter was actually built for.
    function parseChapter(chap){
      var owner = this.parentProject;
      Object.assign(this, chap);
      this.parentProject = owner;
      return this;
    }

    async function getFile(){
      try{
        var chap = this;
        var where = chapterLocation(chap);

        //loadChapter returns the file's text, not a parsed chapter: deciding which of the two
        //formats it is in, and parsing it, is pure string work with no OS in it, so it stays here.
        //Temporarily support both old chapter JSON files (.pup) and new markdown (.txt)
        var fileText = await platform.loadChapter({
          projectDir: where.projectDir,
          chapsDir: where.chapsDir,
          filename: chap.filename
        });

        if(chap.filename.includes('.pup'))
          return JSON.parse(fileText);

        return parseMDF(fileText);
      }
      catch(err){
        logError(err);
      }
    }

    async function getContentsOrFile(){
      var chap = this;

      var cont = chap.contents ? chap.contents : null;
      if(cont == null && chap.filename != null)
        cont = await chap.getFile();

      return cont;
    }

    async function getNotesContentOrFile(){
      var chap = this;

      var notes = chap.notes ? chap.notes : null;
      if(notes == null && chap.filename != null)
        notes = await chap.getNotesFile();

      return notes;
    }


    //Save a Copy. There is no old file to displace, so there is no transaction: the command
    //allocates a fresh name and writes under it.
    async function saveCopy(){
      try{
        var chap = this;
        var where = chapterLocation(chap);

        var saved = await platform.saveChapter({
          projectDir: where.projectDir,
          chapsDir: where.chapsDir,
          title: chap.title,
          mdfc: convertDeltaToMDF(chap.contents)
        });

        //Only point the chapter at the new file once the write has actually succeeded
        chap.filename = saved.filename;
      }
      catch(err){
        logError(err);
      }
    }

    //The chapter save. What used to be five ordered fs calls here - stash the old file under a
    //flagged name, allocate a new one, write, restore the stash if the write failed, drop the stash
    //once everything else has succeeded - is one command whose ordering the renderer cannot get
    //wrong. See saveChapterAtomic in platform-node.js for which parts of that ordering are
    //load-bearing and why.
    //
    //hasUnsavedChanges is cleared only on the way out, never before the command returns, which is
    //what makes a failed save (and, worse, a failed *rollback*, where the chapter has no file on
    //disk at all) leave the chapter dirty rather than looking saved.
    async function saveFile(){
      try{
        var chap = this;
        var where = chapterLocation(chap);

        //A title change with no edit to the text: there is nothing in memory to write, so the file
        //is read back and rewritten under the new name. Round-tripped through the parser rather
        //than copied as text, because a .pup chapter is JSON and comes out as MarkdownFic.
        if(chap.contents == null && chap.filename != null)
          chap.contents = await chap.getFile();

        var saved = await platform.saveChapterAtomic({
          projectDir: where.projectDir,
          chapsDir: where.chapsDir,
          oldFilename: chap.filename,
          title: chap.title,
          mdfc: convertDeltaToMDF(chap.contents),
          //Notes ride along in the same call because their filename is derived from the chapter's:
          //saving them separately would leave a window where they sat under the old name.
          notesMdfc: chap.notes != null ? convertDeltaToMDF(chap.notes) : null
        });

        //Only point the chapter at the new file once the write has actually succeeded
        chap.filename = saved.filename;
        chap.contents = null;

        //A notes failure never fails a chapter that was written - but it is not nothing either.
        //The old code cleared hasUnsavedChanges before saveNotesFile() ran, so notes that never
        //reached disk left the chapter looking saved and were dropped without a prompt on exit.
        //Left dirty instead, with the notes still in memory, so the reader is asked about them and
        //the next save retries.
        if(saved.notesError){
          logError(new Error('Chapter "' + chap.title + '" was saved, but its notes were not ('
            + saved.notesError.code + '): ' + saved.notesError.message));
          return;
        }

        chap.notes = null;
        chap.hasUnsavedChanges = false;
      }
      catch(err){
        logError(err);
      }
    }

    async function getNotesFile(){
      try{
        var chap = this;
        var where = chapterLocation(chap);

        //null for a chapter that simply has no notes yet, which is the ordinary case and not a
        //failure - the command distinguishes the two so this does not have to.
        var fileText = await platform.loadChapterNotes({
          projectDir: where.projectDir,
          chapsDir: where.chapsDir,
          filename: chap.filename
        });

        return fileText ? parseMDF(fileText) : null;
      }
      catch(err){
        logError(err);
      }
    }

    //Notes for a chapter whose filename is not changing - the project notes chapter, and the notes
    //panel saving on its own. When the filename *is* changing they go through saveFile() above
    //instead, which owns the rename.
    async function saveNotesFile(){
      try{
        var chap = this;
        var where = chapterLocation(chap);

        if(chap.notes != null)
          await platform.saveChapterNotes({
            projectDir: where.projectDir,
            chapsDir: where.chapsDir,
            filename: chap.filename,
            mdfc: convertDeltaToMDF(chap.notes)
          });

        chap.notes = null;
        chap.hasUnsavedChanges = false;
      }
      catch(err){
        logError(err);
      }
    }
}

module.exports = newChapter;
//Hung off the factory rather than exported alongside it, so every existing
//`require('./chapter')` call site keeps working unchanged.
module.exports.setPlatform = setPlatform;
