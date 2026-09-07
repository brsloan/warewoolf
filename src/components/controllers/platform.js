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
//Until Phase 7 the saved email password was read into the renderer and written into an
//<input type=password> value, then read back out and handed to nodemailer. Under contextIsolation
//that is a plaintext credential sitting in the DOM of a webview, which is the one thing this
//exercise is meant to prevent. So the facade has no getCredential: describeCredential() tells the
//UI whether a password exists and whether it is readable, and the UI puts this sentinel in the
//field instead of a password.
//
//Two commands take it, for the two things the UI does with a secret it must not hold:
//
//  sendEmail(secret)       - send using the saved password                  (group K, Phase 8)
//  storeCredential(secret) - re-seal the saved password under new protection (group J, Phase 7)
//
//storeCredential was missed in Phase 1 and added in Phase 7. Without it, unticking "Protect With
//Passphrase" on an already-saved password requires the plaintext in the renderer - which is the
//leak this sentinel exists to close, arrived at from the other direction.
//
//This makes the UI's "did the writer type a new password?" check simpler rather than harder - it
//becomes `value !== SAVED_SECRET`, with nothing fetched first.
//
//A password the writer just typed still crosses, outbound, once. That is unavoidable: they typed it
//into the DOM. Nothing ever crosses inbound.
var SAVED_SECRET = '\u0000warewoolf:saved-secret\u0000';

//Main -> renderer. Absent from native-command-inventory.md, which names only the file-open event:
//there are 36 channels, and every one of them has to cross the bridge in Phase 9 or the menu stops
//working. Validated by name so a typo fails at subscribe time rather than never firing.
//
//These are the literal channel names index.js sends on, not tidied-up versions of them - the ipc
//backing hands them straight to ipcRenderer.on(). Phase 1 wrote the first one as
//'file-opened-from-outside' and it was wrong for exactly one release of nobody using it: subscribing
//would have listened on a channel nothing sends, silently, which is the failure this list exists to
//prevent. A test cross-checks the list against index.js so a name cannot drift again.
var EVENTS = [
  'file-opened-from-outside-warewoolf',
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
  //Writes the .woolf, both for an ordinary save (project.js:136) and as the last step of Save As
  //(project.js:251).
  //
  //Phase 4 correction: saveProjectAs used to declare `contents` too, so that it wrote the .woolf
  //itself. It cannot, and the reason is an ordering constraint rather than a preference. Save As
  //has to write out any chapter with unsaved changes, and those writes go through group C's
  //saveChapterAtomic/saveChapter, which *allocate* the filename - so the chapter filenames the
  //.woolf must list are not known until after those writes, and those writes cannot happen until
  //the new chapters directory exists. The order is therefore: make the directories and copy
  //(saveProjectAs) -> save the dirty chapters (group C) -> write the .woolf (saveProject). Passing
  //`contents` into saveProjectAs would mean writing a .woolf that names the *pre-save* filenames
  //and then rewriting it, and if the rewrite failed the file left on disk would point at chapter
  //files whose names had since changed. That is worse than no file at all.
  //
  //Nothing about the transaction is lost: the operations that must succeed or fail together are
  //still the two mkdirs and the copy loop, still in one command, exactly as they are today.
  //`copyOnly` went the same way and for a simpler reason - Save a Copy does identical work on
  //disk, and differs only in whether the *renderer* repoints its own chapters afterward.
  saveProject: { group: 'B', params: ['directory', 'filename', 'contents'], returns: 'void' },
  saveProjectAs: { group: 'B',
    params: ['fromDirectory', 'fromChapsDir', 'targetPath', 'chapterFilenames'],
    returns: '{ directory, filename, chapsDirectory, chapterFilenames, failed }',
    note: 'Six filesystem operations that succeed or fail together (project.js:183-195): parse the target path, make the two directories, copy every chapter file across. Returns the new chapter filenames because the renderer cannot know them, and `failed` because a chapter missing from disk must not abort the rest. Does NOT write the .woolf - see below for why that is saveProject and not this.' },
  verifyProjectFiles: { group: 'B', params: ['directory', 'chapsDirectory', 'chapterFilenames'],
    returns: 'string[] of filenames not on disk' },
  materializeBundledProject: { group: 'B', params: ['bundledDir', 'writableDir', 'filename'],
    returns: '{ path, writable, error }',
    note: 'Returns `writable` rather than a bare path. When the copy out of the read-only install directory fails, render.js falls back to the bundled original and every later save dies with EACCES in silence - the open finding in upgrade-and-isolation-plan.md. With the flag the caller sets project.isReadOnly, and the example behaves like the Help doc. `error` is the fallback\'s reason (null when the copy worked), because a fallback nobody can see is the silence rule 5 exists to stop; this command resolves rather than rejecting since falling back is a success, just a diminished one.' },

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
  //Phase 5 correction: this table originally declared loadCorkboard(projectDir) / saveCorkboard(
  //projectDir, cards) - returning/taking parsed cards, which would mean the marker-escaping parse
  //in corkboard.js (parseCardsString/generateCardsString - which card labels collide with the "# "
  //heading marker or a "[x] "/"[<digit>] " prefix, and how to escape them) moves natively. That is
  //exactly the format-parsing logic groups B/C keep out of platform-node - loadChapter/saveChapter
  //cross raw text, not a parsed chapter, for the same reason. So these take/return the corkboard
  //file's raw text instead, exactly like loadChapter/saveChapter, and corkboard.js keeps parsing it.
  //`chaptersDir` rather than `projectDir` because that is what the caller has always had - the
  //corkboard file lives beside the chapters, not the .woolf.
  loadCorkboard: { group: 'D', params: ['chaptersDir'], returns: 'string | null (raw corkboard text)' },
  saveCorkboard: { group: 'D', params: ['chaptersDir', 'contents'], returns: 'void' },
  logError: { group: 'D', params: ['text'], returns: 'void',
    note: 'Called from nearly every module; the widest blast radius of the async conversion, which is why Phase 3 does it alone.' },
  readErrorLog: { group: 'D', params: [], returns: 'string' },
  clearErrorLog: { group: 'D', params: [], returns: 'void' },
  readLicenses: { group: 'D', params: [], returns: 'string' },

  // --- E. Filesystem browser (the documented generic exception) -----------------------------
  //isDirectory crosses as a plain boolean, not a dirent's isDirectory() method - a function cannot
  //survive IPC/Tauri serialization. file-manager.js's own dotfile filter stays a caller-side policy
  //rather than moving into this command, for the same reason moveEntry stays a bare refuse-on-
  //collision primitive below: the generic command does the filesystem operation, and app-specific
  //policy (which entries to hide, how to pick a non-colliding name) is built out of these on the
  //renderer side, exactly as the design note above the table describes.
  listDirectory: { group: 'E', params: ['path'], returns: '{ name, isDirectory }[]' },
  pathExists: { group: 'E', params: ['path'], returns: 'boolean' },
  statEntry: { group: 'E', params: ['path'], returns: '{ isDirectory, size, modified }' },
  //Idempotent - a target that already exists is left alone rather than rejected, matching
  //createNewDirectory's original fs.existsSync guard (file-manager.js:106).
  createDirectory: { group: 'E', params: ['parent', 'name'], returns: '{ path }' },
  //Must keep the refuse-on-existing-destination guard (file-manager.js:54-56) and reject
  //ALREADY_EXISTS. fs.renameSync overwrites silently; that is what the guard exists to stop.
  //moveFiles' cut-paste behavior (auto-uniquify the destination name instead of refusing) is a
  //different policy from renameFiles' - both used to live in file-manager.js as two different
  //fs.renameSync call sites with two different collision policies. moveEntry only implements the
  //stricter one (refuse); the renderer computes a non-colliding name itself via pathExists/statEntry
  //before calling moveEntry when it wants the other policy, the same way copyFiles already does.
  moveEntry: { group: 'E', params: ['source', 'destination'], returns: 'void' },
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
  //Phase 6 correction: this table originally declared buildEpub(filepath, htmlChapters, meta), on
  //the theory that the OPF/NCX/TOC generation - epub.js's getContentOpf/getTocNcx/getTocXhtml/
  //getChapterXhtmlPages/escapeXmlText/etc. - would move natively alongside the zipping. It cannot,
  //for the same reason Phase 5 corrected loadCorkboard/saveCorkboard: that generation is pure
  //string work with no OS dependency, and moving it into platform-node would duplicate ~250 lines
  //of format logic into the backing for no reason archiver actually requires. "archiver has no
  //browser build, so the assembled HTML crosses and the zipping happens natively" (the note this
  //table shipped with) already says the right thing - it is the *assembled* content that crosses,
  //not the raw chapters. So buildEpub takes the finished zip entries - {name, content}[], every one
  //of them already-generated text - and does exactly one native thing: write them into a zip at
  //filepath. epub.js keeps every generation/escaping function unchanged and calls this only after
  //assembling entries itself, the same shape loadChapter/saveChapter already established for
  //keeping format logic out of the backing.
  buildEpub: { group: 'G', params: ['filepath', 'entries'], returns: 'void',
    note: 'entries is { name, content }[], pre-assembled by epub.js - mimetype, container.xml, content.opf, toc.ncx, toc.xhtml, one chapter_N.xhtml per chapter, and the stylesheet. The entry literally named "mimetype" is stored uncompressed, per the epub spec; every other entry is deflated. Must resolve only once the write stream\'s \'close\' fires, not archiver\'s \'finish\' - see the comment on the node backing\'s implementation for why a truncated .epub is the failure this exists to prevent.' },

  // --- H. Backup ----------------------------------------------------------------------------
  archiveProject: { group: 'H', params: ['projectDir', 'chapsDir', 'filename', 'destDir'],
    returns: '{ filename, path }',
    note: 'Allocates the timestamped archive name itself and returns it, the same reason saveChapterAtomic allocates a filename rather than taking one. Must resolve on the write stream\'s \'close\', not archiver\'s \'finish\' - backup-project.js\'s original archiveProject listened on \'finish\', which this corrects rather than carries over; see the node backing.' },
  listBackups: { group: 'H', params: ['directory'], returns: '{ name, isDirectory }[]',
    note: 'The same shape as listDirectory (group E), but kept a separate command deliberately - Phase 5 already noted backup-project.js\'s own readdirSync is domain-level backup browsing, not the generic file browser E exists for.' },
  pruneBackups: { group: 'H', params: ['paths'], returns: 'void',
    note: 'Deletes each path unconditionally; one bad path is logged and does not stop the rest, matching deleteOldBackups\' original per-file try/catch.' },

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
    returns: '{ backend }',
    note: '`secret` is either a literal the writer just typed or SAVED_SECRET, meaning "re-seal whatever is already stored, under whatever protection this call asks for". (corrected in Phase 7: the table had it taking a literal only, which left the UI unable to tick or untick "Protect With Passphrase" on an existing password without first holding the plaintext - the exact leak SAVED_SECRET exists to close. sendEmail is not the only place the UI has to name a secret it must not hold.)' },
  unlockCredential: { group: 'J', params: ['service', 'passphrase'], returns: 'boolean',
    note: 'Establishes the session key on the native side. A wrong passphrase is an ordinary false, not an error.' },
  lockCredential: { group: 'J', params: ['service'], returns: 'void',
    note: 'Has no equivalent today, because the session key lives in a renderer closure that dies with the window. Once it lives natively, something has to end its life explicitly.' },
  clearCredentials: { group: 'J', params: ['service'], returns: 'void' },
  migrateLegacyCredential: { group: 'J', params: ['service', 'legacyBlob'],
    returns: '{ recognized, migrated }',
    note: 'Decrypt-and-reseal happens entirely natively (crypto.js:80-93). The renderer hands over the blob it found in user-settings.json and learns only what it needs to decide two things. (corrected in Phase 7: `{ migrated }` alone collapsed two outcomes the caller has to tell apart. `recognized` means the blob was in the pre-2.2.2 format and the settings field is now dead - clear it. `migrated` means a password was actually recovered and re-sealed. A legacy blob that decrypts to nothing is recognized but not migrated, and the old migrateLegacyPassword cleared the settings field in exactly that case too; a single flag would have left it there to be retried on every launch forever.)' },

  // --- K. Network and hardware --------------------------------------------------------------
  //Phase 8 correction: returns the raw parsed GitHub release JSON, not a packaged `{version, url}`.
  //Matching a release tag against the version this build is running, and picking the right asset
  //for this platform/arch, is pure data work with no OS dependency - the same reason group D keeps
  //corkboard's marker-escaping and group G keeps epub's XML generation out of platform-node.js.
  //Only the network round-trip crosses; updates.js keeps packageReleaseData/isUpdateAvailable/
  //extractUpdateDownloadInfo unchanged, now reading platform.getPlatform() (group A) instead of
  //process.platform/process.arch directly, which also closes the two Group A reads this file's
  //own note left deferred to this phase (updates.js:117-130,179 and about_display.js's own read).
  checkForUpdate: { group: 'K', params: [], returns: 'the parsed GitHub release JSON (releases/latest)' },
  //Phase 9c correction: `destPath` is gone. It used to be the full target path, composed by the
  //renderer from getAppPaths()'s temp/downloads and the asset name it matched - which is precisely
  //what made installUpdate's vouch forgeable (see below), because the only producer of vouches took
  //its path from the caller. This command allocates the destination itself now, the same discipline
  //saveChapterAtomic, archiveProject and sendEmail's attachment temp files already follow: on linux
  //a directory it creates with fs.mkdtempSync (installUpdate's own platform, so the installer never
  //has to be a file the writer can find), on Windows/macOS the downloads directory, since there the
  //writer is told to go run it themselves. The filename comes off the URL's last path segment, and
  //the URL has to be a release asset on this project's own repo - so nothing about the path is
  //renderer-composed, and a renderer cannot name a path it has already written to.
  //
  //The rest is unchanged: follow one redirect, and resolve only once the destination write stream's
  //'close' fires, not the response's completion - the identical truncated-file risk
  //buildEpub/archiveProject (Phase 6) exist to avoid, corrected the same way here rather than
  //carried over from the original updates.js, which resolved on 'finish'. The already-downloaded
  //shortcut is narrowed rather than removed: it short-circuits a path this session already vouched
  //(all it ever saved was a re-download), and never vouches one it has not downloaded.
  downloadUpdate: { group: 'K', params: ['url'], returns: '{ path }' },
  //The one command in the whole contract that escalates privilege, and the one whose `path` cannot
  //be trusted just because it looks like a path. Phase 8 correction: `path` must be one this same
  //backing instance itself produced via a prior downloadUpdate call - rejected with
  //INVALID_ARGUMENT otherwise, before sudo is ever spawned. A directory allowlist or filename
  //pattern was considered and rejected: both are properties a renderer-composed path could satisfy
  //by construction.
  //
  //Phase 9c correction: so was the vouch, for exactly the same reason, and post-9b this is the only
  //renderer-to-root path in the app. downloadUpdate took `destPath` from the renderer and vouched it
  //on fs.existsSync alone, so writeBinaryFile -> downloadUpdate -> installUpdate installed an
  //attacker's .deb as root. A vouch now records the sha256 of the bytes this backing actually
  //downloaded, keyed by a path this backing allocated - and installUpdate re-hashes the file
  //immediately before spawning, so overwriting a vouched path (writeBinaryFile can still write
  //anywhere) makes it stop matching rather than makes it trusted. The read-hash-compare-spawn
  //sequence is deliberately synchronous: the main process is single-threaded, so no other command
  //can run between the check and the spawn.
  //
  //The password crosses once, outbound, exactly as before - the writer typed it into the DOM -
  //written to the child's stdin rather than argv so it never appears in `ps`, with `path` as a
  //separate argv element from the sudo/apt/install tokens so a hostile asset filename cannot inject
  //additional shell commands (there is no shell: this is spawn(), not exec()) and behind a `--`
  //terminator so a path could not be read as an apt option either.
  installUpdate: { group: 'K', params: ['path', 'password'], returns: 'void' },
  //Takes SAVED_SECRET or a literal the writer just typed. This command is why getCredential does
  //not exist: the password never needed to reach the renderer, because the thing that consumes it
  //is also native.
  //
  //Phase 8 correction: `attachments` is not `{filename, content, encoding}[]` for every case, and
  //cannot be - that shape was written before this command had to absorb backup-project.js's zip and
  //epub.js's epub, both of which are built by zipping, not by generating a string. Each entry is
  //exactly one of:
  //  { filename, content, encoding? }        literal bytes/text the caller already generated
  //                                           (docx base64, .md/.html/.mdfc/.txt strings)
  //  { filename?, projectArchive: { projectDir, chapsDir?, sourceFilename } }
  //                                           "zip this project" - built via the same archiveProject
  //                                           (group H) this command already has, into a temp file
  //                                           this call owns and deletes; filename defaults to
  //                                           whatever archiveProject allocates
  //  { filename, epubEntries: entries }      pre-assembled epub.js entries (the same {name,content}[]
  //                                           buildEpub (group G) already takes), zipped the same way
  //None of the three ever names a path the renderer composed - the two that need zipping are built
  //into a temp file this command creates with fs.mkdtempSync, reads back as a Buffer, and deletes
  //before resolving or rejecting, the same "own the temp directory, clean it up regardless of
  //outcome" shape importDocx (group F) already established. This is the absorption the inventory
  //flagged: the renderer hands over content (or, for a project/epub, the identities needed to build
  //it) and never learns a temp path - shipping a `path` field here would have been the
  //arbitrary-file-read primitive Phase 7 declined to pull forward.
  sendEmail: { group: 'K',
    params: ['service', 'sender', 'secret', 'receiver', 'attachments'],
    optional: ['subject', 'body'],
    returns: 'void' },
  wifiListNetworks: { group: 'K', params: [], returns: '{ ssid, isConnected }[]',
    note: 'Rejects UNAVAILABLE when nmcli is not installed (spawn ENOENT) - the ordinary case off a writerDeck, not a failure worth logging every time the Wi-Fi Manager opens on a laptop. See the note on this file\'s own wifi-manager.js gap below.' },
  //ssid/psk cross as separate argv elements to nmcli, never concatenated into a command string -
  //the same discipline installUpdate's argv/stdin split follows, so a passphrase or SSID containing
  //shell metacharacters cannot inject anything (there is no shell here either).
  wifiConnect: { group: 'K', params: ['ssid'], optional: ['psk'], returns: 'void' },
  wifiGetAddress: { group: 'K', params: [], returns: 'string (empty when the device has no address yet)' },
  //Added after Phase 8, closing the gap that phase's own write-up recorded rather than converted:
  //wifi-manager.js has seven functions and only three had a command. These four never appeared in
  //this table before now, and still spawned nmcli directly from wifi-manager.js until this change -
  //see the inventory's group K section for the history. Same UNAVAILABLE-on-missing-nmcli
  //discipline as wifiListNetworks/wifiConnect/wifiGetAddress: the ordinary case off a writerDeck,
  //not a failure worth logging every time this dialog opens.
  wifiGetConnectionState: { group: 'K', params: [], returns: '{ state, connection }',
    note: '`state`/`connection` are whatever nmcli reports for the wifi device - "unknown"/null when no wifi device is present at all, which is a resolved value, not UNAVAILABLE (a device search that comes back empty is not "nmcli is missing").' },
  wifiGetStatus: { group: 'K', params: [], returns: "'enabled' | 'disabled', the radio's on/off state" },
  //Toggles the wifi radio as a whole, not a specific device or connection - unlike wifiConnect,
  //which takes the ssid/psk the writer just typed, these take nothing at all. Declared with an
  //explicit empty params array rather than left to be inferred, since these are the last two
  //commands added to this table and Phase 9 puts every one of them behind a bridge.
  wifiEnable: { group: 'K', params: [], returns: 'void' },
  wifiDisable: { group: 'K', params: [], returns: 'void' },
  //Phase 8 correction: rejects UNAVAILABLE rather than resolving null when no battery is present -
  //CODES.UNAVAILABLE's own doc comment already names "no battery" as its third example, and this is
  //the everyday result on every machine that is not a writerDeck. A battery that exists but cannot
  //be read (a spawn failure, non-numeric sysfs output) is IO_ERROR instead, so a caller can still
  //tell "there is nothing to report" apart from "something is actually wrong."
  getBatteryCapacity: { group: 'K', params: [], returns: 'number' }
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
