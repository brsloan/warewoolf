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
const nodeCrypto = require('crypto');
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
//Group I: spellcheck dictionaries. Bundled pairs ship under the app directory; imported ones live
//alongside the personal dictionary under userData, since paths.app is often read-only and is wiped
//by the next update. SHARED_DICT_BASENAME is loadDictionaries' fallback when a selection resolves to
//nothing at all, not the only dictionary any more. The personal one is a per-user file under
//userData, seeded on first read exactly as createPersonalDicIfNeeded() used to (spellcheck.js:35-51).
const DICTIONARIES_DIR = 'dictionaries';
const SHARED_DICT_BASENAME = 'en_US-large';
const PERSONAL_DICT_FILENAME = 'personal.dic';
const PERSONAL_DICT_SEED = 'WareWoolf\n';
//What a dictionary id may not contain - see isValidDictionaryId below for why an id is checked at
//all. Module scope rather than inside createNodeBacking: everything in there below the `return` is
//a hoisted function declaration, so a `var` initialized down beside its callers would never be
//assigned at all.
//
//Deliberately structural rather than a character allowlist: a dictionary someone downloads may
//legitimately be named with spaces or accents, and refusing those would reject a usable file for no
//reason. What is refused is anything that could denote something other than a single name in the
//directory being addressed - a separator of either kind, a drive-relative "C:name", or a control
//character.
const DICTIONARY_ID_FORBIDDEN = /[\/\\:\x00-\x1f]/;

//Group H: backup archives. Timestamp shape and extension moved here verbatim from
//backup-project.js's own getTimeStamp()/ARCHIVE_EXTENSION - allocating the archive's name is now
//this command's job, the same reason saveChapterAtomic allocates a chapter's filename instead of
//taking one.
const ARCHIVE_EXTENSION = '.zip';

//Group K: the GitHub Releases endpoint updates.js used to hit directly.
const RELEASE_REPO = 'brsloan/warewoolf';
const RELEASE_API_HOSTNAME = 'api.github.com';
const RELEASE_API_PATH = '/repos/' + RELEASE_REPO + '/releases/latest';
const RELEASE_CHECK_TIMEOUT_MS = 10000;
//Where downloadUpdate is allowed to fetch from, spelled off the same repo constant as the API path
//above so the two cannot drift. checkForUpdate's own response is the only legitimate source of an
//asset URL, and every browser_download_url in it has exactly this shape.
const RELEASE_ASSET_HOSTNAME = 'github.com';
const RELEASE_ASSET_PATH_PREFIX = '/' + RELEASE_REPO + '/releases/download/';
//The asset filename downloadUpdate will accept off that URL's last path segment. An allowlist, not
//a sanitizer: a name that does not match is refused rather than scrubbed into something else, and
//refusing a leading '-' or '.' means the path this backing builds can never be read as an option or
//climb out of the directory it allocated.
const RELEASE_ASSET_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._+-]*$/;
const UPDATE_DIR_PREFIX = 'warewoolf-update-';
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
  //
  //Phase 9c: a Map, not a Set, and that is the fix rather than a detail of it. A vouch keyed only by
  //path says "the renderer asked for this path once"; keyed to the sha256 of the bytes this backing
  //downloaded, it says "these are the bytes I fetched from the releases host", which is the thing
  //installUpdate actually needs to know. writeBinaryFile is a conceded arbitrary write (group G) and
  //stays one, so the vouched path remains writable by the renderer - what changes is that rewriting
  //it invalidates the vouch instead of inheriting it.
  var vouchedUpdates = new Map();
  //A test seam, not a configuration knob: installUpdate is linux-only, and downloadUpdate's choice
  //of destination directory turns on the same platform, so without this neither branch could be
  //exercised on the machine this suite usually runs on. Read at call time, not captured here, so a
  //test that redefines process.platform after constructing a backing still sees it.
  var platformOverride = options.platform || null;

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
    importEpub: importEpub,

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
    loadDictionaries: loadDictionaries,
    listDictionaries: listDictionaries,
    readDictionaryFiles: readDictionaryFiles,
    importDictionary: importDictionary,
    removeDictionary: removeDictionary,
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
  //nothing to inject, apart from the `platform` test seam described above.
  //`electron` is the Electron this build was packaged against, or null anywhere Electron is not the
  //host (the test harness, plain node). updates.js needs it to tell the two macOS lineages apart:
  //the legacy mac build ships a pinned older Electron and follows its own release asset. It cannot
  //be read on the renderer side - process.versions is not there with nodeIntegration off - and it
  //is deliberately the packaged Electron rather than the host's OS version, because a legacy build
  //runs perfectly well on a new mac and has to keep updating along the legacy track when it does.
  function getPlatform(){
    return {
      platform: currentPlatform(),
      arch: process.arch,
      electron: process.versions.electron || null
    };
  }

  function currentPlatform(){
    return platformOverride || process.platform;
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

  //An epub's text, keyed by the path the archive stores it under. Unlike importDocx this never
  //extracts anything: unzipper.Open reads the central directory and pulls one entry's bytes at a
  //time, so there is no temp directory to own, clean up, or leave behind if the process dies
  //mid-import - and no chance of a hostile entry name ("../../..") writing anywhere, because
  //nothing is written at all.
  //
  //Only text entries are read. Everything else in a book - the cover jpeg, embedded fonts, audio -
  //is skipped before its bytes are ever touched, so a 250KB cover image costs nothing and cannot
  //reach the renderer. That is the enforcement point for "images are stripped"; html-import.js
  //dropping <img> tags is the second line of the same defence, for markup that names a picture the
  //archive no longer carries.
  function importEpub(args){
    var filepath = normalizePath(args == null ? undefined : args.path, 'path');

    return unzipper.Open.file(filepath).then(function(directory){
      var entries = {};

      var reads = directory.files.filter(function(entry){
        return entry.type === 'File' && isEpubTextEntry(entry.path);
      }).map(function(entry){
        return entry.buffer().then(function(buffer){
          //A BOM is legal at the head of an XML/CSS file and is not part of the content - left in,
          //it becomes a stray character in front of the first tag and DOMParser reads the document
          //as malformed.
          entries[normalizeEntryPath(entry.path)] = stripBom(buffer.toString('utf8'));
        });
      });

      return Promise.all(reads).then(function(){
        return { entries: entries };
      });
    }).catch(function(err){
      //A file that is not a zip at all rejects out of unzipper with no errno, so it lands on
      //IO_ERROR rather than pretending to be a missing file. A genuinely missing path still carries
      //ENOENT and still arrives as NOT_FOUND.
      throw fromNodeError(err, { command: 'importEpub' });
    });
  }

  //Written as the escape rather than the character itself so it stays visible in a diff.
  function stripBom(text){
    return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  }

  //By extension, not by the OPF's declared media types: the manifest is one of the things being
  //read, so it cannot be consulted to decide what to read. Everything an epub expresses in text is
  //covered, plus the extensionless "mimetype" file the spec puts first in every archive.
  function isEpubTextEntry(entryPath){
    var name = normalizeEntryPath(entryPath);
    return name === 'mimetype' || /\.(?:xhtml|html|htm|xml|opf|ncx|css|txt)$/i.test(name);
  }

  //Zip paths are stored with forward slashes, but not every writer obeys that, and a leading "./"
  //is legal. Both are normalized away here so the renderer can resolve an OPF href against an entry
  //name by plain string work.
  function normalizeEntryPath(entryPath){
    return String(entryPath).replaceAll('\\', '/').replace(/^\.\//, '');
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

  function bundledDictDir(){
    return paths.app == null ? null : normalizePath(paths.app, 'app') + '/' + DICTIONARIES_DIR;
  }

  function importedDictDir(){
    return paths.userData == null ? null : normalizePath(paths.userData, 'userData') + '/' + DICTIONARIES_DIR;
  }

  //An id names one file in one of the two dictionary directories, and every id this app produces is
  //a basename readDictionaryFiles already stripped of its directory. It still has to be checked
  //here, because it is the one value in group I that arrives from the renderer and is then joined
  //into a path: "../../x" would otherwise write and unlink outside the dictionaries directory
  //entirely. That is not a privilege the renderer lacks - writeTextFile (group G) and deleteEntry
  //(group E) are generic by design - but every other path in this group is composed natively, and
  //rule 2 of the contract (see platform.js) is that a command takes identities rather than paths.
  //An id is that identity, so it has to actually be one. See DICTIONARY_ID_FORBIDDEN above.
  //
  function isValidDictionaryId(id){
    if(typeof id !== 'string' || id === '')
      return false;
    if(DICTIONARY_ID_FORBIDDEN.test(id))
      return false;
    //Also covers "." and "..", and keeps an id from producing a dotfile named for its extension
    //alone - an empty id used to write files literally called ".aff" and ".dic".
    return id.charAt(0) !== '.';
  }

  function requireDictionaryId(id){
    if(!isValidDictionaryId(id))
      throw PlatformError(CODES.INVALID_ARGUMENT,
        'Not a usable dictionary name: "' + id + '".', { id: id });
  }

  //A dictionary is a .aff/.dic pair sharing a basename - that basename is its id, resolved bundled
  //first so an id that (should never, but could on a hand-edited disk) exist in both places prefers
  //the one a writer cannot delete out from under a selection.
  //
  //An unusable id answers null rather than throwing, so loadDictionaries skips it exactly as it
  //skips one naming a dictionary that is simply not there - a saved selection is not worth failing
  //a spellcheck over, whichever way it went bad. import/remove call requireDictionaryId instead,
  //since those have to say why.
  function dictionaryBaseFor(id){
    if(!isValidDictionaryId(id))
      return null;

    var bundledDir = bundledDictDir();
    if(bundledDir != null && fs.existsSync(bundledDir + '/' + id + '.aff') && fs.existsSync(bundledDir + '/' + id + '.dic'))
      return bundledDir + '/' + id;

    var importedDir = importedDictDir();
    if(importedDir != null && fs.existsSync(importedDir + '/' + id + '.aff') && fs.existsSync(importedDir + '/' + id + '.dic'))
      return importedDir + '/' + id;

    return null;
  }

  function readDictionaryPairText(base, id){
    return {
      id: id,
      aff: fs.readFileSync(base + '.aff', 'utf8'),
      dic: fs.readFileSync(base + '.dic', 'utf8')
    };
  }

  //ids that are not on disk are skipped rather than rejecting the whole call - a writer's saved
  //selection outliving an import it names is not a failure. An ids that resolves to nothing at all
  //falls back to SHARED_DICT_BASENAME so spellcheck never simply stops working.
  function loadDictionaries(args){
    var ids = (args == null || args.ids == null) ? [] : args.ids;
    var loaded = [];

    ids.forEach(function(id){
      var base = dictionaryBaseFor(id);
      if(base != null)
        loaded.push(readDictionaryPairText(base, id));
    });

    if(loaded.length === 0){
      var bundledDir = bundledDictDir();
      if(bundledDir == null)
        throw PlatformError(CODES.UNAVAILABLE, 'No app directory configured for the dictionary.');

      loaded.push(readDictionaryPairText(bundledDir + '/' + SHARED_DICT_BASENAME, SHARED_DICT_BASENAME));
    }

    return loaded;
  }

  //Every .aff/.dic pair in both directories, bundled first. personal.dic is excluded by the pairing
  //rule alone (it has no .aff) - never as a special case - and so is any lone .aff or .dic missing
  //its other half.
  function listDictionaries(){
    return listDictionaryPairsIn(bundledDictDir(), 'bundled', false)
      .concat(listDictionaryPairsIn(importedDictDir(), 'imported', true));
  }

  function listDictionaryPairsIn(dir, source, removable){
    if(dir == null || !fs.existsSync(dir))
      return [];

    var files = fs.readdirSync(dir);

    return files
      .filter(function(name){ return name.endsWith('.aff'); })
      .map(function(name){ return name.slice(0, -4); })
      .filter(function(id){ return files.indexOf(id + '.dic') > -1; })
      .sort()
      .map(function(id){ return { id: id, source: source, removable: removable }; });
  }

  //Hunspell .aff files declare their own encoding on a SET line - this is deliberately narrow rather
  //than a full charset table: every dictionary this app ships is UTF-8, and the one documented
  //exception in circulation (ISO8859-1) is the one Node's Buffer already decodes natively as
  //'latin1'. An encoding this cannot recognize decodes as UTF-8, same as no .aff at all.
  function detectAffEncoding(buffer){
    //Scanned as latin1 - a byte-preserving decode - rather than the (possibly different) declared
    //encoding, since the SET line itself is always plain ASCII regardless of what the rest of the
    //file is written in.
    var scanned = buffer.toString('latin1');
    var match = scanned.match(/^SET\s+(\S+)/m);

    if(match == null)
      return 'utf8';

    var key = match[1].toUpperCase().replace(/[^A-Z0-9]/g, '');
    var ENCODING_MAP = { UTF8: 'utf8', ISO88591: 'latin1' };

    return ENCODING_MAP[key] || 'utf8';
  }

  function rewriteSetLine(affText, newSet){
    if(/^SET\s+\S+/m.test(affText))
      return affText.replace(/^SET\s+\S+/m, 'SET ' + newSet);

    return 'SET ' + newSet + '\n' + affText;
  }

  //dicPath is the required half - there is always a word list. affPath may be omitted for a bare
  //word list (a .txt or .dic of names with no affix file at all), in which case a generated
  //'SET UTF-8\n' stands in for it. Decodes per the .aff's own declared encoding and returns UTF-8
  //strings with the SET line rewritten to say so, matching what is actually being returned.
  function readDictionaryFiles(args){
    var dicPath = normalizePath(args == null ? undefined : args.dicPath, 'dicPath');
    var affPath = (args == null || args.affPath == null) ? null : normalizePath(args.affPath, 'affPath');

    var extIndex = dicPath.lastIndexOf('.');
    var id = (extIndex > -1 ? dicPath.substring(0, extIndex) : dicPath).split('/').pop();

    var encoding = 'utf8';
    var affText = 'SET UTF-8\n';

    if(affPath != null){
      var affBytes = fs.readFileSync(affPath);
      encoding = detectAffEncoding(affBytes);
      affText = affBytes.toString(encoding);
    }

    return {
      id: id,
      aff: rewriteSetLine(affText, 'UTF-8'),
      dic: fs.readFileSync(dicPath).toString(encoding)
    };
  }

  //Refuses a colliding id (ALREADY_EXISTS) rather than shadowing it - shadowing would mean removing
  //an imported dictionary silently changes which words are correct, with no way to show that in a
  //list. `aff` is generated the same way readDictionaryFiles generates one for a bare word list, so
  //this can be called directly with no affix text at all and still produce a usable pair.
  function importDictionary(args){
    var id = args == null ? undefined : args.id;
    requireDictionaryId(id);
    requireText(args.dic, 'dic');

    if(paths.userData == null)
      throw PlatformError(CODES.UNAVAILABLE, 'No userData directory configured for imported dictionaries.');

    if(dictionaryBaseFor(id) != null)
      throw PlatformError(CODES.ALREADY_EXISTS,
        'A dictionary named "' + id + '" already exists.', { id: id });

    var affText = (args.aff == null || args.aff === '') ? 'SET UTF-8\n' : args.aff;

    var dir = importedDictDir();
    if(!fs.existsSync(dir))
      fs.mkdirSync(dir);

    fs.writeFileSync(dir + '/' + id + '.aff', affText, 'utf8');
    fs.writeFileSync(dir + '/' + id + '.dic', args.dic, 'utf8');
  }

  //Bundled dictionaries are not the writer's to delete - the `removable` flag listDictionaries
  //returns is a UI hint, not the guard; this is. Idempotent past that guard, matching deleteEntry
  //(group E): removing an id that is not actually on disk in userData is not a failure.
  function removeDictionary(args){
    var id = args == null ? undefined : args.id;
    requireDictionaryId(id);

    var bundledDir = bundledDictDir();
    if(bundledDir != null && fs.existsSync(bundledDir + '/' + id + '.aff'))
      throw PlatformError(CODES.INVALID_ARGUMENT,
        'Cannot remove the bundled dictionary "' + id + '".', { id: id });

    if(paths.userData == null)
      throw PlatformError(CODES.UNAVAILABLE, 'No userData directory configured for imported dictionaries.');

    var dir = importedDictDir();

    if(fs.existsSync(dir + '/' + id + '.aff'))
      fs.unlinkSync(dir + '/' + id + '.aff');
    if(fs.existsSync(dir + '/' + id + '.dic'))
      fs.unlinkSync(dir + '/' + id + '.dic');
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

  //Phase 9c: this command owns its destination. It used to take `destPath` fully resolved by the
  //renderer (updates.js composed it from getAppPaths()'s temp/downloads and the asset name it had
  //matched), and it was the only producer of installUpdate's vouches - so "a path this backing
  //produced" was really "a path the renderer named", and the guard reduced to one extra IPC call.
  //Nothing about the destination crosses inbound now: the directory is this backing's to pick, and
  //the filename comes off the URL's own last path segment after the URL itself has been checked
  //against the repo's release-download prefix.
  //
  //The url check is deliberately strict on the *first* request and permissive on the redirect.
  //GitHub answers a release-asset URL with a 302 to its object CDN, and that hostname has changed
  //more than once (objects.githubusercontent.com, release-assets.githubusercontent.com); pinning it
  //would buy nothing - the redirect is chosen by the host we just authenticated over TLS - and would
  //break updates in the field silently the next time it moves. Requiring https on the redirect is
  //the part that is worth having.
  function updateAssetFilename(url){
    var parsed = null;
    try{
      parsed = new URL(url);
    }
    catch(parseErr){
      parsed = null;
    }

    if(parsed == null || parsed.protocol !== 'https:' || parsed.hostname !== RELEASE_ASSET_HOSTNAME
       || parsed.pathname.indexOf(RELEASE_ASSET_PATH_PREFIX) !== 0)
      throw PlatformError(CODES.INVALID_ARGUMENT,
        'Refusing to download "' + url + '": update assets come only from https://'
          + RELEASE_ASSET_HOSTNAME + RELEASE_ASSET_PATH_PREFIX + '.',
        { command: 'downloadUpdate' });

    var segments = parsed.pathname.split('/');
    var name = '';
    try{
      name = decodeURIComponent(segments[segments.length - 1]);
    }
    catch(decodeErr){
      name = '';
    }

    if(!RELEASE_ASSET_NAME_PATTERN.test(name))
      throw PlatformError(CODES.INVALID_ARGUMENT,
        'Refusing to download "' + url + '": "' + name + '" is not a usable asset filename.',
        { command: 'downloadUpdate' });

    return name;
  }

  //linux is where installUpdate exists, so there the asset is a working file and belongs in a
  //directory this backing creates and nobody has to find - the same fs.mkdtempSync discipline
  //importDocx and sendEmail's attachments already use. It is not removed before resolving the way
  //theirs are, because unlike theirs the file has to outlive the call that made it: installUpdate
  //reads it later, from a separate click. Everywhere else the download *is* the deliverable - the
  //About panel tells the writer it is in their downloads folder and they go run it themselves - so
  //that is where it goes.
  //`private` says whether this backing made the directory and is therefore free to lock it down
  //afterwards. The downloads branch is the writer's own folder with their own files in it - taking
  //write permission away from it would be a rude thing to do to a directory this command does not
  //own, and there is no installUpdate off linux for the hardening to protect anyway.
  function updateDestinationDir(){
    if(currentPlatform() !== 'linux' && paths.downloads != null)
      return { dir: normalizePath(paths.downloads, 'downloads').replace(/\/+$/, ''), private: false };

    return {
      dir: normalizePath(fs.mkdtempSync(path.join(os.tmpdir(), UPDATE_DIR_PREFIX)), 'updateDirectory')
        .replace(/\/+$/, ''),
      private: true
    };
  }

  //Narrows the window between installUpdate's hash check and dpkg's own read of the file. The hash
  //is the guard that matters; this closes the routes a compromised renderer could use to swap the
  //bytes inside that window, using nothing but commands it already has:
  //
  //  0400 on the file      - writeBinaryFile can no longer overwrite it; it gets EACCES instead.
  //  0500 on the directory - deleteEntry can no longer unlink it and write a replacement, since
  //                          removing an entry needs write permission on the directory, not the file.
  //
  //Not a complete defence - the owner can chmod back, and anything running as the user outside this
  //app's command surface can do as it likes. It closes what this app itself exposes, which is the
  //part that became reachable when the renderer went behind a bridge.
  //
  //Logged rather than fatal on failure: a filesystem that will not take the mode (a FAT-formatted
  //SD card, say) should not turn a good download into a failed one. The hash check still stands on
  //its own, so what is lost is defence in depth, not the guarantee.
  function hardenDownloadedUpdate(destPath, dir){
    try{
      fs.chmodSync(destPath, 0o400);
      fs.chmodSync(dir, 0o500);
    }
    catch(chmodErr){
      log(chmodErr);
    }
  }

  //Resolves only once the write stream's 'close' fires. The original updates.js resolved on
  //'finish', the identical truncated-file risk Phase 6 fixed in buildEpub and archiveProject -
  //corrected the same way rather than carried over.
  //
  //What it records on success is the sha256 of the bytes it fetched, against the path it allocated:
  //that pair is what installUpdate below checks, and the hash is what makes the vouch about content
  //rather than about a name. Hashed off the response as it streams rather than by reading the file
  //back afterwards, so a release asset does not have to be read into memory twice.
  //
  //The already-downloaded shortcut survives in narrowed form. All it ever saved was a re-download,
  //and it is now conditioned on the path already being vouched *by this session* rather than on
  //fs.existsSync - which was the hole: an existsSync vouch is satisfied by any file the renderer
  //wrote, and the comment that justified it ("a file this backing can see sitting at the exact path
  //it would itself have written the release asset to") rested on a false premise, since the backing
  //did not choose the path. An unvouched file already sitting at the destination is simply
  //overwritten by the download now, which also makes a stale asset from an interrupted run
  //self-correcting.
  function downloadUpdate(args){
    return new Promise(function(resolve, reject){
      var url = args == null ? undefined : args.url;
      requireText(url, 'url');

      //Filename first: it is the half that can refuse, and updateDestinationDir() has a side effect
      //(fs.mkdtempSync) that would otherwise leave an empty directory behind for every rejected URL.
      var filename = updateAssetFilename(url);
      var destination = updateDestinationDir();
      var destPath = destination.dir + '/' + filename;

      if(vouchedUpdates.has(destPath)){
        resolve({ path: destPath });
        return;
      }

      var file = createWriteStream(destPath);
      var digest = nodeCrypto.createHash('sha256');
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

        //Hardened before the vouch, not after: installUpdate will only ever act on a path that is
        //in this map, so the permissions are in place before the path becomes usable at all.
        if(destination.private)
          hardenDownloadedUpdate(destPath, destination.dir);

        vouchedUpdates.set(destPath, digest.digest('hex'));
        settle(resolve, { path: destPath });
      });

      file.on('error', function(err){ downloadErr = err; });

      function requestUrl(currentUrl){
        var req = httpsGet(currentUrl, function(response){
          if(response.statusCode == 302){
            response.resume();
            var location = response.headers == null ? undefined : response.headers.location;

            if(typeof location !== 'string' || location.indexOf('https://') !== 0){
              downloadErr = new Error('Update download redirected somewhere other than https.');
              file.destroy();
              return;
            }

            requestUrl(location);
            return;
          }

          if(response.statusCode !== 200){
            response.resume();
            downloadErr = new Error('Download failed: ' + response.statusCode);
            file.destroy();
            return;
          }

          //Attached in the same synchronous block as the pipe below, so no chunk reaches the file
          //without also reaching the hash - a 'data' listener resumes the stream on the next tick,
          //not on this one.
          response.on('data', function(chunk){ digest.update(chunk); });
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
  //a bridge, on a path a renderer could otherwise name however it likes. Two things have to hold
  //before sudo is spawned: the path must be one downloadUpdate above allocated and vouched on this
  //same backing instance, and the bytes at it must still hash to what that download recorded.
  //
  //The second check is what the first cannot do on its own. writeBinaryFile is group G's conceded
  //arbitrary write and stays conceded, so the renderer can still write over the path this command is
  //about to install - it just cannot make the result acceptable, because a rewritten file no longer
  //matches the digest. Read, hash, compare and spawn happen in one synchronous run: the main process
  //is single-threaded, so no other command can be serviced between the check and the spawn. What
  //remains open is the window after the spawn, before dpkg opens the file - see the Phase 9c
  //write-up in upgrade-and-isolation-plan.md, which records why that was left standing rather than
  //closed with filesystem permissions this project cannot verify off a Pi.
  //
  //The password crosses once, outbound, exactly as it did before this conversion - the writer
  //typed it into the DOM, same as sendEmail's literal-password case - and is written to the
  //child's stdin rather than argv, so it never appears in `ps`. `path` is a separate argv element
  //from the sudo/apt/install tokens, so shell metacharacters in it cannot inject additional
  //commands (there is no shell here), and it sits after a `--` so apt cannot read it as an option
  //either - the argument-injection half of the same question, which the argv array alone does not
  //answer.
  function installUpdate(args){
    return new Promise(function(resolve, reject){
      var targetPath = args == null ? undefined : args.path;
      requireText(targetPath, 'path');
      requireText(args.password, 'password');

      var vouchedDigest = vouchedUpdates.get(targetPath);

      if(vouchedDigest == null){
        reject(PlatformError(CODES.INVALID_ARGUMENT,
          'Refusing to install "' + targetPath + '": it was not produced by this session\'s downloadUpdate.',
          { command: 'installUpdate' }));
        return;
      }

      var currentDigest;
      try{
        currentDigest = nodeCrypto.createHash('sha256').update(fs.readFileSync(targetPath)).digest('hex');
      }
      catch(readErr){
        reject(fromNodeError(readErr, { command: 'installUpdate' }));
        return;
      }

      if(currentDigest !== vouchedDigest){
        reject(PlatformError(CODES.INVALID_ARGUMENT,
          'Refusing to install "' + targetPath + '": its contents changed after downloadUpdate wrote it.',
          { command: 'installUpdate' }));
        return;
      }

      var updater;
      try{
        updater = spawnProcess('sudo', ['-S', 'apt', 'install', '--', targetPath], { stdio: 'pipe' });
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
        //-f pins the column layout explicitly rather than relying on nmcli's default terse order
        //(IN-USE:BSSID:SSID:MODE:CHAN:RATE:SIGNAL:BARS:SECURITY), which varies by nmcli version and
        //locale and is not what this command needs anyway - see the Pi bug this fixed for what
        //trusting the default order costs.
        nmcli = spawnProcess('nmcli', ['-t', '-f', 'IN-USE,SSID', 'device', 'wifi', 'list', '--rescan', 'yes']);
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
          return { ssid: fields[1], isConnected: fields[0] === '*' };
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
        //nmcli's default terse layout for `device status` is already the stable, colon-free
        //DEVICE:TYPE:STATE:CONNECTION - unlike wifiListNetworks above, nothing here depended on a
        //miscounted field. -f is pinned anyway, at no cost, so a future nmcli default change can't
        //reopen the same class of bug.
        nmcli = spawnProcess('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device', 'status']);
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
