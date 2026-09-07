//The node backing for the platform contract in platform.js: direct fs and crypto, no IPC.
//
//It is what the test suite runs against, so the 830 existing tests keep asserting against real
//files in real temp directories rather than against mocks. It is also what the app itself uses
//until Phase 9, which is what lets each group convert and ship on its own.
//
//Kept out of platform.js deliberately. platform.js requires nothing - not fs, not electron - so at
//Phase 9 it survives the switch to `--platform=browser` untouched, and this file is the one that
//has to be gone. If the contract file ever grows a `require('fs')`, that property is lost.
//
//Groups A, B, C, D, E, I and J are implemented. Everything else in COMMANDS is deliberately absent
//and rejects with NOT_IMPLEMENTED, so the remaining phases fill the table in one group at a time
//and the suite says what is still outstanding.

const fs = require('fs');
const path = require('path');
const os = require('os');
//Neither has a browser build (see the inventory's group F/G/H notes), which is why extractZip,
//importDocx, buildEpub and archiveProject are native by necessity rather than by convenience.
const unzipper = require('unzipper');
const archiver = require('archiver');
//Group K's own out-of-process dependencies. Required here, at module scope, rather than
//destructured - createNodeBacking() below resolves `.request`/`.get`/`.spawn`/`.createTransport`
//off these same module objects fresh on every call (options.X || httpsModule.X, not a captured
//copy), so a test that mocks e.g. https.request via node:test's t.mock.method is seen by any
//backing constructed afterward, and platform.test.js's own injected fakes (httpsRequest,
//httpsGet, spawnProcess, createMailTransport) can override the same seam without either backing
//behaving differently depending on which came first.
const httpsModule = require('https');
const childProcessModule = require('child_process');
const nodemailer = require('nodemailer');
const { CODES, PlatformError, fromNodeError, SAVED_SECRET } = require('./platform');
const { sanitizeFilename } = require('./utils');
//Only the legacy-format pair is needed here. Everything else about key handling - derivation,
//sealing, the session key - stays inside credential-store.js, which this backing drives rather
//than reimplements.
const { decryptLegacy, isLegacyBlob } = require('./crypto');
const getCredentialStore = require('../models/credential-store');

//The renderer stops knowing any of these. Today they are spelled out in chapter.js, which means the
//renderer knows how a chapter is laid out on disk; after Phase 4 it knows only titles and the
//filenames it was handed back.
const CHAPTER_EXT = '.txt';
const NOTES_PREPEND = '-notes_';
const OLD_VERSION_FLAG = 'old_v_temp';
const PROJECT_EXT = '.woolf';
//Save As derives the chapters subdirectory from the project's own name. The renderer used to build
//this string itself (project.js:180); it is layout, so it belongs on this side with the rest.
const CHAPS_DIR_SUFFIX = '_chapters/';

//Group D's error log slice. Timestamping and describing whatever was thrown are pure JS with no
//OS dependency, so that stays in error-log.js - this is only the part that used to be
//error-log.js:43-46: where the log lives, and the 1MB cap past which it truncates instead of
//growing forever.
const LOG_FILENAME = 'error_log.txt';
const MAX_LOG_SIZE_BYTES = 1024 * 1024;
//The rest of group D: settings, corkboard, licenses.
const SETTINGS_FILENAME = 'user-settings.json';
const CORKBOARD_FILENAME = 'project_corkboard.txt';
const LICENSES_FILENAME = 'licenses.txt';
//Group I: spellcheck dictionaries. The shared dictionary ships under the app directory; the
//personal one is a per-user file under userData, seeded on first read exactly as
//createPersonalDicIfNeeded() used to (spellcheck.js:35-51).
const DICTIONARIES_DIR = 'dictionaries';
const SHARED_DICT_BASENAME = 'en_US-large';
const PERSONAL_DICT_FILENAME = 'personal.dic';
const PERSONAL_DICT_SEED = 'WareWoolf\n';

//Group H: backup archives. Timestamp shape and extension moved here verbatim from
//backup-project.js's own getTimeStamp()/ARCHIVE_EXTENSION - allocating the archive's name is now
//this command's job, the same reason saveChapterAtomic allocates a chapter's filename instead of
//taking one.
const ARCHIVE_EXTENSION = '.zip';

//Group K: the GitHub Releases endpoint updates.js used to hit directly.
const RELEASE_API_HOSTNAME = 'api.github.com';
const RELEASE_API_PATH = '/repos/brsloan/warewoolf/releases/latest';
const RELEASE_CHECK_TIMEOUT_MS = 10000;
//Linux-only sysfs path for battery state - absent by construction on Windows/macOS, which is what
//makes getBatteryCapacity's UNAVAILABLE path exercisable in this test suite without a real Pi.
const POWER_SUPPLY_PATH = '/sys/class/power_supply';

//`services` maps a credential service name to the directory its store lives in. Only 'email' exists
//today, in userData, which is exactly where credential-store.js already keeps credentials.json and
//.warewoolf-key - so nothing on disk moves. Tauri's keyring is service-keyed, which is why the name
//is in the contract at all.
function createNodeBacking(deps){
  var options = deps || {};
  var paths = options.paths || {};
  var secureStorage = options.secureStorage || null;
  var log = options.logError || function(){};
  var services = options.services || (paths.userData == null ? {} : { email: paths.userData });
  //buildEpub and archiveProject both depend on resolving only when the destination write stream's
  //'close' fires, not archiver's 'finish' - see the comments on those two functions. That property
  //is not observable through the real fs.createWriteStream on this codebase's test fixtures (finish
  //and close land too close together on a fast local filesystem for a same-process read-back to
  //tell them apart), so it needs an injectable seam the same way secureStorage/onSetTheme/etc. are
  //injectable, rather than being asserted only by comment.
  var createWriteStream = options.createWriteStream || fs.createWriteStream;
  //Group K's own injectable transports - the network/process boundary this phase's own write-up
  //warns has to be replaced *inside* the bundle (mark the module external, or inject it) rather
  //than blocked from outside at the socket/DNS layer, which Phase 7 tried once and could not make
  //work: Node's `net` layer does not go through whatever a page-level script replaces. Resolved
  //fresh off the shared module objects on every createNodeBacking() call (not destructured at this
  //file's top) so a test's t.mock.method on the real module is picked up by a backing constructed
  //after the mock is installed, the same trick that already lets platform.test.js mock https.request
  //without a require-cache dance.
  var httpsRequest = options.httpsRequest || httpsModule.request;
  var httpsGet = options.httpsGet || httpsModule.get;
  var spawnProcess = options.spawnProcess || childProcessModule.spawn;
  var createMailTransport = options.createMailTransport || nodemailer.createTransport;
  //installUpdate's one guard: sudo apt install must never run against a path the renderer merely
  //asserts is an installer. This backing only trusts a path it produced itself, via a downloadUpdate
  //call against this same instance (session-scoped - the state disappears once the app or a test
  //discards this backing, same lifetime as the credential stores' cached session key above).
  var vouchedUpdatePaths = new Set();

  //Group A is the exception to this file's own rule. C and J are direct fs/crypto - exactly what
  //nodeIntegration already gives the renderer, so this backing can run inside it unchanged. None of
  //app.getPath, nativeTheme, the application menu, or app.quit is reachable from the renderer at
  //all, with or without nodeIntegration - so unlike C and J, this group was never a candidate for
  //running this file inside the shipped app. render.js uses platform-ipc.js for it instead; what
  //follows here exists so platform.test.js can exercise the contract's shape against injected
  //fakes, the same way it already does for secureStorage above.
  //A value for the tests, which know it up front; a function for index.js, which does not. On macOS
  //the 'open-file' event can set this after the backing exists, and a value read at construction
  //would be the one from before the reader double-clicked the file.
  var fileRequestedOnOpen = options.fileRequestedOnOpen == null ? null : options.fileRequestedOnOpen;
  var readFileRequestedOnOpen = options.getFileRequestedOnOpen || function(){ return fileRequestedOnOpen; };
  var onSetTheme = options.onSetTheme || function(){};
  var onShowAppMenu = options.onShowAppMenu || function(){};
  var onConfirmExit = options.onConfirmExit || function(){};
  var onNotifyRendererReady = options.onNotifyRendererReady || function(){};

  //Stores are cached rather than rebuilt per call because a passphrase-derived session key lives in
  //the store's closure. Discarding the instance is therefore how lockCredential locks: the key has
  //nowhere else to be.
  var stores = {};

  var listeners = {};

  return {
    // --- A. Environment and shell ------------------------------------------------------------
    getAppPaths: getAppPaths,
    getPlatform: getPlatform,
    getFileRequestedOnOpen: getFileRequestedOnOpen,
    setTheme: setTheme,
    showAppMenu: showAppMenu,
    confirmExit: confirmExit,
    notifyRendererReady: notifyRendererReady,

    // --- B. Project lifecycle ---------------------------------------------------------------
    openProject: openProject,
    saveProject: saveProject,
    saveProjectAs: saveProjectAs,
    verifyProjectFiles: verifyProjectFiles,
    materializeBundledProject: materializeBundledProject,

    // --- C. Chapter I/O ---------------------------------------------------------------------
    loadChapter: loadChapter,
    saveChapter: saveChapter,
    saveChapterAtomic: saveChapterAtomic,
    deleteChapterFiles: deleteChapterFiles,
    loadChapterNotes: loadChapterNotes,
    saveChapterNotes: saveChapterNotes,

    // --- D. Settings, corkboard, error log, licenses -----------------------------------------
    loadUserSettings: loadUserSettings,
    saveUserSettings: saveUserSettings,
    loadCorkboard: loadCorkboard,
    saveCorkboard: saveCorkboard,
    logError: logError,
    readErrorLog: readErrorLog,
    clearErrorLog: clearErrorLog,
    readLicenses: readLicenses,

    // --- E. Filesystem browser (the documented generic exception) ---------------------------
    listDirectory: listDirectory,
    pathExists: pathExists,
    statEntry: statEntry,
    createDirectory: createDirectory,
    moveEntry: moveEntry,
    copyEntry: copyEntry,
    deleteEntry: deleteEntry,

    // --- F. Import -----------------------------------------------------------------------
    readTextFile: readTextFile,
    extractZip: extractZip,
    importDocx: importDocx,

    // --- G. Export and compile ----------------------------------------------------------
    ensureDirectory: ensureDirectory,
    writeTextFile: writeTextFile,
    writeBinaryFile: writeBinaryFile,
    buildEpub: buildEpub,

    // --- H. Backup -----------------------------------------------------------------------
    archiveProject: archiveProject,
    listBackups: listBackups,
    pruneBackups: pruneBackups,

    // --- I. Spellcheck -----------------------------------------------------------------------
    loadDictionary: loadDictionary,
    loadPersonalDictionary: loadPersonalDictionary,
    savePersonalDictionary: savePersonalDictionary,

    // --- J. Credentials --------------------------------------------------------------------
    isSecureStorageAvailable: isSecureStorageAvailable,
    describeCredential: describeCredential,
    storeCredential: storeCredential,
    unlockCredential: unlockCredential,
    lockCredential: lockCredential,
    clearCredentials: clearCredentials,
    migrateLegacyCredential: migrateLegacyCredential,

    //Deliberately not a COMMANDS entry, and therefore not reachable through the facade. It exists
    //so sendEmail (group K, Phase 8) can turn a SAVED_SECRET into the password on this side of the
    //boundary. Anything that needs a stored secret has to live in here with it.
    resolveSecret: resolveSecret,

    // --- K. Network and hardware -------------------------------------------------------------
    checkForUpdate: checkForUpdate,
    downloadUpdate: downloadUpdate,
    installUpdate: installUpdate,
    sendEmail: sendEmail,
    wifiListNetworks: wifiListNetworks,
    wifiConnect: wifiConnect,
    wifiGetAddress: wifiGetAddress,
    wifiGetConnectionState: wifiGetConnectionState,
    wifiGetStatus: wifiGetStatus,
    wifiEnable: wifiEnable,
    wifiDisable: wifiDisable,
    getBatteryCapacity: getBatteryCapacity,

    on: on,
    off: off
  };

  // ------------------------------------------------------------------------------------------
  // Group A
  // ------------------------------------------------------------------------------------------

  //Field by field, not passed through - same reason describeCredential() copies below rather than
  //returning the store's object: a field added to `paths` for some other purpose cannot leak across
  //the boundary just by existing.
  function getAppPaths(){
    return {
      userData: paths.userData,
      home: paths.home,
      temp: paths.temp,
      docs: paths.docs,
      app: paths.app,
      downloads: paths.downloads
    };
  }

  //process.platform/process.arch are plain Node globals, present with or without nodeIntegration -
  //nothing to inject.
  function getPlatform(){
    return { platform: process.platform, arch: process.arch };
  }

  function getFileRequestedOnOpen(){
    var requested = readFileRequestedOnOpen();
    return requested == null ? null : requested;
  }

  function setTheme(args){
    onSetTheme(args == null ? null : args.mode);
  }

  function showAppMenu(){
    onShowAppMenu();
  }

  function confirmExit(){
    onConfirmExit();
  }

  function notifyRendererReady(){
    onNotifyRendererReady();
  }

  // ------------------------------------------------------------------------------------------
  // Group B
  // ------------------------------------------------------------------------------------------

  //Every path this backing is handed is normalized to forward slashes, which is what project.js
  //did at the top of loadFile() and saveAs() for linux/windows compatibility. Node accepts either
  //separator on Windows, so this is not about reaching the file - it is about the directory and
  //filename handed *back*, which the renderer concatenates with chapter filenames all over the
  //place and compares against paths from other sources.
  function normalizePath(value, name){
    requireText(value, name);
    return value.replaceAll('\\', '/');
  }

  //project.js:52-55, moved. The renderer stops splitting paths at all: openProject and
  //saveProjectAs both hand back the pieces already separated.
  function splitPath(fullPath){
    var parts = fullPath.split('/');
    var filename = parts.pop();

    return { directory: parts.join('/').concat('/'), filename: filename };
  }

  function openProject(args){
    var projPath = normalizePath(args == null ? undefined : args.path, 'path');
    var split = splitPath(projPath);

    return {
      project: JSON.parse(fs.readFileSync(projPath, 'utf8')),
      directory: split.directory,
      filename: split.filename
    };
  }

  function saveProject(args){
    requireText(args.directory, 'directory');
    requireText(args.filename, 'filename');
    requireText(args.contents, 'contents');

    fs.writeFileSync(args.directory + args.filename, args.contents, 'utf8');
  }

  //Save As, up to but not including the .woolf write - see the note on saveProject in platform.js
  //for why that last step cannot live in here.
  //
  //Two orderings in the original are preserved deliberately:
  //
  //  - The chapters subdirectory is named from the target filename *before* the .woolf extension
  //    is forced onto it, and by its last dot rather than its first. "My.Book.woolf" therefore
  //    yields "My.Book_chapters/", not "My_chapters/" - a project title containing a period used
  //    to lose everything after the first one.
  //  - mkdir is not recursive. A target whose parent directory does not exist fails here rather
  //    than quietly building a tree the reader never asked for.
  //
  //A chapter whose file has gone missing from the old location must not abort the rest of the
  //save (project.js:200-202), so each copy is caught individually: the ones that worked come back
  //in `chapterFilenames` and the ones that did not come back in `failed`, with a null holding the
  //slot so the caller can line the result up against the chapters it sent.
  function saveProjectAs(args){
    var target = normalizePath(args == null ? undefined : args.targetPath, 'targetPath');
    var split = splitPath(target);

    var extIndex = split.filename.lastIndexOf('.');
    var chapsDirectory = (extIndex > -1 ? split.filename.substring(0, extIndex) : split.filename)
      .concat(CHAPS_DIR_SUFFIX);
    var filename = split.filename.endsWith(PROJECT_EXT) ? split.filename : split.filename + PROJECT_EXT;

    if(!fs.existsSync(split.directory))
      fs.mkdirSync(split.directory);
    if(!fs.existsSync(split.directory + chapsDirectory))
      fs.mkdirSync(split.directory + chapsDirectory);

    var fromDir = (args.fromDirectory == null ? '' : args.fromDirectory)
      + (args.fromChapsDir == null ? '' : args.fromChapsDir);

    var copied = [];
    var failed = [];

    (args.chapterFilenames == null ? [] : args.chapterFilenames).forEach(function(name){
      //A chapter that has never been saved has no file to copy, and no place in `failed` either -
      //nothing went wrong.
      if(name == null){
        copied.push(null);
        return;
      }

      //Historic project files can carry a path segment in a chapter's filename; the new location
      //is flat, so only the basename survives the move.
      var basename = String(name).split('/').pop();

      try{
        fs.copyFileSync(fromDir + name, split.directory + chapsDirectory + basename);
        copied.push(basename);
      }
      catch(copyErr){
        var wrapped = fromNodeError(copyErr, { command: 'saveProjectAs' });
        copied.push(null);
        failed.push({ filename: name, code: wrapped.code, message: wrapped.message });
      }
    });

    return {
      directory: split.directory,
      filename: filename,
      chapsDirectory: chapsDirectory,
      chapterFilenames: copied,
      failed: failed
    };
  }

  //Returns the filenames that are not on disk, deduplicated - the same file can legitimately be
  //named by more than one list (a reference document pointing at a chapter's file), and the caller
  //matches its own chapters against this as a set rather than positionally.
  function verifyProjectFiles(args){
    var chaptersDir = (args.directory == null ? '' : args.directory)
      + (args.chapsDirectory == null ? '' : args.chapsDirectory);
    var missing = [];

    (args.chapterFilenames == null ? [] : args.chapterFilenames).forEach(function(name){
      //A chapter that has never been saved has no file yet, so there is no missing one to report.
      if(name == null || missing.indexOf(name) > -1)
        return;

      if(!fs.existsSync(chaptersDir + name))
        missing.push(name);
    });

    return missing;
  }

  //The bundled Frankenstein example lives inside the installed app directory, which a normal user
  //account cannot write to, so it is copied out to userData once and that copy is opened instead.
  //
  //The fallback is the interesting part. If the copy fails there is still something worth opening
  //- the bundled original - so this resolves rather than rejecting. But it comes back flagged: the
  //caller sets project.isReadOnly from `writable`, which routes Ctrl+S to Save As instead of
  //letting every later save die with EACCES in silence, and `error` says why so the failure
  //reaches the log rather than disappearing into a successful-looking return.
  function materializeBundledProject(args){
    var bundledDir = normalizePath(args == null ? undefined : args.bundledDir, 'bundledDir');
    var writableDir = normalizePath(args.writableDir, 'writableDir');
    requireText(args.filename, 'filename');

    try{
      fs.cpSync(bundledDir, writableDir, { recursive: true });
      return { path: writableDir + '/' + args.filename, writable: true, error: null };
    }
    catch(copyErr){
      var wrapped = fromNodeError(copyErr, { command: 'materializeBundledProject' });

      return {
        path: bundledDir + '/' + args.filename,
        writable: false,
        error: { code: wrapped.code, message: wrapped.message }
      };
    }
  }

  // ------------------------------------------------------------------------------------------
  // Group C
  // ------------------------------------------------------------------------------------------

  //Returns the file's text, not a parsed chapter. Which format that text is in - MarkdownFic, or
  //the JSON of a pre-1.1 `.pup` - is decided from the filename by the caller, because parsing
  //either one is pure string work with no OS in it and belongs in the webview.
  function loadChapter(args){
    var chaptersDir = chaptersDirOf(args);
    requireText(args.filename, 'filename');

    return fs.readFileSync(chaptersDir + args.filename, 'utf8');
  }

  //A chapter and its notes are one document to the reader, so they go together - deleting the
  //chapter and leaving an orphaned notes file behind is not a state the reader can see or clean up.
  function deleteChapterFiles(args){
    var chaptersDir = chaptersDirOf(args);
    requireText(args.filename, 'filename');

    if(fs.existsSync(chaptersDir + args.filename))
      fs.unlinkSync(chaptersDir + args.filename);
    if(fs.existsSync(chaptersDir + NOTES_PREPEND + args.filename))
      fs.unlinkSync(chaptersDir + NOTES_PREPEND + args.filename);
  }

  //null rather than a rejection for a chapter that simply has no notes yet, which is the ordinary
  //case for most chapters and not a failure of any kind.
  function loadChapterNotes(args){
    var chaptersDir = chaptersDirOf(args);
    requireText(args.filename, 'filename');

    var notesPath = chaptersDir + NOTES_PREPEND + args.filename;

    return fs.existsSync(notesPath) ? fs.readFileSync(notesPath, 'utf8') : null;
  }

  //Notes for a chapter whose filename is not changing. When it *is* changing they go through
  //saveChapterAtomic instead, which owns the rename - see the note there.
  function saveChapterNotes(args){
    var chaptersDir = chaptersDirOf(args);
    requireText(args.filename, 'filename');
    requireText(args.mdfc, 'mdfc');

    fs.writeFileSync(chaptersDir + NOTES_PREPEND + args.filename, args.mdfc, 'utf8');
  }

  //Filename allocation lives here, and only here. It is the reason saveChapterAtomic takes a title
  //rather than a filename: picking a free name means reading the directory, and any gap between
  //reading it and writing is a race the renderer would own. Folding the loop into the same command
  //as the write closes it, and it is why the inventory's original signature - which passed
  //`newFilename` in, implying a separate findAvailableChapterFilename call - could not be right.
  function allocateChapterFilename(chaptersDir, title){
    var root = sanitizeFilename(title != null && title !== '' ? title : 'untitled');
    var filename = root + CHAPTER_EXT;
    var copyNum = 1;

    while(fs.existsSync(chaptersDir + filename)){
      copyNum++;
      filename = root + '_' + copyNum + CHAPTER_EXT;
    }

    return filename;
  }

  //Save Copy: no old file, so no transaction - just allocate and write.
  function saveChapter(args){
    var chaptersDir = chaptersDirOf(args);
    requireText(args.mdfc, 'mdfc');

    var filename = allocateChapterFilename(chaptersDir, args.title);
    fs.writeFileSync(chaptersDir + filename, args.mdfc, 'utf8');

    return { filename: filename };
  }

  //The chapter save, as one transaction the renderer cannot mis-order.
  //
  //Today this is five ordered fs calls in the renderer with a hand-rolled rollback
  //(chapter.js:122-179). Three properties of that sequence are load-bearing and easy to lose, so
  //they are written down here rather than left to be rediscovered:
  //
  //  1. The old file is stashed *before* the new name is allocated. Allocating first would find
  //     the chapter's own file sitting under the name it wants and append `_2`, so every save of an
  //     unchanged title would rename the file and leave the previous one behind.
  //  2. The stash is deleted *last*, after the notes have been dealt with, so the previous contents
  //     survive until everything else has succeeded. The original deletes it before the notes
  //     rename; both orderings are correct, this one is strictly safer.
  //  3. A failed write is rolled back, and a failed *rollback* is a different outcome from a
  //     successful one. If the rollback also fails the chapter has no file on disk at all, and the
  //     caller must keep hasUnsavedChanges set rather than treating the failure as ordinary. That
  //     distinction is carried on the error as `rolledBack`, and is the reason this command rejects
  //     rather than returning a boolean: there are three outcomes, not two.
  //
  //The chapter's own file is the transaction. Notes are handled inside the same call - they have to
  //be, because their filename is derived from the chapter's and a separate command would leave a
  //window where they sit under the old name - but a notes failure never fails a chapter that was
  //written successfully. It comes back as `notesError` instead, so it is reported rather than
  //swallowed, which is what saveNotesFile does today (chapter.js:210-212).
  function saveChapterAtomic(args){
    var chaptersDir = chaptersDirOf(args);
    var oldFilename = args.oldFilename == null ? null : args.oldFilename;
    requireText(args.mdfc, 'mdfc');

    //1. Stash the old version under a flagged name.
    var stashedAs = null;
    if(oldFilename != null && fs.existsSync(chaptersDir + oldFilename)){
      stashedAs = OLD_VERSION_FLAG + oldFilename;
      fs.renameSync(chaptersDir + oldFilename, chaptersDir + stashedAs);
    }

    //2. Allocate, now that the chapter's own file is out of the way.
    var filename = allocateChapterFilename(chaptersDir, args.title);

    //3. Write, and put the old version back if it fails.
    try{
      fs.writeFileSync(chaptersDir + filename, args.mdfc, 'utf8');
    }
    catch(writeErr){
      if(stashedAs == null)
        throw fromNodeError(writeErr, { rolledBack: true });

      try{
        fs.renameSync(chaptersDir + stashedAs, chaptersDir + oldFilename);
      }
      catch(rollbackErr){
        throw fromNodeError(writeErr, {
          rolledBack: false,
          stashedAs: stashedAs,
          rollbackMessage: rollbackErr.message
        });
      }

      throw fromNodeError(writeErr, { rolledBack: true });
    }

    //4. Notes follow the chapter's filename, and are written if the caller supplied any.
    var notesFilename = NOTES_PREPEND + filename;
    var notesError = null;
    try{
      if(oldFilename != null && oldFilename !== filename
        && fs.existsSync(chaptersDir + NOTES_PREPEND + oldFilename))
        fs.renameSync(chaptersDir + NOTES_PREPEND + oldFilename, chaptersDir + notesFilename);

      if(args.notesMdfc != null)
        fs.writeFileSync(chaptersDir + notesFilename, args.notesMdfc, 'utf8');
    }
    catch(notesErr){
      var wrapped = fromNodeError(notesErr, { command: 'saveChapterAtomic' });
      notesError = { code: wrapped.code, message: wrapped.message };
    }

    //5. Drop the stash last. Failing here costs a stray file, not the save.
    if(stashedAs != null){
      try{
        fs.unlinkSync(chaptersDir + stashedAs);
      }
      catch(unlinkErr){
        log(unlinkErr);
      }
    }

    return { filename: filename, notesFilename: notesFilename, notesError: notesError };
  }

  function chaptersDirOf(args){
    if(args == null || typeof args.projectDir !== 'string')
      throw PlatformError(CODES.INVALID_ARGUMENT, 'A chapter command needs a projectDir.');

    return args.projectDir + (args.chapsDir == null ? '' : args.chapsDir);
  }

  function requireText(value, name){
    if(typeof value !== 'string')
      throw PlatformError(CODES.INVALID_ARGUMENT, 'Expected ' + name + ' to be text.');
  }

  // ------------------------------------------------------------------------------------------
  // Group D (error log slice)
  // ------------------------------------------------------------------------------------------

  function errorLogPath(){
    if(paths.userData == null)
      throw PlatformError(CODES.UNAVAILABLE, 'No userData directory configured for the error log.');

    return path.join(paths.userData, LOG_FILENAME);
  }

  //The truncate-then-append behavior error-log.js used to own directly. The renderer already
  //formatted `text` (timestamp + description) before this call - this backing only owns where it
  //lands and how big the file is allowed to get.
  function logError(args){
    requireText(args == null ? undefined : args.text, 'text');

    var logLocation = errorLogPath();

    if(fs.existsSync(logLocation) && fs.statSync(logLocation).size > MAX_LOG_SIZE_BYTES)
      fs.writeFileSync(logLocation, '', 'utf8');

    fs.appendFileSync(logLocation, args.text, 'utf8');
  }

  function readErrorLog(){
    var logLocation = errorLogPath();
    return fs.existsSync(logLocation) ? fs.readFileSync(logLocation, 'utf8') : '';
  }

  function clearErrorLog(){
    var logLocation = errorLogPath();
    if(fs.existsSync(logLocation))
      fs.writeFileSync(logLocation, '', 'utf8');
  }

  // ------------------------------------------------------------------------------------------
  // Group D (settings, corkboard, licenses)
  // ------------------------------------------------------------------------------------------

  function settingsPath(){
    if(paths.userData == null)
      throw PlatformError(CODES.UNAVAILABLE, 'No userData directory configured for user settings.');

    return normalizePath(paths.userData, 'userData') + '/' + SETTINGS_FILENAME;
  }

  //JSON.parse is left free to throw on a corrupt file - user-settings.js's load() already catches
  //and falls back to defaults, exactly as its own try/catch did before this moved here.
  function loadUserSettings(){
    var p = settingsPath();
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  }

  //JSON.stringify drops function-valued properties on its own, so passing the live settings object
  //(methods and all) writes exactly the same file user-settings.js's own save() used to.
  function saveUserSettings(args){
    fs.writeFileSync(settingsPath(), JSON.stringify(args == null ? undefined : args.settings, null, '\t'), 'utf8');
  }

  //Raw text in, raw text out - see the correction note on these two in platform.js. `chaptersDir` is
  //handed through as-is rather than normalized: it is always the concatenation of two already-
  //normalized pieces (project.directory + project.chapsDirectory) by the time it reaches here.
  function loadCorkboard(args){
    var chaptersDir = args == null ? undefined : args.chaptersDir;
    requireText(chaptersDir, 'chaptersDir');

    var p = chaptersDir + CORKBOARD_FILENAME;
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  }

  function saveCorkboard(args){
    requireText(args == null ? undefined : args.chaptersDir, 'chaptersDir');
    requireText(args.contents, 'contents');

    fs.writeFileSync(args.chaptersDir + CORKBOARD_FILENAME, args.contents, 'utf8');
  }

  //Silently empty rather than rejecting when the file (or the app directory itself) is missing -
  //about_display.js's own try/catch used to swallow exactly this and show an empty license panel.
  function readLicenses(){
    if(paths.app == null)
      return '';

    var p = normalizePath(paths.app, 'app') + '/' + LICENSES_FILENAME;
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  }

  // ------------------------------------------------------------------------------------------
  // Group E (filesystem browser - the documented generic exception)
  // ------------------------------------------------------------------------------------------

  //Every entry, dotfiles included - file-manager.js's getFileList() applies its own dotfile filter
  //on top, which keeps that UI policy out of a command meant to stay generic. isDirectory crosses as
  //a plain boolean (a dirent's isDirectory() method cannot survive serialization).
  function listDirectory(args){
    var p = normalizePath(args == null ? undefined : args.path, 'path');

    return fs.readdirSync(p, { withFileTypes: true }).map(function(entry){
      return { name: entry.name, isDirectory: entry.isDirectory() };
    });
  }

  function pathExists(args){
    return fs.existsSync(normalizePath(args == null ? undefined : args.path, 'path'));
  }

  function statEntry(args){
    var p = normalizePath(args == null ? undefined : args.path, 'path');
    var stats = fs.statSync(p);

    return { isDirectory: stats.isDirectory(), size: stats.size, modified: stats.mtime.toISOString() };
  }

  //Idempotent: an existing target is left alone rather than rejected, matching the
  //fs.existsSync guard createNewDirectory used to apply itself (file-manager.js:106).
  function createDirectory(args){
    var parent = normalizePath(args == null ? undefined : args.parent, 'parent');
    requireText(args.name, 'name');

    var target = parent + (parent.endsWith('/') ? '' : '/') + args.name;
    if(!fs.existsSync(target))
      fs.mkdirSync(target);

    return { path: target };
  }

  //Refuses rather than overwriting - fs.renameSync is silent about clobbering an existing
  //destination, which is exactly the bug the guard this replaces (file-manager.js:54-56) existed to
  //stop. A caller that wants the destination auto-uniquified instead (moveFiles' cut-paste policy)
  //computes a non-colliding name itself via pathExists/statEntry before calling this, the same way
  //copyFiles already does - see the note on this command in platform.js.
  function moveEntry(args){
    var source = normalizePath(args == null ? undefined : args.source, 'source');
    var destination = normalizePath(args.destination, 'destination');

    if(fs.existsSync(destination))
      throw PlatformError(CODES.ALREADY_EXISTS,
        'Cannot move "' + source + '" to "' + destination + '": the destination already exists.',
        { source: source, destination: destination });

    fs.renameSync(source, destination);
  }

  function copyEntry(args){
    var source = normalizePath(args == null ? undefined : args.source, 'source');
    var destination = normalizePath(args.destination, 'destination');

    fs.cpSync(source, destination, { recursive: args.recursive === true });
  }

  function deleteEntry(args){
    var p = normalizePath(args == null ? undefined : args.path, 'path');

    if(fs.existsSync(p))
      fs.rmSync(p, { recursive: args.recursive === true, force: true });
  }

  // ------------------------------------------------------------------------------------------
  // Group F (import)
  // ------------------------------------------------------------------------------------------

  function readTextFile(args){
    var p = normalizePath(args == null ? undefined : args.path, 'path');
    return fs.readFileSync(p, 'utf8');
  }

  //unzipper has no browser build, so extracting a zip stays native by necessity. destPath defaults
  //to zipPath with its trailing ".zip" stripped, matching file-manager.js's own unzipProject -
  //every caller today supplies destPath explicitly, so this only matters for a future one that
  //doesn't.
  function extractZip(args){
    return new Promise(function(resolve, reject){
      var zipPath = normalizePath(args == null ? undefined : args.zipPath, 'zipPath');
      var destPath = args.destPath == null
        ? zipPath.replace(/\.zip$/i, '')
        : normalizePath(args.destPath, 'destPath');

      fs.createReadStream(zipPath)
        .on('error', function(err){ reject(fromNodeError(err, { command: 'extractZip' })); })
        .pipe(unzipper.Extract({ path: destPath }))
        .on('error', function(err){ reject(fromNodeError(err, { command: 'extractZip' })); })
        .on('close', function(){ resolve({ path: destPath }); });
    });
  }

  //Unzips the docx into a directory this command owns start to finish - fs.mkdtempSync rather than
  //a fixed name under sysDirectories.temp, so two imports in flight (or one that crashed mid-import)
  //can never collide - reads out document.xml/footnotes.xml, and removes the directory again before
  //resolving. The caller (docx-import.js) gets XML text, never a path: the unzip destination is not
  //allowed to leak across the boundary, which is also why this cleans up after itself rather than
  //leaving guts behind the way the old tempUnzipDocx('.../docxguts') did.
  function importDocx(args){
    return new Promise(function(resolve, reject){
      var filepath = normalizePath(args == null ? undefined : args.path, 'path');
      var unzipDestination = fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-docx-'));

      function cleanup(){
        try{
          fs.rmSync(unzipDestination, { recursive: true, force: true });
        }
        catch(cleanupErr){
          log(cleanupErr);
        }
      }

      fs.createReadStream(filepath)
        .on('error', function(err){ cleanup(); reject(fromNodeError(err, { command: 'importDocx' })); })
        .pipe(unzipper.Extract({ path: unzipDestination }))
        .on('error', function(err){ cleanup(); reject(fromNodeError(err, { command: 'importDocx' })); })
        .on('close', function(){
          try{
            var wordDir = path.join(unzipDestination, 'word');
            var documentXml = fs.readFileSync(path.join(wordDir, 'document.xml'), 'utf8');
            var footnotesPath = path.join(wordDir, 'footnotes.xml');
            var footnotesXml = fs.existsSync(footnotesPath) ? fs.readFileSync(footnotesPath, 'utf8') : null;

            resolve({ documentXml: documentXml, footnotesXml: footnotesXml });
          }
          catch(readErr){
            reject(fromNodeError(readErr, { command: 'importDocx' }));
          }
          finally{
            cleanup();
          }
        });
    });
  }

  // ------------------------------------------------------------------------------------------
  // Group G (export and compile)
  // ------------------------------------------------------------------------------------------

  //Idempotent, same as createDirectory in group E - an existing target is left alone rather than
  //rejected.
  function ensureDirectory(args){
    var p = normalizePath(args == null ? undefined : args.path, 'path');
    if(!fs.existsSync(p))
      fs.mkdirSync(p);
  }

  function writeTextFile(args){
    var p = normalizePath(args == null ? undefined : args.path, 'path');
    requireText(args.contents, 'contents');
    fs.writeFileSync(p, args.contents, 'utf8');
  }

  //bytes crosses as whatever the caller's buffer already is (a Node Buffer today; a serialized
  //byte array once this runs over IPC/Tauri) - Buffer.from accepts either.
  function writeBinaryFile(args){
    var p = normalizePath(args == null ? undefined : args.path, 'path');
    if(args == null || args.bytes == null)
      throw PlatformError(CODES.INVALID_ARGUMENT, 'Expected bytes to write.');

    fs.writeFileSync(p, Buffer.isBuffer(args.bytes) ? args.bytes : Buffer.from(args.bytes));
  }

  //archiver has no browser build, so zipping stays native. entries are already-generated text -
  //epub.js keeps every bit of OPF/NCX/TOC/escaping logic and hands over finished file contents, not
  //chapters to assemble - see the correction note on this command in platform.js.
  //
  //Resolves on the *write stream's* 'close', not archiver's 'finish' - 'finish' only means archiver
  //pushed its last bytes into the pipe, not that fs flushed them to disk. Resolving on 'finish' would
  //risk handing off a truncated .epub that looks successful until a reader (or email-doc.js, which
  //attaches the result) opens it. This is the single most load-bearing line in this function.
  function buildEpub(args){
    return new Promise(function(resolve, reject){
      var filepath = normalizePath(args == null ? undefined : args.filepath, 'filepath');
      var entries = args.entries == null ? [] : args.entries;

      var output = createWriteStream(filepath);
      var archive = archiver('zip', { zlib: { level: 9 } });
      var settled = false;

      //An output-stream failure and archiver's own 'error' can both fire for the same underlying
      //problem; guard against settling the promise twice.
      function settle(action, value){
        if(settled) return;
        settled = true;
        action(value);
      }

      archive.on('warning', function(err){ log(err); });
      archive.on('error', function(err){ settle(reject, fromNodeError(err, { command: 'buildEpub' })); });
      output.on('error', function(err){ settle(reject, fromNodeError(err, { command: 'buildEpub' })); });
      output.on('close', function(){ settle(resolve, undefined); });

      archive.pipe(output);

      entries.forEach(function(entry){
        //The epub spec requires the "mimetype" entry to be first and stored uncompressed - a zip
        //container detail, not something epub.js's callers should have to know to ask for.
        archive.append(entry.content, { name: entry.name, store: entry.name === 'mimetype' });
      });

      archive.finalize();
    });
  }

  // ------------------------------------------------------------------------------------------
  // Group H (backup)
  // ------------------------------------------------------------------------------------------

  function archiveTimestamp(){
    var d = new Date();

    function ldZero(num){
      num = num.toString();
      return num.length < 2 ? '0' + num : num;
    }

    return d.getFullYear().toString() + ldZero(d.getMonth() + 1) + ldZero(d.getDate())
      + ldZero(d.getHours()) + ldZero(d.getMinutes()) + ldZero(d.getSeconds());
  }

  //Allocates the archive's filename itself (title + timestamp + extension) rather than taking one,
  //the same reason saveChapterAtomic allocates a chapter's filename. Same 'close'-not-'finish'
  //correctness requirement as buildEpub above - the original backup-project.js archiveProject
  //listened on archiver's 'finish', which risked a truncated backup archive; corrected here rather
  //than carried over.
  //Uses path.join rather than the group B/C convention of concatenating onto a trailing-slash-
  //terminated directory - projectDir/destDir here are not guaranteed to end in one (email-doc.js
  //passes os.tmpdir() as destDir, which does not), and unlike saveProjectAs's returned directory,
  //nothing downstream depends on this command's paths being forward-slash-normalized.
  //Phase 8 fix: an empty `filename` used to be caught only by backup-project.js's own wrapper
  //("Cannot back up a project with no filename"), one level up from here - requireText accepts an
  //empty string, since it only checks typeof. That guard did not cover this command itself, so
  //sendEmail's projectArchive attachment kind (which calls this function directly, bypassing
  //backup-project.js entirely) had no guard at all: archive.file(path.join(projectDir, ''), ...)
  //would have handed archiver a directory where it expects a file. Moved here so every caller of
  //the native command gets it, not only the one that happened to add it first.
  function archiveProject(args){
    return new Promise(function(resolve, reject){
      var projectDir = args == null ? undefined : args.projectDir;
      requireText(projectDir, 'projectDir');
      requireText(args.destDir, 'destDir');
      requireText(args.filename, 'filename');
      if(args.filename === '')
        throw PlatformError(CODES.INVALID_ARGUMENT, 'Cannot back up a project with no filename.', { command: 'archiveProject' });
      var chapsDir = args.chapsDir == null ? '' : args.chapsDir;

      var archiveName = args.filename.replace(PROJECT_EXT, '') + archiveTimestamp() + ARCHIVE_EXTENSION;
      var destPath = path.join(args.destDir, archiveName);

      var output = createWriteStream(destPath);
      var archive = archiver('zip', { zlib: { level: 9 } });
      var settled = false;

      function settle(action, value){
        if(settled) return;
        settled = true;
        action(value);
      }

      archive.on('warning', function(err){ log(err); });
      archive.on('error', function(err){ settle(reject, fromNodeError(err, { command: 'archiveProject' })); });
      output.on('error', function(err){ settle(reject, fromNodeError(err, { command: 'archiveProject' })); });
      output.on('close', function(){ settle(resolve, { filename: archiveName, path: destPath }); });

      archive.pipe(output);
      archive.file(path.join(projectDir, args.filename), { name: args.filename });
      archive.directory(path.join(projectDir, chapsDir), chapsDir === '' ? false : chapsDir);
      archive.finalize();
    });
  }

  //Same shape as listDirectory (group E), kept as its own command deliberately - see the note on it
  //in platform.js.
  function listBackups(args){
    var dir = normalizePath(args == null ? undefined : args.directory, 'directory');

    return fs.readdirSync(dir, { withFileTypes: true }).map(function(entry){
      return { name: entry.name, isDirectory: entry.isDirectory() };
    });
  }

  //One bad path is logged and does not stop the rest, matching deleteOldBackups' original
  //per-file try/catch (backup-project.js's old deleteFile()).
  function pruneBackups(args){
    var paths = args == null || args.paths == null ? [] : args.paths;

    paths.forEach(function(p){
      try{
        var normalized = normalizePath(p, 'paths[]');
        if(fs.existsSync(normalized))
          fs.rmSync(normalized, { recursive: true, force: true });
      }
      catch(err){
        log(err);
      }
    });
  }

  // ------------------------------------------------------------------------------------------
  // Group I (spellcheck dictionaries)
  // ------------------------------------------------------------------------------------------

  function loadDictionary(){
    if(paths.app == null)
      throw PlatformError(CODES.UNAVAILABLE, 'No app directory configured for the dictionary.');

    var base = normalizePath(paths.app, 'app') + '/' + DICTIONARIES_DIR + '/' + SHARED_DICT_BASENAME;

    return {
      aff: fs.readFileSync(base + '.aff', 'utf8'),
      dic: fs.readFileSync(base + '.dic', 'utf8')
    };
  }

  //Seeds the personal dictionary on first read, folding in the bootstrap write
  //createPersonalDicIfNeeded() used to require the caller run first (spellcheck.js:35-51).
  function personalDictPath(){
    if(paths.userData == null)
      throw PlatformError(CODES.UNAVAILABLE, 'No userData directory configured for the personal dictionary.');

    var dir = normalizePath(paths.userData, 'userData') + '/' + DICTIONARIES_DIR;
    if(!fs.existsSync(dir))
      fs.mkdirSync(dir);

    var p = dir + '/' + PERSONAL_DICT_FILENAME;
    if(!fs.existsSync(p))
      fs.writeFileSync(p, PERSONAL_DICT_SEED, 'utf8');

    return p;
  }

  function loadPersonalDictionary(){
    return fs.readFileSync(personalDictPath(), 'utf8').split('\n').filter(function(word){
      return word.trim() !== '';
    });
  }

  //No trailing newline added by the join, matching addWordToPersonalDictFile's original
  //personal.join("\n") - the regression it exists to preserve is the seed's own trailing newline
  //surviving as a blank entry that split()/filter() above already drops before this ever sees it.
  function savePersonalDictionary(args){
    var words = (args == null || args.words == null) ? [] : args.words;
    fs.writeFileSync(personalDictPath(), words.join('\n'), 'utf8');
  }

  // ------------------------------------------------------------------------------------------
  // Group J
  // ------------------------------------------------------------------------------------------

  function storeFor(service){
    if(service == null || services[service] == null)
      throw PlatformError(CODES.INVALID_ARGUMENT, 'Unknown credential service "' + service + '".',
        { service: service });

    if(stores[service] == null)
      stores[service] = getCredentialStore(services[service], secureStorage);

    return stores[service];
  }

  function isSecureStorageAvailable(){
    try{
      return secureStorage != null && secureStorage.isAvailable() === true;
    }
    catch(err){
      log(err);
      return false;
    }
  }

  //describe() already returns exactly what the dialogs need and nothing more. Copied field by field
  //rather than passed through, so a field added to the store cannot leak across the boundary just
  //by existing.
  function describeCredential(args){
    var described = storeFor(args.service).describe();

    return {
      hasPassword: described.hasPassword,
      backend: described.backend,
      locked: described.locked,
      secureStorageAvailable: described.secureStorageAvailable
    };
  }

  //`secret` is either a literal the writer just typed or SAVED_SECRET. The sentinel means "re-seal
  //what is already stored, under whatever protection this call asks for", which is what lets the
  //dialog tick or untick "Protect With Passphrase" on a saved password without ever holding it.
  //Resolving it here rather than in the caller is the whole point: the plaintext leaves the store,
  //goes back into the store, and never crosses the boundary in either direction.
  function storeCredential(args){
    requireText(args.secret, 'secret');

    var store = storeFor(args.service);
    var passphrase = args.passphrase == null ? null : args.passphrase;
    var secret = args.secret;

    if(secret === SAVED_SECRET){
      //resolveSecret throws LOCKED for a passphrase-protected credential that has not been
      //unlocked, which is right: re-sealing one would need the plaintext it cannot reach, and
      //saving the sentinel string as the password instead is the silent corruption this guards.
      secret = resolveSecret({ service: args.service });

      if(secret == null)
        throw PlatformError(CODES.INVALID_ARGUMENT,
          'Asked to re-seal a stored credential, but nothing is stored.', { service: args.service });
    }

    if(!store.savePassword(secret, { passphrase: passphrase }))
      throw PlatformError(CODES.IO_ERROR, 'Could not save the credential.', { service: args.service });

    return { backend: store.describe().backend };
  }

  //A wrong passphrase is an ordinary false, detected by the authentication tag - not a rejection.
  //Typing one wrongly is a normal thing a writer does.
  function unlockCredential(args){
    return storeFor(args.service).unlock(args.passphrase) === true;
  }

  //The session key lives in the store instance's closure and nowhere else, so dropping the instance
  //is what locks. Nothing in credential-store.js has to know this exists.
  function lockCredential(args){
    if(args == null || services[args.service] == null)
      throw PlatformError(CODES.INVALID_ARGUMENT, 'Unknown credential service "'
        + (args == null ? args : args.service) + '".');

    delete stores[args.service];
  }

  function clearCredentials(args){
    var store = storeFor(args.service);

    if(!store.clear())
      throw PlatformError(CODES.IO_ERROR, 'Could not clear the credential.', { service: args.service });

    delete stores[args.service];
  }

  //Versions up to 2.2.1 kept the password in user-settings.json under a key that shipped in the
  //source. The renderer hands over the blob it found there and learns only what it needs - the
  //decrypt and the re-seal both happen here, so the recovered plaintext never crosses.
  //
  //Clearing the settings field afterward stays with the caller: it owns user-settings.json, and
  //this command has no business writing it. That is why there are two flags rather than one, and
  //why the difference matters (corrected in Phase 7 - the contract declared `{ migrated }` alone):
  //
  //  recognized - the blob was in the pre-2.2.2 format. The settings field is dead either way and
  //               the caller should clear it. This is what the old migrateLegacyPassword returned.
  //  migrated   - a password was actually recovered and re-sealed.
  //
  //They differ for a blob that is legacy-shaped but decrypts to nothing - a 2.2.1 user who ticked
  //"remember" with an empty password field has exactly that in their settings file. The old code
  //cleared the field for them; reporting only `migrated` would leave a dead blob there to be
  //retried on every launch, forever, with nothing ever saying so.
  function migrateLegacyCredential(args){
    if(!isLegacyBlob(args.legacyBlob))
      return { recognized: false, migrated: false };

    var store = storeFor(args.service);
    var recovered = decryptLegacy(args.legacyBlob);

    if(recovered == null || recovered === '')
      return { recognized: true, migrated: false };

    //Throwing rather than returning `migrated: false` is deliberate, and is the one place this
    //command does not preserve migrateLegacyPassword's behaviour. The old code ignored a failed
    //save and cleared userSettings.senderPass regardless, destroying the only copy of the
    //password. A rejection leaves the legacy blob where it is, so the next launch tries again.
    if(!store.savePassword(recovered))
      throw PlatformError(CODES.IO_ERROR, 'Could not re-seal the legacy credential.',
        { service: args.service });

    return { recognized: true, migrated: true };
  }

  //Not a command. See the note where it is exported.
  function resolveSecret(args){
    var store = storeFor(args.service);
    var described = store.describe();

    if(!described.hasPassword)
      return null;
    if(described.locked)
      throw PlatformError(CODES.LOCKED, 'The saved credential is passphrase-protected and locked.',
        { service: args.service });

    return store.getPassword();
  }

  // ------------------------------------------------------------------------------------------
  // Group K (updates)
  // ------------------------------------------------------------------------------------------

  //Only the network round-trip crosses. Shaping the response into what the About panel wants
  //(matching a release tag against the running version, picking the right asset for this
  //platform/arch) is pure data work with no OS dependency and stays in updates.js, the same
  //reason group D keeps corkboard's marker-escaping out of this file - this resolves with
  //whatever JSON GitHub's API actually returned, parsed and nothing more.
  function checkForUpdate(){
    return new Promise(function(resolve, reject){
      var requestOptions = {
        hostname: RELEASE_API_HOSTNAME,
        path: RELEASE_API_PATH,
        method: 'GET',
        headers: { 'User-Agent': 'warewoolf' },
        timeout: RELEASE_CHECK_TIMEOUT_MS
      };

      var req = httpsRequest(requestOptions, function(res){
        var chunks = [];

        res.on('data', function(chunk){ chunks.push(chunk); });
        res.on('end', function(){
          var body = Buffer.concat(chunks).toString();

          if(res.statusCode !== 200){
            reject(PlatformError(CODES.IO_ERROR,
              'GitHub release check failed with status ' + res.statusCode + ': ' + body,
              { command: 'checkForUpdate' }));
            return;
          }

          try{
            resolve(JSON.parse(body));
          }
          catch(parseErr){
            reject(fromNodeError(parseErr, { command: 'checkForUpdate' }));
          }
        });
      });

      req.on('timeout', function(){
        req.destroy(new Error('Update check timed out'));
      });

      req.on('error', function(err){
        reject(fromNodeError(err, { command: 'checkForUpdate' }));
      });

      req.end();
    });
  }

  //destPath is fully resolved by the caller (updates.js builds it from getAppPaths()'s own
  //temp/downloads and the asset name checkForUpdate's caller matched) - this command's own
  //contribution is the download itself: skip it if the file is already there, follow one GitHub
  //redirect, and resolve only once the write stream's 'close' fires. The original updates.js
  //resolved on 'finish' here, the identical truncated-file risk Phase 6 fixed in buildEpub and
  //archiveProject - corrected the same way rather than carried over.
  //
  //A path this resolves to is remembered as "produced by this backing" so a later installUpdate
  //call against the *same path* is allowed to proceed - see installUpdate below. Vouching on the
  //already-downloaded shortcut too, not only a fresh download, is deliberate: a file this backing
  //can see sitting at the exact path it would itself have written the release asset to is exactly
  //as trustworthy as one it just wrote.
  function downloadUpdate(args){
    return new Promise(function(resolve, reject){
      var url = args == null ? undefined : args.url;
      var destPath = args == null ? undefined : args.destPath;
      requireText(url, 'url');
      requireText(destPath, 'destPath');

      if(fs.existsSync(destPath)){
        vouchedUpdatePaths.add(destPath);
        resolve({ path: destPath });
        return;
      }

      var file = createWriteStream(destPath);
      var settled = false;
      var downloadErr = null;

      function settle(action, value){
        if(settled) return;
        settled = true;
        action(value);
      }

      file.on('close', function(){
        if(downloadErr != null){
          try{ fs.unlinkSync(destPath); } catch(unlinkErr){}
          settle(reject, fromNodeError(downloadErr, { command: 'downloadUpdate' }));
          return;
        }

        vouchedUpdatePaths.add(destPath);
        settle(resolve, { path: destPath });
      });

      file.on('error', function(err){ downloadErr = err; });

      function requestUrl(currentUrl){
        var req = httpsGet(currentUrl, function(response){
          if(response.statusCode == 302){
            response.resume();
            requestUrl(response.headers.location);
            return;
          }

          if(response.statusCode !== 200){
            response.resume();
            downloadErr = new Error('Download failed: ' + response.statusCode);
            file.destroy();
            return;
          }

          response.pipe(file);
        });

        req.on('error', function(err){
          downloadErr = err;
          file.destroy();
        });

        req.end();
      }

      requestUrl(url);
    });
  }

  //The one command in the whole contract that escalates privilege - sudo apt install, run behind
  //a bridge, on a path a renderer could otherwise name however it likes. The guard: `path` must be
  //one this same backing instance vouched for via a prior downloadUpdate call (see above), or this
  //rejects before ever spawning sudo. That is a session-scoped allowlist of exactly one kind of
  //entry - "a release asset this process itself downloaded" - not a filename pattern or directory
  //check, which a renderer-composed path could still satisfy by construction.
  //
  //The password crosses once, outbound, exactly as it did before this conversion - the writer
  //typed it into the DOM, same as sendEmail's literal-password case - and is written to the
  //child's stdin rather than argv, so it never appears in `ps`. `path` is a separate argv element
  //from the sudo/apt/install tokens, so shell metacharacters in it (which a malicious release
  //asset filename could contain) cannot inject additional commands.
  function installUpdate(args){
    return new Promise(function(resolve, reject){
      var targetPath = args == null ? undefined : args.path;
      requireText(targetPath, 'path');
      requireText(args.password, 'password');

      if(!vouchedUpdatePaths.has(targetPath)){
        reject(PlatformError(CODES.INVALID_ARGUMENT,
          'Refusing to install "' + targetPath + '": it was not produced by this session\'s downloadUpdate.',
          { command: 'installUpdate' }));
        return;
      }

      var updater;
      try{
        updater = spawnProcess('sudo', ['-S', 'apt', 'install', targetPath], { stdio: 'pipe' });
      }
      catch(spawnErr){
        reject(fromNodeError(spawnErr, { command: 'installUpdate' }));
        return;
      }

      updater.stdin.write(args.password + '\n');
      updater.stdin.end();

      var output = '';
      updater.stdout.on('data', function(data){ output += data; });
      updater.stderr.on('data', function(data){ output += data; });

      updater.on('error', function(err){
        reject(fromNodeError(err, { command: 'installUpdate' }));
      });

      updater.on('close', function(exitCode){
        if(exitCode === 0){
          resolve(undefined);
          return;
        }

        reject(PlatformError(CODES.IO_ERROR,
          'Installation failed (exit code ' + exitCode + ').' + (output.trim() ? ' ' + output.trim() : ''),
          { command: 'installUpdate', exitCode: exitCode }));
      });
    });
  }

  // ------------------------------------------------------------------------------------------
  // Group K (email)
  // ------------------------------------------------------------------------------------------

  //sendEmail is why getCredential does not exist (see platform.js) and it closes Phase 7's one
  //standing rule-6 exception: `secret` may be SAVED_SECRET, resolved here via the same
  //resolveSecret() storeCredential already uses, so the plaintext never crosses the boundary for a
  //saved password - only a literal the writer just typed does, exactly once, outbound.
  //
  //`attachments` never carries a path the renderer composed. Every entry is one of:
  //  - { filename, content, encoding? }        literal bytes/text the caller already generated
  //  - { filename?, projectArchive: {...} }     "zip this project" - see buildProjectArchiveAttachment
  //  - { filename, epubEntries: [...] }         pre-assembled epub.js entries - see buildEpubAttachment
  //The latter two are native-generated content: this command builds them into its own temp file,
  //reads the bytes back, and deletes the temp file before resolving or rejecting - the renderer
  //hands over content (or, for a project/epub, the identities needed to build it) and never learns
  //a temp path, which is the absorption email-doc.js's old os.tmpdir() dance needed.
  function sendEmail(args){
    return new Promise(function(resolve, reject){
      requireText(args == null ? undefined : args.sender, 'sender');
      requireText(args.receiver, 'receiver');

      var secret;
      try{
        secret = args.secret === SAVED_SECRET ? resolveSecret({ service: args.service }) : args.secret;
      }
      catch(err){
        reject(err);
        return;
      }

      if(secret == null){
        reject(PlatformError(CODES.INVALID_ARGUMENT, 'No saved password is available.', { command: 'sendEmail' }));
        return;
      }
      requireText(secret, 'secret');

      resolveAttachments(args.attachments == null ? [] : args.attachments)
        .then(function(resolved){
          var transporter = createMailTransport({
            service: 'gmail',
            auth: { user: args.sender, pass: secret }
          });

          transporter.sendMail({
            from: args.sender,
            to: args.receiver,
            subject: args.subject == null ? 'WareWoolf backup' : args.subject,
            text: args.body == null ? 'Document will be attached.' : args.body,
            attachments: resolved.attachments
          }, function(mailErr){
            resolved.cleanup();

            if(mailErr != null){
              reject(fromNodeError(mailErr, { command: 'sendEmail' }));
              return;
            }

            resolve(undefined);
          });
        })
        .catch(function(err){
          reject(fromNodeError(err, { command: 'sendEmail' }));
        });
    });
  }

  //Resolves every attachment descriptor to { filename, content, encoding? } plus a cleanup() for
  //any temp file it created, in parallel. Promise.allSettled rather than Promise.all: a project
  //archive and an epub each own a temp directory, and if one attachment fails while another has
  //already succeeded, the successful one's temp directory must still be removed rather than
  //orphaned - Promise.all's short-circuit on the first rejection would otherwise leave it behind.
  function resolveAttachments(list){
    return Promise.allSettled(list.map(buildAttachment)).then(function(results){
      var rejected = results.find(function(r){ return r.status === 'rejected'; });

      if(rejected != null){
        results.forEach(function(r){
          if(r.status === 'fulfilled')
            try{ r.value.cleanup(); } catch(cleanupErr){ log(cleanupErr); }
        });
        throw rejected.reason;
      }

      return {
        attachments: results.map(function(r){ return r.value.attachment; }),
        cleanup: function(){
          results.forEach(function(r){
            try{ r.value.cleanup(); } catch(cleanupErr){ log(cleanupErr); }
          });
        }
      };
    });
  }

  function buildAttachment(item){
    if(item == null)
      return Promise.reject(PlatformError(CODES.INVALID_ARGUMENT, 'Every attachment needs a filename.'));

    if(item.content != null){
      requireText(item.filename, 'attachment filename');
      return Promise.resolve({
        attachment: { filename: item.filename, content: item.content, encoding: item.encoding },
        cleanup: function(){}
      });
    }

    if(item.projectArchive != null)
      return buildProjectArchiveAttachment(item);

    if(item.epubEntries != null){
      requireText(item.filename, 'attachment filename');
      return buildEpubAttachment(item);
    }

    return Promise.reject(PlatformError(CODES.INVALID_ARGUMENT,
      'Attachment "' + (item.filename || '?') + '" has no content, projectArchive, or epubEntries.'));
  }

  //Reuses archiveProject (group H) unchanged, pointed at a temp directory this call owns start to
  //finish - the same "own an fs.mkdtempSync() directory, clean it up in a finally-equivalent"
  //shape importDocx (group F) already established. The archive's real name is whatever
  //archiveProject allocated (project title + timestamp) unless the caller supplied one; either
  //way the renderer never sees the temp path, only the finished bytes.
  function buildProjectArchiveAttachment(item){
    var pa = item.projectArchive;
    var projectDir = pa == null ? undefined : pa.projectDir;

    try{
      requireText(projectDir, 'projectArchive.projectDir');
      requireText(pa.sourceFilename, 'projectArchive.sourceFilename');
    }
    catch(validationErr){
      return Promise.reject(validationErr);
    }

    var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-email-'));

    return archiveProject({
      projectDir: projectDir,
      chapsDir: pa.chapsDir == null ? '' : pa.chapsDir,
      filename: pa.sourceFilename,
      destDir: tempDir
    }).then(function(result){
      return {
        attachment: { filename: item.filename || result.filename, content: fs.readFileSync(result.path) },
        cleanup: function(){ fs.rmSync(tempDir, { recursive: true, force: true }); }
      };
    }).catch(function(err){
      fs.rmSync(tempDir, { recursive: true, force: true });
      throw err;
    });
  }

  //Same shape, reusing buildEpub (group G) unchanged - epub.js assembles the entries (pure string
  //work, unchanged from the export path) and hands them over; this zips them into its own temp
  //file, reads the bytes back, and deletes the temp file, all before sendEmail ever calls
  //transporter.sendMail.
  function buildEpubAttachment(item){
    var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-email-'));
    var tempPath = path.join(tempDir, 'attachment.epub');

    return buildEpub({ filepath: tempPath, entries: item.epubEntries }).then(function(){
      return {
        attachment: { filename: item.filename, content: fs.readFileSync(tempPath) },
        cleanup: function(){ fs.rmSync(tempDir, { recursive: true, force: true }); }
      };
    }).catch(function(err){
      fs.rmSync(tempDir, { recursive: true, force: true });
      throw err;
    });
  }

  // ------------------------------------------------------------------------------------------
  // Group K (wifi and battery)
  // ------------------------------------------------------------------------------------------

  //nmcli's -t (terse) output escapes a literal ':' or '\' inside a field as '\:'/'\\', so a plain
  //split(':') misaligns fields whenever a value (an SSID, say) contains a colon. Used by every
  //nmcli-backed command below; wifi-manager.js no longer keeps its own copy for
  //getConnectionState/getWifiStatus - the whole parse now lives here, once.
  function splitNmcliFields(line){
    return line.split(/(?<!\\):/).map(function(field){
      return field.replace(/\\(.)/g, '$1');
    });
  }

  function unavailableOrIoError(err, command){
    return err != null && err.code === 'ENOENT'
      ? PlatformError(CODES.UNAVAILABLE, command + ' needs nmcli, which is not installed on this machine.', { command: command })
      : fromNodeError(err, { command: command });
  }

  function wifiListNetworks(){
    return new Promise(function(resolve, reject){
      var nmcli;
      try{
        nmcli = spawnProcess('nmcli', ['-t', 'device', 'wifi', 'list', '--rescan', 'yes']);
      }
      catch(spawnErr){
        reject(unavailableOrIoError(spawnErr, 'wifiListNetworks'));
        return;
      }

      var chunks = [];
      var spawnFailed = false;

      nmcli.stdout.on('data', function(data){ chunks.push(data); });
      nmcli.stderr.on('data', function(data){ log(new Error(data.toString().trim())); });

      nmcli.on('error', function(err){
        spawnFailed = true;
        reject(unavailableOrIoError(err, 'wifiListNetworks'));
      });

      nmcli.on('close', function(){
        if(spawnFailed) return;

        var networks = Buffer.concat(chunks).toString().split('\n').map(function(line){
          var fields = splitNmcliFields(line);
          return { ssid: fields[7], isConnected: fields[0] === '*' };
        }).filter(function(net){
          return net.ssid != null && net.ssid !== '';
        });

        resolve(networks);
      });
    });
  }

  //ssid/psk are passed as separate argv elements, never interpolated into a command string - the
  //same discipline installUpdate's password-via-stdin follows, applied here because nmcli takes
  //the password as an ordinary argument rather than reading stdin.
  function wifiConnect(args){
    return new Promise(function(resolve, reject){
      var ssid = args == null ? undefined : args.ssid;
      requireText(ssid, 'ssid');
      var psk = args.psk == null ? null : args.psk;

      var connectArgs = psk == null
        ? ['device', 'wifi', 'connect', ssid]
        : ['device', 'wifi', 'connect', ssid, 'password', psk];

      var nmcli;
      try{
        nmcli = spawnProcess('nmcli', connectArgs);
      }
      catch(spawnErr){
        reject(unavailableOrIoError(spawnErr, 'wifiConnect'));
        return;
      }

      var chunks = [];
      var spawnFailed = false;

      nmcli.stdout.on('data', function(data){ chunks.push(data); });
      nmcli.stderr.on('data', function(data){ chunks.push(data); });

      nmcli.on('error', function(err){
        spawnFailed = true;
        reject(unavailableOrIoError(err, 'wifiConnect'));
      });

      nmcli.on('close', function(exitCode){
        if(spawnFailed) return;

        if(exitCode === 0){
          resolve(undefined);
          return;
        }

        var output = Buffer.concat(chunks).toString().trim();
        reject(PlatformError(CODES.IO_ERROR,
          output || ('nmcli exited with code ' + exitCode), { command: 'wifiConnect' }));
      });
    });
  }

  function wifiGetAddress(){
    return new Promise(function(resolve, reject){
      var hostnameCmd;
      try{
        hostnameCmd = spawnProcess('hostname', ['-I']);
      }
      catch(spawnErr){
        reject(unavailableOrIoError(spawnErr, 'wifiGetAddress'));
        return;
      }

      var chunks = [];
      var spawnFailed = false;

      hostnameCmd.stdout.on('data', function(data){ chunks.push(data); });
      hostnameCmd.stderr.on('data', function(data){ log(new Error(data.toString().trim())); });

      hostnameCmd.on('error', function(err){
        spawnFailed = true;
        reject(unavailableOrIoError(err, 'wifiGetAddress'));
      });

      hostnameCmd.stdout.on('close', function(){
        if(spawnFailed) return;

        var text = Buffer.concat(chunks).toString().trim().split(' ')[0];
        resolve(text || '');
      });
    });
  }

  //Same query shape as wifiListNetworks/wifiGetAddress above: resolve on 'close' from accumulated
  //stdout, not on the exit code - nmcli reports "no wifi device" through its *output*, not a
  //non-zero exit, so checking the code here would treat an ordinary empty result as a failure.
  function wifiGetConnectionState(){
    return new Promise(function(resolve, reject){
      var nmcli;
      try{
        nmcli = spawnProcess('nmcli', ['-t', 'device', 'status']);
      }
      catch(spawnErr){
        reject(unavailableOrIoError(spawnErr, 'wifiGetConnectionState'));
        return;
      }

      var chunks = [];
      var spawnFailed = false;

      nmcli.stdout.on('data', function(data){ chunks.push(data); });
      nmcli.stderr.on('data', function(data){ log(new Error(data.toString().trim())); });

      nmcli.on('error', function(err){
        spawnFailed = true;
        reject(unavailableOrIoError(err, 'wifiGetConnectionState'));
      });

      nmcli.on('close', function(){
        if(spawnFailed) return;

        var lines = Buffer.concat(chunks).toString().split('\n');
        var wifiLine = lines.find(function(line){
          return splitNmcliFields(line)[1] === 'wifi';
        });

        if(wifiLine == null){
          resolve({ state: 'unknown', connection: null });
          return;
        }

        var fields = splitNmcliFields(wifiLine);
        resolve({ state: fields[2], connection: fields[3] });
      });
    });
  }

  function wifiGetStatus(){
    return new Promise(function(resolve, reject){
      var nmcli;
      try{
        nmcli = spawnProcess('nmcli', ['radio', 'wifi']);
      }
      catch(spawnErr){
        reject(unavailableOrIoError(spawnErr, 'wifiGetStatus'));
        return;
      }

      var chunks = [];
      var spawnFailed = false;

      nmcli.stdout.on('data', function(data){ chunks.push(data); });
      nmcli.stderr.on('data', function(data){ log(new Error(data.toString().trim())); });

      nmcli.on('error', function(err){
        spawnFailed = true;
        reject(unavailableOrIoError(err, 'wifiGetStatus'));
      });

      nmcli.on('close', function(){
        if(spawnFailed) return;
        resolve(Buffer.concat(chunks).toString().trim());
      });
    });
  }

  //Shared by wifiEnable/wifiDisable below - a mutation, like wifiConnect, so (unlike the two query
  //functions above) it checks the exit code and rejects IO_ERROR with nmcli's own output on
  //failure rather than resolving regardless.
  function setWifiRadio(enabled, commandName){
    return new Promise(function(resolve, reject){
      var nmcli;
      try{
        nmcli = spawnProcess('nmcli', ['radio', 'wifi', enabled ? 'on' : 'off']);
      }
      catch(spawnErr){
        reject(unavailableOrIoError(spawnErr, commandName));
        return;
      }

      var chunks = [];
      var spawnFailed = false;

      nmcli.stdout.on('data', function(data){ chunks.push(data); });
      nmcli.stderr.on('data', function(data){ chunks.push(data); });

      nmcli.on('error', function(err){
        spawnFailed = true;
        reject(unavailableOrIoError(err, commandName));
      });

      nmcli.on('close', function(exitCode){
        if(spawnFailed) return;

        if(exitCode === 0){
          resolve(undefined);
          return;
        }

        var output = Buffer.concat(chunks).toString().trim();
        reject(PlatformError(CODES.IO_ERROR,
          output || (commandName + ' exited with code ' + exitCode), { command: commandName }));
      });
    });
  }

  function wifiEnable(){
    return setWifiRadio(true, 'wifiEnable');
  }

  function wifiDisable(){
    return setWifiRadio(false, 'wifiDisable');
  }

  //Folds getBatteryName() + queryKernel() (battery-monitor.js, before this phase) into one call.
  //No battery present is UNAVAILABLE, not a resolved null - CODES.UNAVAILABLE's own doc comment
  //already names "no battery" as the example this code is for, and it is the everyday outcome on
  //every machine that isn't a writerDeck, not an edge case a caller should have to distinguish
  //from a real read failure (IO_ERROR, below).
  function getBatteryCapacity(){
    return new Promise(function(resolve, reject){
      var entries;
      try{
        entries = fs.readdirSync(POWER_SUPPLY_PATH);
      }
      catch(readErr){
        reject(PlatformError(CODES.UNAVAILABLE, 'No battery is present on this machine.', { command: 'getBatteryCapacity' }));
        return;
      }

      var batteryName = entries.filter(function(name){ return name.startsWith('BAT'); })[0];
      if(batteryName == null){
        reject(PlatformError(CODES.UNAVAILABLE, 'No battery is present on this machine.', { command: 'getBatteryCapacity' }));
        return;
      }

      var cat;
      try{
        cat = spawnProcess('cat', [path.join(POWER_SUPPLY_PATH, batteryName, 'capacity')]);
      }
      catch(spawnErr){
        reject(fromNodeError(spawnErr, { command: 'getBatteryCapacity' }));
        return;
      }

      var output = '';
      var spawnFailed = false;

      cat.stdout.on('data', function(data){ output += data.toString(); });
      cat.stderr.on('data', function(data){ log(new Error(data.toString().trim())); });

      cat.on('error', function(err){
        spawnFailed = true;
        reject(fromNodeError(err, { command: 'getBatteryCapacity' }));
      });

      cat.stdout.on('close', function(){
        if(spawnFailed) return;

        var parsed = parseInt(output.trim(), 10);
        if(output.trim() === '' || isNaN(parsed))
          reject(PlatformError(CODES.IO_ERROR, 'Could not read battery capacity.', { command: 'getBatteryCapacity' }));
        else
          resolve(parsed);
      });
    });
  }

  // ------------------------------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------------------------------

  //Nothing dispatches these under the node backing - there is no main process to send them. They
  //exist so tests can drive an event-driven path, and so the contract has one shape everywhere.
  function on(event, handler){
    if(listeners[event] == null)
      listeners[event] = [];
    listeners[event].push(handler);
  }

  function off(event, handler){
    if(listeners[event] == null)
      return;
    listeners[event] = listeners[event].filter(function(registered){
      return registered !== handler;
    });
  }
}

module.exports = {
  createNodeBacking: createNodeBacking,
  CHAPTER_EXT: CHAPTER_EXT,
  NOTES_PREPEND: NOTES_PREPEND,
  OLD_VERSION_FLAG: OLD_VERSION_FLAG,
  PROJECT_EXT: PROJECT_EXT,
  CHAPS_DIR_SUFFIX: CHAPS_DIR_SUFFIX
};
