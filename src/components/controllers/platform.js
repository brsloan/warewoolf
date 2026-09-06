//The single boundary between WareWoolf's UI and the machine it runs on. Every command the renderer
//needs from the OS is declared in COMMANDS below; nothing else crosses.
//
//It is *injected*, never a global. The 830 tests in test/ do not mock the filesystem - they create
//real temp directories with fs.mkdtempSync and assert against real files. A facade reached as
//`window.warewoolf.*` would take that whole suite with it. So platform.js exports factories, the
//object graph carries the instance, and a test hands a module a node-backed platform pointed at a
//temp directory exactly as it hands it a project today.
//
//Three backings are planned, all satisfying this one contract:
//
//  node   - direct fs/crypto. Used by the test suite, and by the app until Phase 9.
//  ipc    - ipcRenderer.invoke against a preload bridge. The shipped Electron app.
//  tauri  - invoke(). A future Rust port.
//
//Rules the contract is built on, each forced by a command rather than chosen:
//
//  1. One object argument. Tauri's invoke() takes named arguments; positional ones do not exist in
//     its IPC. Every command here therefore takes exactly one plain object, or nothing at all.
//  2. Domain level, not filesystem level. Commands take identities (which project, which chapter,
//     what title) and return finished results. `writeFile(path, data)` would be a rename of the
//     current problem - the renderer would still compose paths and still hold an arbitrary-write
//     primitive. Group E (the in-app file browser) is the one documented exception: mouse-free
//     directory browsing is a product feature, and it is generic by necessity.
//  3. A command returns whatever the renderer must not compute. saveChapterAtomic allocates the
//     filename and returns it; the renderer cannot pick one without racing the write.
//  4. Multi-step operations are one command. The renderer never orders native steps, so it can
//     never order them wrongly.
//  5. Failure is loud. Every command rejects with a PlatformError carrying a stable `code`. The
//     two bugs this project has already shipped - a save that failed with EACCES and said nothing,
//     and a .deb that could not be unpacked - were both silence, not wrongness.
//  6. Secrets are referenced, never returned. See SAVED_SECRET.
//  7. Everything is async, including what could be synchronous. sendSync has no bridge equivalent
//     worth keeping, and a command that is sync in one backing and async in another is a contract
//     with two shapes.

var CODES = {
  //The named thing is not there.
  NOT_FOUND: 'NOT_FOUND',
  //Refused by the OS: EACCES, EPERM, EROFS. A project opened out of the read-only install
  //directory arrives here, which is why project.isReadOnly stays a renderer-side UI flag rather
  //than becoming the enforcement - the flag decides what the UI offers, this code is the backstop
  //for when it is wrong.
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  //The destination is occupied and the command refuses to clobber it.
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  //The caller's arguments do not describe anything the command can act on.
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  //A passphrase-protected credential that has not been unlocked this session.
  LOCKED: 'LOCKED',
  //The facility itself is absent: no keyring, no nmcli, no battery.
  UNAVAILABLE: 'UNAVAILABLE',
  //Anything else the OS reported.
  IO_ERROR: 'IO_ERROR',
  //Declared in COMMANDS, absent from this backing. Phases 2-8 turn these into implementations one
  //group at a time, and the suite says which groups are still outstanding.
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED'
};

//Errors do not survive an IPC boundary as Error objects - Electron serializes them to a string, and
//Tauri returns a serialized payload. A stable `code` field is the part every backing can
//reconstitute, so callers branch on the code and never on the message or the constructor.
function PlatformError(code, message, details){
  var err = new Error(message);
  err.name = 'PlatformError';
  err.code = code;
  err.isPlatformError = true;

  if(details != null)
    Object.keys(details).forEach(function(key){
      err[key] = details[key];
    });

  return err;
}

var NODE_ERRNO_CODES = {
  ENOENT: CODES.NOT_FOUND,
  EACCES: CODES.PERMISSION_DENIED,
  EPERM: CODES.PERMISSION_DENIED,
  EROFS: CODES.PERMISSION_DENIED,
  EEXIST: CODES.ALREADY_EXISTS,
  EISDIR: CODES.INVALID_ARGUMENT,
  ENOTDIR: CODES.INVALID_ARGUMENT,
  EINVAL: CODES.INVALID_ARGUMENT
};

//The node backing's reference mapping from errno to contract code. The ipc and tauri backings owe
//an equivalent one; this is what they get written against.
function fromNodeError(err, details){
  if(err != null && err.isPlatformError)
    return err;

  var code = (err != null && NODE_ERRNO_CODES[err.code]) || CODES.IO_ERROR;

  return PlatformError(code, err == null ? 'Unknown platform failure.' : err.message, details);
}

//Stands in for a stored secret wherever the UI would otherwise hold the plaintext.
//
//Today the saved email password is read into the renderer and written into an <input type=password>
//value (email-doc_display.js:46, error-log_display.js:52), then read back out and handed to
//nodemailer. Under contextIsolation that is a plaintext credential sitting in the DOM of a webview,
//which is the one thing this exercise is meant to prevent. So the facade has no getCredential:
//describeCredential() tells the UI whether a password exists and whether it is readable, the UI
//puts this sentinel in the field, and sendEmail resolves it on the native side.
//
//This makes the UI's "did the writer type a new password?" check simpler rather than harder - it
//becomes `value !== SAVED_SECRET` instead of a comparison against a plaintext the dialog had to
//fetch first (email-doc_display.js:143).
//
//A password the writer just typed still crosses, outbound, once. That is unavoidable: they typed it
//into the DOM. Nothing ever crosses inbound.
var SAVED_SECRET = '\u0000warewoolf:saved-secret\u0000';

//Main -> renderer. Absent from native-command-inventory.md, which names only the file-open event:
//there are 36 channels, and every one of them has to cross the bridge in Phase 9 or the menu stops
//working. Validated by name so a typo fails at subscribe time rather than never firing.
var EVENTS = [
  'file-opened-from-outside',
  'about-clicked', 'add-chapter-clicked', 'center-all-heads-clicked', 'compile-clicked',
  'convert-first-lines-clicked', 'convert-italics-clicked', 'convert-tabs-clicked',
  'corkboard-clicked', 'delete-chapter-clicked', 'exit-app-clicked', 'export-clicked',
  'file-manager-clicked', 'find-replace-clicked', 'headings-to-chaps-clicked', 'help-doc-clicked',
  'import-clicked', 'indent-all-clicked', 'new-project-clicked', 'open-clicked',
  'outliner-clicked', 'properties-clicked', 'renumber-chapters-clicked', 'restore-chapter-clicked',
  'save-as-clicked', 'save-backup-clicked', 'save-clicked', 'save-copy-clicked',
  'send-via-email-clicked', 'settings-clicked', 'shortcuts-clicked', 'spellcheck-clicked',
  'split-chapter-clicked', 'view-error-log-clicked', 'wifi-manager-clicked', 'word-count-clicked'
];

//Every command that may cross the boundary. A backing that does not implement one rejects with
//NOT_IMPLEMENTED rather than being silently undefined, and nothing outside this table is reachable
//through the facade at all - which is what makes "the renderer cannot do X" a checkable claim.
//
//`params` names the keys of the single object argument and `optional` the ones that may be omitted.
//Both are documentation the tests assert against, not runtime type validation.
var COMMANDS = {
  // --- A. Environment and shell -------------------------------------------------------------
  getAppPaths: { group: 'A', params: [],
    returns: '{ userData, home, temp, docs, app, downloads }',
    note: 'Convert first (Phase 2). It is sendSync at module load in render.js:4, so nothing else goes async cleanly while it stays that way.' },
  getPlatform: { group: 'A', params: [], returns: '{ platform, arch }' },
  getFileRequestedOnOpen: { group: 'A', params: [], returns: 'string | null' },
  setTheme: { group: 'A', params: ['mode'], returns: 'void' },
  showAppMenu: { group: 'A', params: [], returns: 'void' },
  confirmExit: { group: 'A', params: [], returns: 'void' },
  notifyRendererReady: { group: 'A', params: [], returns: 'void' },

  // --- B. Project lifecycle -----------------------------------------------------------------
  openProject: { group: 'B', params: ['path'],
    returns: '{ project, directory, filename }',
    note: 'Splits the path natively so the renderer stops doing it (project.js:52-54).' },
  saveProject: { group: 'B', params: ['directory', 'filename', 'contents'], returns: 'void' },
  saveProjectAs: { group: 'B',
    params: ['fromDirectory', 'fromChapsDir', 'targetPath', 'chapterFilenames', 'contents'],
    optional: ['copyOnly'],
    returns: '{ directory, filename, chapsDirectory, chapterFilenames, failed }',
    note: 'Six filesystem operations that succeed or fail together (project.js:183-195). Returns the renamed chapter filenames because the renderer cannot know them, and `failed` because a chapter missing from disk must not abort the rest.' },
  verifyProjectFiles: { group: 'B', params: ['directory', 'chapsDirectory', 'chapterFilenames'],
    returns: 'string[] of filenames not on disk' },
  materializeBundledProject: { group: 'B', params: ['bundledDir', 'writableDir', 'filename'],
    returns: '{ path, writable }',
    note: 'Returns `writable` rather than a bare path. When the copy out of the read-only install directory fails, render.js:99-102 currently falls back to the bundled original and every later save dies with EACCES in silence - the open finding in upgrade-and-isolation-plan.md. With the flag the caller sets project.isReadOnly, and the example behaves like the Help doc.' },

  // --- C. Chapter I/O -----------------------------------------------------------------------
  loadChapter: { group: 'C', params: ['projectDir', 'chapsDir', 'filename'], returns: 'mdfc text' },
  saveChapter: { group: 'C', params: ['projectDir', 'chapsDir', 'title', 'mdfc'],
    returns: '{ filename }',
    note: 'Save Copy (chapter.js:107-120): allocate a fresh name and write. No old file, so no transaction.' },
  saveChapterAtomic: { group: 'C',
    params: ['projectDir', 'chapsDir', 'oldFilename', 'title', 'mdfc'],
    optional: ['notesMdfc'],
    returns: '{ filename, notesFilename }',
    note: 'Takes the title and returns the allocated filename - it does not take one. See the node backing below for why.' },
  deleteChapterFiles: { group: 'C', params: ['projectDir', 'chapsDir', 'filename'], returns: 'void' },
  loadChapterNotes: { group: 'C', params: ['projectDir', 'chapsDir', 'filename'], returns: 'mdfc text | null' },
  saveChapterNotes: { group: 'C', params: ['projectDir', 'chapsDir', 'filename', 'mdfc'], returns: 'void' },

  // --- D. Settings, corkboard, error log ----------------------------------------------------
  loadUserSettings: { group: 'D', params: [], returns: 'object | null' },
  saveUserSettings: { group: 'D', params: ['settings'], returns: 'void' },
  loadCorkboard: { group: 'D', params: ['projectDir'], returns: 'card[] | null' },
  saveCorkboard: { group: 'D', params: ['projectDir', 'cards'], returns: 'void' },
  logError: { group: 'D', params: ['text'], returns: 'void',
    note: 'Called from nearly every module; the widest blast radius of the async conversion, which is why Phase 3 does it alone.' },
  readErrorLog: { group: 'D', params: [], returns: 'string' },
  clearErrorLog: { group: 'D', params: [], returns: 'void' },
  readLicenses: { group: 'D', params: [], returns: 'string' },

  // --- E. Filesystem browser (the documented generic exception) -----------------------------
  listDirectory: { group: 'E', params: ['path'], returns: '{ name, isDirectory }[]' },
  pathExists: { group: 'E', params: ['path'], returns: 'boolean' },
  statEntry: { group: 'E', params: ['path'], returns: '{ isDirectory, size, modified }' },
  createDirectory: { group: 'E', params: ['parent', 'name'], returns: '{ path }' },
  moveEntry: { group: 'E', params: ['source', 'destination'], returns: 'void',
    note: 'Must keep the refuse-on-existing-destination guard (file-manager.js:54-56) and reject ALREADY_EXISTS. fs.renameSync overwrites silently; that is what the guard exists to stop.' },
  copyEntry: { group: 'E', params: ['source', 'destination'], optional: ['recursive'], returns: 'void' },
  deleteEntry: { group: 'E', params: ['path'], optional: ['recursive'], returns: 'void' },

  // --- F. Import ----------------------------------------------------------------------------
  readTextFile: { group: 'F', params: ['path'], returns: 'string' },
  extractZip: { group: 'F', params: ['zipPath'], optional: ['destPath'], returns: '{ path }' },
  importDocx: { group: 'F', params: ['path'], returns: '{ documentXml, footnotesXml }',
    note: 'Returns the XML text, not a temp directory. The parsing in docx-import.js is pure string work and stays in the webview.' },

  // --- G. Export and compile ----------------------------------------------------------------
  ensureDirectory: { group: 'G', params: ['path'], returns: 'void' },
  writeTextFile: { group: 'G', params: ['path', 'contents'], returns: 'void' },
  writeBinaryFile: { group: 'G', params: ['path', 'bytes'], returns: 'void' },
  buildEpub: { group: 'G', params: ['filepath', 'htmlChapters', 'meta'], returns: 'void',
    note: 'archiver has no browser build, so the assembled HTML crosses and the zipping happens natively. docx does have one, so delta-to-docx keeps generating in the webview and only writeBinaryFile crosses.' },

  // --- H. Backup ----------------------------------------------------------------------------
  archiveProject: { group: 'H', params: ['projectDir', 'chapsDir', 'filename', 'destDir'],
    returns: '{ filename, path }' },
  listBackups: { group: 'H', params: ['directory'], returns: '{ name, isDirectory }[]' },
  pruneBackups: { group: 'H', params: ['paths'], returns: 'void' },

  // --- I. Spellcheck ------------------------------------------------------------------------
  loadDictionary: { group: 'I', params: [], returns: '{ aff, dic }',
    note: 'nspell is pure JS and stays in the webview. Only the dictionary text crosses.' },
  loadPersonalDictionary: { group: 'I', params: [], returns: 'string[]',
    note: 'Folds in the bootstrap write at spellcheck.js:38-44 - the caller stops knowing the file has to be created before it can be read.' },
  savePersonalDictionary: { group: 'I', params: ['words'], returns: 'void' },

  // --- J. Credentials -----------------------------------------------------------------------
  isSecureStorageAvailable: { group: 'J', params: [], returns: 'boolean' },
  describeCredential: { group: 'J', params: ['service'],
    returns: '{ hasPassword, backend, locked, secureStorageAvailable }',
    note: 'Everything the dialogs draw from, and the only thing they learn. Never the secret.' },
  storeCredential: { group: 'J', params: ['service', 'secret'], optional: ['passphrase'],
    returns: '{ backend }' },
  unlockCredential: { group: 'J', params: ['service', 'passphrase'], returns: 'boolean',
    note: 'Establishes the session key on the native side. A wrong passphrase is an ordinary false, not an error.' },
  lockCredential: { group: 'J', params: ['service'], returns: 'void',
    note: 'Has no equivalent today, because the session key lives in a renderer closure that dies with the window. Once it lives natively, something has to end its life explicitly.' },
  clearCredentials: { group: 'J', params: ['service'], returns: 'void' },
  migrateLegacyCredential: { group: 'J', params: ['service', 'legacyBlob'], returns: '{ migrated }',
    note: 'Decrypt-and-reseal happens entirely natively (crypto.js:80-93). The renderer hands over the blob it found in user-settings.json and learns only whether something moved.' },

  // --- K. Network and hardware --------------------------------------------------------------
  checkForUpdate: { group: 'K', params: [], returns: '{ version, url } | null' },
  downloadUpdate: { group: 'K', params: ['url', 'destPath'], returns: '{ path }' },
  installUpdate: { group: 'K', params: ['path', 'password'], returns: 'void' },
  sendEmail: { group: 'K',
    params: ['service', 'sender', 'secret', 'receiver', 'attachments'],
    optional: ['subject', 'body'],
    returns: 'void',
    note: 'Takes SAVED_SECRET or a literal the writer just typed. This command is why getCredential does not exist: the password never needed to reach the renderer, because the thing that consumes it is also native. Also absorbs the temp-file dance around os.tmpdir() at email-doc.js:119-135,147,180 - the renderer hands over content and never learns a temp path.' },
  wifiListNetworks: { group: 'K', params: [], returns: 'network[]' },
  wifiConnect: { group: 'K', params: ['ssid'], optional: ['psk'], returns: 'void' },
  wifiGetAddress: { group: 'K', params: [], returns: 'string' },
  getBatteryCapacity: { group: 'K', params: [], returns: 'number | null' }
};

//Wraps a backing in the contract: one async method per COMMANDS entry, every rejection a
//PlatformError, and nothing reachable that is not declared above.
function createPlatform(backing){
  if(backing == null)
    throw PlatformError(CODES.INVALID_ARGUMENT, 'createPlatform needs a backing.');

  var platform = {};

  Object.keys(COMMANDS).forEach(function(name){
    platform[name] = function(args){
      var impl = backing[name];

      if(typeof impl !== 'function')
        return Promise.reject(PlatformError(CODES.NOT_IMPLEMENTED,
          'Command "' + name + '" (group ' + COMMANDS[name].group + ') is declared but not implemented by this backing.',
          { command: name }));

      //Resolve first so a backing that throws synchronously still rejects. A caller must never have
      //to both try/catch and .catch() the same command.
      return Promise.resolve()
        .then(function(){
          return impl.call(backing, args == null ? {} : args);
        })
        .catch(function(err){
          throw fromNodeError(err, { command: name });
        });
    };
  });

  platform.on = function(event, handler){
    assertKnownEvent(event);
    backing.on(event, handler);

    return function(){
      backing.off(event, handler);
    };
  };

  platform.off = function(event, handler){
    assertKnownEvent(event);
    backing.off(event, handler);
  };

  platform.SAVED_SECRET = SAVED_SECRET;

  //Frozen so no module can quietly bolt a 51st command onto a live platform instead of declaring it
  //here, which is how a boundary stops being one.
  return Object.freeze(platform);
}

function assertKnownEvent(event){
  if(EVENTS.indexOf(event) === -1)
    throw PlatformError(CODES.INVALID_ARGUMENT, 'Unknown platform event "' + event + '".', { event: event });
}

module.exports = {
  createPlatform: createPlatform,
  COMMANDS: COMMANDS,
  EVENTS: EVENTS,
  CODES: CODES,
  PlatformError: PlatformError,
  fromNodeError: fromNodeError,
  SAVED_SECRET: SAVED_SECRET
};
