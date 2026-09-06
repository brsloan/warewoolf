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
//Only the two commands that constrain the contract's shape are implemented here: saveChapterAtomic
//(group C) and the credential group (J). Everything else in COMMANDS is deliberately absent and
//rejects with NOT_IMPLEMENTED, so Phases 2-8 fill the table in one group at a time and the suite
//says what is still outstanding.

const fs = require('fs');
const path = require('path');
const { CODES, PlatformError, fromNodeError } = require('./platform');
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

//Group D's error log slice. Timestamping and describing whatever was thrown are pure JS with no
//OS dependency, so that stays in error-log.js - this is only the part that used to be
//error-log.js:43-46: where the log lives, and the 1MB cap past which it truncates instead of
//growing forever.
const LOG_FILENAME = 'error_log.txt';
const MAX_LOG_SIZE_BYTES = 1024 * 1024;

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

  //Group A is the exception to this file's own rule. C and J are direct fs/crypto - exactly what
  //nodeIntegration already gives the renderer, so this backing can run inside it unchanged. None of
  //app.getPath, nativeTheme, the application menu, or app.quit is reachable from the renderer at
  //all, with or without nodeIntegration - so unlike C and J, this group was never a candidate for
  //running this file inside the shipped app. render.js uses platform-ipc.js for it instead; what
  //follows here exists so platform.test.js can exercise the contract's shape against injected
  //fakes, the same way it already does for secureStorage above.
  var fileRequestedOnOpen = options.fileRequestedOnOpen == null ? null : options.fileRequestedOnOpen;
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

    // --- C. Chapter I/O ---------------------------------------------------------------------
    saveChapter: saveChapter,
    saveChapterAtomic: saveChapterAtomic,

    // --- D. Error log (the rest of group D is still NOT_IMPLEMENTED) ------------------------
    logError: logError,
    readErrorLog: readErrorLog,
    clearErrorLog: clearErrorLog,

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
    return fileRequestedOnOpen;
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
  // Group C
  // ------------------------------------------------------------------------------------------

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

  function storeCredential(args){
    requireText(args.secret, 'secret');

    var store = storeFor(args.service);
    var passphrase = args.passphrase == null ? null : args.passphrase;

    if(!store.savePassword(args.secret, { passphrase: passphrase }))
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
  //source. The renderer hands over the blob it found there and learns only whether something moved
  //- the decrypt and the re-seal both happen here, so the recovered plaintext never crosses.
  //
  //Clearing the settings field afterward stays with the caller: it owns user-settings.json, and
  //this command has no business writing it.
  function migrateLegacyCredential(args){
    if(!isLegacyBlob(args.legacyBlob))
      return { migrated: false };

    var store = storeFor(args.service);
    var recovered = decryptLegacy(args.legacyBlob);

    if(recovered == null || recovered === '')
      return { migrated: false };

    if(!store.savePassword(recovered))
      throw PlatformError(CODES.IO_ERROR, 'Could not re-seal the legacy credential.',
        { service: args.service });

    return { migrated: true };
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
  OLD_VERSION_FLAG: OLD_VERSION_FLAG
};
