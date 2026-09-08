const Quill = require('quill');
const { createPlatform } = require('./components/controllers/platform');
const { createIpcBacking } = require('./components/controllers/platform-ipc');
const getUserSettings = require('./components/models/user-settings');
const newChapter = require('./components/models/chapter');
const newProject = require('./components/models/project');
const autosaver = require('./components/controllers/autosave');
const chapterList = require('./components/controllers/chapter-list');
const { registerKeybindings } = require('./components/controllers/keybindings');
const { applyQuillShortcuts, splitDeltaAtIndices } = require('./components/controllers/quill-utils');
const { attachAutocorrect } = require('./components/controllers/autocorrect');
const { registerFootnoteBlots } = require('./components/blots/footnotes');
const {
  applyStructuralFootnoteChanges,
  renumberFootnotes,
  redistributeFootnotes
} = require('./components/controllers/reconcile-footnotes');
const {
  footnoteEnterBinding,
  attachFootnoteClipboard,
  markerAt
} = require('./components/controllers/footnote-navigation');
const { resolveShortcuts } = require('./components/models/shortcuts');
const { resolveAutocorrect } = require('./components/models/autocorrect');
const { setSelectedDictionaries, setProjectWords } = require('./components/controllers/spellcheck');
const { enableTypewriterMode, disableTypewriterMode } = require('./components/controllers/typewriter-mode');
const {
  removeElementsByClass,
  disableSearchView
} = require('./components/controllers/utils');
const { showBattery } = require('./components/views/battery_display');
const { renderChapterList, renameChapterInList } = require('./components/views/chapter-list_display');

//The single boundary to the OS and the main process - see platform.js. getAppPaths/
//getFileRequestedOnOpen used to be sendSync calls made here at module load; both are now regular
//commands, which means both are promises, which is why loadPlatformState() below exists at all -
//nothing that depends on sysDirectories or userSettings can run until it resolves.
//
//As of Phase 9a this is the *only* platform instance this file has. Through Phase 8 there were two:
//this one for group A, and a second node-backed one for everything that was plain fs and therefore
//reachable from the renderer directly. The node backing now runs in the main process, so both
//halves are this object, and the 37 menu channels come through it as well - render.js no longer
//requires 'electron' at all.
var platform = createPlatform(createIpcBacking());

//Must run before either Quill instance below is constructed - scroll.js's whitelist (built from
//the `formats` option) is what makes 'footnote'/'footnoteBody' insertable at all, and Parchment has
//to know the blot/attributor exists before that whitelist can even name it.
registerFootnoteBlots();

var editorQuill = new Quill('#editor-container', {
  modules: {
    history: {
      userOnly: true
    },
    keyboard: {
      bindings: quillBindingsToDisable()
    }
  },
  placeholder: '',
  //footnote/footnoteBody are editor-only, deliberately absent from notesQuill's own list below - a
  //footnote pasted into notes degrades to literal "[^N]" text instead (see setUpQuills), since a
  //note has no chapter of its own for the body to belong to.
  formats: ['bold', 'italic', 'strike', 'underline', 'blockquote', 'header', 'align', 'list', 'indent', 'footnote', 'footnoteBody', 'footnoteBodyCont']
});

//Quill's own Enter handler is added unconditionally after the named `options.bindings` loop (see
//keyboard.js's constructor), which is why quillBindingsToDisable() cannot reach it - this has to be
//unshifted directly onto the bindings array instead. Attached once, here, rather than from
//setUpQuills(): unlike the formatting shortcuts, this one isn't tagged with a warewoolfAction, so
//re-running the block that attaches it would stack a duplicate on every rebind.
editorQuill.keyboard.bindings[13] = editorQuill.keyboard.bindings[13] || [];
editorQuill.keyboard.bindings[13].unshift(footnoteEnterBinding(editorQuill));

attachFootnoteClipboard(editorQuill);

var notesQuill = new Quill('#notes-editor', {
  modules: {
    history: {
      userOnly: true
    },
    keyboard: {
      bindings: quillBindingsToDisable()
    }
  },
  placeholder: 'Notes...',
  formats: ['bold', 'italic', 'strike', 'underline', 'blockquote', 'header', 'align', 'list', 'indent']
});

//notesQuill's own `formats` above has no 'footnote' entry, so a pasted marker would otherwise be
//silently dropped by scroll.js's whitelist check - the writer loses characters with no indication.
//Degrading it to the literal reference text instead is what a writer would have typed by hand.
notesQuill.clipboard.addMatcher('sup.ww-fnref', function(node, delta){
  var Delta = Quill.import('delta');
  return new Delta().insert('[^' + (node.getAttribute('data-n') || '') + ']');
});

//Quill binds Ctrl+B/I/U itself, and those three are in the Shortcuts popup's list like every other
//formatting shortcut - so they have to be rebindable, which means Quill's own copies have to go.
//A binding named in Quill's defaults and given a falsy value here is skipped when its keyboard
//module is built (see Keyboard's constructor), which is the only supported way to drop one: there
//is no removeBinding() in Quill 1.x. quill-utils.js adds all three back from the writer's own
//bindings, along with the rest of the formatting shortcuts.
function quillBindingsToDisable(){
  return { bold: null, italic: null, underline: null };
}

var project = newProject();

//The keyboard shortcuts in force: the defaults from models/shortcuts.js with the writer's saved
//overrides over them. Replaced wholesale when a writer saves a change from the Shortcuts popup -
//keybindings.js reads it through a getter on every keypress, so nothing there needs re-registering,
//while Quill's own bindings do have to be re-applied (see applyShortcutChanges below).
var shortcutBindings = resolveShortcuts(null);

//The automatic substitutions in force - smart quotes, em dashes and the rest. Same shape and same
//reasoning as shortcutBindings above: the defaults with the writer's saved changes over them,
//replaced wholesale when Settings is saved, and read through a getter by the two editors so
//nothing has to be re-attached when it changes. Empty while the master switch is off, which is how
//"substitute nothing" is said to controllers/autocorrect.js.
var autocorrectRules = resolveAutocorrect(null);

//Populated by loadPlatformState() below, once getAppPaths()/getFileRequestedOnOpen() resolve.
//Nothing above this line needs them; everything below runs from inside functions and reads these by
//closure, not at define-time, so it does not matter that they start out undefined.
var sysDirectories, fileRequestedOnOpen, userSettings, platformInfo;

//Exposed for testing only - nothing in the app itself reads this module's exports, since it's
//loaded as a plain <script> tag rather than required. `ready` is how a caller (render.test.js's
//freshRender()) waits for loadPlatformState() below to populate the rest of this object - project,
//userSettings, and the handful of chapter/reference/trash functions that are the most bug-prone and
//highest-value part of this file to unit test directly - since require() itself cannot wait on it.
//The rejection handler is not optional decoration. Everything below this line runs from inside
//loadPlatformState(), so a failure anywhere in it - a platform command that rejects, unreadable
//user settings, a throw out of initialize() - used to surface as an unhandled promise rejection and
//nothing else: a window with two empty editors, no keybindings, no menu, and no indication that
//anything had gone wrong. That is the silence platform.js's rule 5 exists to prevent. Reported to
//the reader instead, and re-thrown so `ready` still rejects for a test that asserts on it.
module.exports.ready = loadPlatformState().catch(function(err){
  reportStartupFailure(err);
  throw err;
});

//A good many functions in this file became async in Phase 4, and several of them are called by
//things that drop the return value on the floor: a menu channel, a keybinding, a file dialog's
//callback, an autosave timer. A rejection out of one of those has nowhere to go and would be an
//unhandled rejection with nothing on screen and nothing in the log - which is the silence
//platform.js's rule 5 exists to prevent.
//
//Only the rejection is caught. A synchronous throw is left to propagate exactly as it did before
//any of this was async, so nothing that used to fail loudly starts failing quietly instead.
function detached(fn){
  return function(){
    var result = fn.apply(this, arguments);

    if(result && typeof result.then === 'function')
      result.catch(reportDetachedFailure);

    return result;
  };
}

function reportDetachedFailure(err){
  require('./components/controllers/error-log').logError(err);
}

//Kept out of loadPlatformState()'s own try/catch reasoning: this must not itself be able to throw
//past the handler above, so it swallows a failure to report rather than replacing one unhandled
//rejection with another.
function reportStartupFailure(err){
  //Logged first, since the popup below is the part most likely to fail on a badly broken boot.
  try{
    require('./components/controllers/error-log').logError(err);
  }
  catch(logErr){
    console.log(logErr);
  }

  try{
    require('./components/views/startup-error_display')(err);
  }
  catch(displayErr){
    console.log(displayErr);
  }
}

async function loadPlatformState(){
  sysDirectories = await platform.getAppPaths();
  //The four modules that are handed a platform rather than holding one. They used to be handed a
  //second, node-backed instance built here out of sysDirectories and an OS keystore reached over
  //three sendSync channels; groups B/C/D were plain fs, so the renderer could just do the work. It
  //cannot any more, and does not need to: the same commands arrive at the same node backing, one
  //process over. Nothing in the renderer derives a key, seals a secret, or writes credentials.json,
  //and now nothing in it opens a file either.
  require('./components/controllers/error-log').setPlatform(platform);
  newProject.setPlatform(platform);
  newChapter.setPlatform(platform);
  getUserSettings.setPlatform(platform);
  fileRequestedOnOpen = await platform.getFileRequestedOnOpen();
  platformInfo = await platform.getPlatform();

  userSettings = await getUserSettings(sysDirectories.userData + "/user-settings.json").load();
  shortcutBindings = resolveShortcuts(userSettings.keyboardShortcuts);
  autocorrectRules = resolveAutocorrectSetting();
  //Whatever a writer ticked in the Dictionaries dialog last time - an empty array means "whatever
  //the app ships as default", which is exactly what an empty selectedDictionaries already falls back
  //to inside getSpellchecker().
  setSelectedDictionaries(userSettings.spellcheckDictionaries);
  await migrateLegacyCredential();

  await initialize();

  //Wires up every keyboard shortcut that is not a menu item - see keybindings.js for the dispatch
  //itself. context.project is a getter, not the object directly, because createNewProject() below
  //replaces it with a brand new one; capturing it here would leave every shortcut acting on the
  //project this app started with rather than whatever project is actually open. userSettings is
  //held directly rather than through a getter - unlike `project` it is never reassigned - which is
  //exactly why this call has to happen here rather than at this file's true top level: userSettings
  //does not exist yet until the two lines above it in this function have run.
  var unregisterKeybindings = registerKeybindings({
    getProject: function(){ return project; },
    //Read on every keypress rather than captured here, for the same reason getProject is a getter:
    //this whole object is replaced when a writer rebinds something.
    getShortcuts: function(){ return shortcutBindings; },
    userSettings: userSettings,
    editorQuill: editorQuill,
    notesQuill: notesQuill,
    //Wrapped rather than passed straight through: keybindings.js calls these from a keydown
    //listener and never looks at what they return, and three of them (both chapter-navigation
    //shortcuts and the notes toggle) are async now. See detached() above.
    actions: {
      moveChapUp: moveChapUp,
      moveChapDown: moveChapDown,
      changeChapterTitle: changeChapterTitle,
      displayPreviousChapter: detached(displayPreviousChapter),
      displayNextChapter: detached(displayNextChapter),
      togglePanelDisplay: togglePanelDisplay,
      toggleChapterNotes: detached(toggleChapterNotes),
      updatePanelDisplays: updatePanelDisplays,
      increaseFontSizeSetting: increaseFontSizeSetting,
      decreaseFontSizeSetting: decreaseFontSizeSetting,
      increaseEditorWidthSetting: increaseEditorWidthSetting,
      descreaseEditorWidthSetting: descreaseEditorWidthSetting
    }
  });

  //The keybindings above are now registered, and so is everything else this file subscribes to
  //through platform.on() (the per-menu-channel listeners and the file-opened-from-outside handler,
  //both further down this file but run in the first synchronous pass through it - well before this
  //async function ever got here). index.js's close guard only hands a window close to this renderer
  //once this fires, so nothing above may still be pending when it does.
  await platform.notifyRendererReady();

  Object.assign(module.exports, {
    project,
    userSettings,
    editorQuill,
    notesQuill,
    moveChapUp,
    moveChapDown,
    moveToTrash,
    deleteChapter,
    verifyToDelete,
    restoreFromTrash,
    updateFileList,
    displayChapterByIndex,
    addNewChapter,
    addImportedChapter,
    changeChapterTitle,
    splitChapter,
    editorHasFocus,
    editorIsVisible,
    _unregisterKeybindings: unregisterKeybindings
  });
}

//Versions up to 2.2.1 kept the saved email password inside user-settings.json, encrypted with a
//key that shipped in the packaged source. This runs on every launch, on real machines, and lifts
//it out: migrateLegacyCredential decrypts it with that old key and re-seals it under whatever this
//machine can actually offer, entirely natively - the recovered password never crosses back - and
//clearing the settings field afterward is this file's job, since this file owns the settings.
//
//The two flags are not the same question, and treating them as one loses a case:
//
//  recognized - the field held a pre-2.2.2 blob. It is dead now either way, so clear it. A blob
//               that decrypts to nothing (a 2.2.1 writer who ticked "remember" with an empty
//               password field) is recognized but not migrated, and the code this replaced cleared
//               the field for them too. Keying the clear off `migrated` instead would leave that
//               blob sitting there, retried on every launch, forever, saying nothing.
//  migrated   - a password was actually recovered and re-sealed.
//
//Failures are logged and swallowed, exactly as they were when this was a try/catch inside the
//credential store: a broken keystore must not stop the app from starting. Swallowing also leaves
//the legacy blob where it is, so the next launch tries again rather than destroying the writer's
//only copy of the password - which is what the old code did when the re-save failed.
async function migrateLegacyCredential(){
  try{
    var result = await platform.migrateLegacyCredential({
      service: 'email',
      legacyBlob: userSettings.senderPass
    });

    if(!result.recognized)
      return;

    userSettings.senderPass = null;
    await userSettings.save();
  }
  catch(err){
    require('./components/controllers/error-log').logError(err);
  }
}

async function initialize(){
  setUpQuills();
  applyUserSettings();
  await loadInitialProject();
}

async function loadInitialProject(){
  //Load requested project, last project opened, or if none logged, load example project, and if example gone, create new project
  const exampleFilename = "Frankenstein.woolf";
  const bundledExampleDir = sysDirectories.app + "/examples/Frankenstein";
  const bundledExample = bundledExampleDir + "/" + exampleFilename;
  const writableExampleDir = sysDirectories.userData + "/Projects/Frankenstein";
  const writableExample = writableExampleDir + "/" + exampleFilename;

  //(Phase 9b) These four were the renderer's last `fs` calls, and the last thing in it that opened
  //the filesystem at all. pathExists (group E) already existed; awaiting it here is the whole
  //change. The chain stays an if/else-if - the checks are ordered by preference, not merely
  //grouped, and each one must not run when an earlier branch already matched: an eager
  //Promise.all() of all four would stat the example projects on every launch, and worse, would ask
  //the main process about paths built from a userSettings that a failed earlier branch may have
  //left stale. Sequential `await` in the conditions preserves exactly the old short-circuit.
  if(fileRequestedOnOpen != null && await platform.pathExists({ path: fileRequestedOnOpen })){
    await setProject(fileRequestedOnOpen);
    userSettings.lastProject = fileRequestedOnOpen;
  }
  else if(userSettings.lastProject != null && await platform.pathExists({ path: userSettings.lastProject }))
    await setProject(userSettings.lastProject);
  else if(await platform.pathExists({ path: writableExample })){
    await setProject(writableExample);
    userSettings.lastProject = writableExample;
  }
  else if(await platform.pathExists({ path: bundledExample })){
    //The bundled copy lives inside the installed app directory (e.g. /usr/lib/... on a Linux
    //package install), which a normal user account can't write back to - editing it and letting
    //autosave or a manual save run against it in place always fails with EACCES. Copy it out to
    //userData once on first launch and open that copy instead, so the example is actually editable.
    var materialized = await platform.materializeBundledProject({
      bundledDir: bundledExampleDir,
      writableDir: writableExampleDir,
      filename: exampleFilename
    });

    //Closes the open finding recorded in upgrade-and-isolation-plan.md. When the copy fails, the
    //example is opened from the install directory instead - which is exactly the read-only case the
    //copy exists to avoid, and it used to be indistinguishable from a writable one, so every later
    //save died with EACCES in silence. Flagged instead, so Ctrl+S offers Save As the way it does for
    //the Help doc. Handed to setProject() rather than set afterwards - see its own comment for why
    //that ordering is load-bearing.
    if(materialized.error)
      require('./components/controllers/error-log').logError(
        new Error('Could not copy the bundled example project into userData ('
          + materialized.error.code + '): ' + materialized.error.message
          + ' - opening it read-only instead.'));

    await setProject(materialized.path, !materialized.writable);

    userSettings.lastProject = project.directory + project.filename;
  }
  else {
    //Start new project
    createNewProject();
  }
}

function setUpQuills(){
  applyQuillShortcuts(editorQuill, shortcutBindings);
  applyQuillShortcuts(notesQuill, shortcutBindings);
  //Attached once and never re-attached: unlike Quill's own bindings, these read the rules through
  //the getter below on every keystroke, so a change in Settings takes effect on the next character
  //typed. The returned detach functions are dropped because both editors live as long as the
  //window does - there is nothing here to tear down.
  attachAutocorrect(editorQuill, getAutocorrectRules);
  attachAutocorrect(notesQuill, getAutocorrectRules);
  disableTabbingToEditors();
}

function getAutocorrectRules(){
  return autocorrectRules;
}

//The master switch is folded in here rather than checked on every keystroke: with it off there are
//simply no rules, which is the same thing said in the shape controllers/autocorrect.js already
//understands. The individual rules a writer chose are left in user settings untouched, so turning
//it back on restores them rather than starting from the defaults.
function resolveAutocorrectSetting(){
  return userSettings.autocorrectEnabled ? resolveAutocorrect(userSettings.autocorrect) : {};
}

//What the Shortcuts popup calls when a writer saves a change. `overrides` is only what differs from
//the defaults (see shortcuts.js diffFromDefaults), which is exactly what gets stored.
//
//The two editors need their bindings rebuilt because Quill owns those; nothing else does, since
//keybindings.js reads the map on every keypress.
function applyShortcutChanges(overrides){
  userSettings.keyboardShortcuts = overrides;
  shortcutBindings = resolveShortcuts(overrides);
  applyQuillShortcuts(editorQuill, shortcutBindings);
  applyQuillShortcuts(notesQuill, shortcutBindings);
  return userSettings.save();
}

function disableTabbingToEditors(){
  var editors = document.getElementsByClassName("ql-editor");
  for(let i=0; i < editors.length; i++){
    editors[i].tabIndex = -1;
  }
}

function applyUserSettings(){
  updateFontSize();
  if(userSettings.typewriterMode)
    enableTypewriterMode(editorQuill)
  updateEditorWidth();
  updatePanelDisplays();
  //Wrapped: the autosave timer never looks at what its callback returns, and saving is asynchronous
  //now - see detached().
  autosaver.initiateAutosave(userSettings.autosaveIntMinutes, detached(autosaveProject));
  setDarkMode();
  if(userSettings.showBattery && platformInfo.platform == 'linux')
    showBattery();
}

function updateFontSize(){
  document.documentElement.style.setProperty('--main-font-size', userSettings.fontSize + 'pt');
  document.documentElement.style.setProperty('--dialog-font-size', userSettings.fontSize + 'pt');
  document.documentElement.style.setProperty('--dialog-font-size-small', (userSettings.fontSize - 2) + 'pt');
  document.documentElement.style.setProperty('--dialog-heading-size', (userSettings.fontSize + 2) + 'pt');
}

function updateEditorWidth(){
  document.documentElement.style.setProperty('--editor-width', userSettings.editorWidth + '%');
  document.documentElement.style.setProperty('--sidebar-width', ((100 - userSettings.editorWidth) / 2) + "%");
  document.documentElement.style.setProperty('--sidebar-width-double-view', (100 - userSettings.editorWidth) + "%");
}

function setDarkMode(){
  platform.setTheme({ mode: userSettings.darkMode }).catch(function(err){
    require('./components/controllers/error-log').logError(err);
  });
}

//`readOnly` has to be an argument rather than something the caller sets afterward, and that is not
//a convenience. loadFile() clears the flag on every load, and convertLegacyProject() below ends in
//an unconditional project.saveFile() - so a caller that opened a read-only copy and set the flag on
//the way back would already have written to it. That is how the bundled example, opened from the
//install directory because its copy out to userData failed, was saved over before anything knew it
//was read-only.
async function setProject(filepath, readOnly){
  if(filepath && filepath != null){
    var missingChaps = await project.loadFile(filepath);
    if(await projectFailedToLoad(filepath))
      return;
    //Set before anything downstream can write. Nothing else in this function may run first.
    project.isReadOnly = readOnly === true;
    if(missingChaps.length > 0){
      console.log('could not find all chapters.');
      const promptForMissingPups = require('./components/views/missing-pups_display');
      await promptForMissingPups(project, function(resp){
        if(resp == 'save')
          setProject(filepath, readOnly).catch(reportDetachedFailure);
        else
          createNewProject();
      });
    }
    else{
      await convertLegacyProject();
      await displayProject();
    }
  }
}

//Every path that opens a project file runs its result through this. Returns true when the file
//could not be read at all - truncated by a power loss mid-save, or simply not a .woolf - in which
//case the failure has already been dealt with here and the caller should stop rather than go on to
//display a project that is not there.
async function projectFailedToLoad(filepath){
  if(!project.loadError)
    return false;

  var loadError = project.loadError;

  //loadFile() assigns the parsed file onto the project before it walks the chapter lists, so a
  //failure partway through leaves chapters that were never turned into chapter objects behind on
  //it. Start from a clean project rather than trying to display a half-loaded one.
  project = newProject();
  project.initNotesChap();
  await displayProject();

  const reportProjectLoadFailure = require('./components/views/project-load-error_display');
  reportProjectLoadFailure(filepath, loadError);
  return true;
}

//Runs on every setProject(), and ends in an unconditional save - so opening any project writes its
//.woolf back out, whether or not there was anything legacy to convert. That is longstanding
//behaviour, left as it is; what changes here is that the write is now awaited, so the project is on
//disk before the UI is drawn from it. A read-only project (the Help doc, or a Frankenstein example
//whose copy out to userData failed) is refused by saveFile()'s own guard and simply returns false.
async function convertLegacyProject(){
  //Nothing here can be done to a project that cannot be written to, and the two conversions below
  //write through chapter.js rather than project.saveFile() - so the read-only guard in
  //project.saveFile() does not cover them. Without this, opening the bundled example out of the
  //install directory (the fallback taken when its copy to userData fails) would attempt a chapter
  //write per legacy chapter, each one an EACCES swallowed into the log.
  if(project.isReadOnly)
    return;

  //Convert legacy notes from v2.1 and before
  if(project.notes){
    project.notesChap.notes = project.notes;
    await project.notesChap.saveNotesFile();
  }

  //Convert legacy chapters from v1.1 and before
  for(let i = 0; i < project.chapters.length; i++){
    let chap = project.chapters[i];
    if(chap.filename.includes('.pup')){
      chap.contents = await chap.getFile();
      await chap.saveFile();
      chap.contents = null;
    }
  }
  await project.saveFile();
}

async function displayProject(){
  //The one place that already knows the project changed, whether it was opened (setProject) or
  //created fresh (createNewProject) - both funnel through here.
  setProjectWords(project.projectDictionary);
  updateFileList();
  updateTitleBar();
  await refreshNotesDisplay();
  await displayInitialChapter();
  await setWordCountOnLoad();
  editorQuill.focus();
  editorQuill.setSelection(project.textCursorPosition);
  scrollChapterListToActiveChapter();
}

async function setWordCountOnLoad(){
  const { getTotalWordCount } = require('./components/controllers/wordcount');
  project.wordCountOnLoad = await getTotalWordCount(project);
}

function updateFileList(){
  renderChapterList(project, {
    onSelect: displayChapterByIndex,
    onRename: changeChapterTitle
  });
}

async function displayChapterByIndex(ind){
  clearCurrentChapterIfUnchanged();
  ind = parseInt(ind);

  //An index past the last chapter stays on the last chapter; null means every chapter has been
  //permanently deleted, so clear the editor the same way deleteChapter() already does for that
  //case rather than trying to display something that is not there.
  var loc = chapterList.clampedLocator(project, ind);

  if(loc == null){
    project.activeChapterIndex = 0;
    editorQuill.disable();
    editorQuill.setText("");
    updateFileList();
    return;
  }

  project.activeChapterIndex = chapterList.toCombinedIndex(project, loc);

  //The mirror of the disable() above. Emptying a project disables the editor, and nothing on the
  //load path used to turn it back on again - so opening a project that did have chapters, after
  //deleting every chapter of the last one, left the reader looking at their book unable to type a
  //word into it, with nothing short of adding a chapter or restarting to get out of it.
  editorQuill.enable();

  var chap = chapterList.resolve(project, loc);

  var contents;
  if(chap.contents != undefined && chap.contents != null){
    contents = chap.contents;
  }
  else{
     contents = await chap.getFile();
  }

  var correctNotesChap = userSettings.displayChapNotes ? chap : project.notesChap;
  var notes;
  if(correctNotesChap.notes != undefined && correctNotesChap.notes != null){
    notes = correctNotesChap.notes;
  }
  else {
    let savedNotes = await correctNotesChap.getNotesFile();
    notes = savedNotes ? savedNotes : getEmptyDelta();
  }

  editorQuill.setContents(contents, 'api');
  notesQuill.setContents(notes, 'api');
  updateFileList();
}

function updateTitleBar(){
  //Says so for a read-only project, so it isn't a surprise that Ctrl+S opens Save As rather than
  //saving in place.
  document.title = "Warewoolf - " + (project.filename != "" ? project.filename : "unsaved project")
    + (project.isReadOnly ? " (read-only)" : "");
}

async function refreshNotesDisplay(){
  var notesHeader = document.getElementById('notes-header');

  if(userSettings.displayChapNotes){
    var activeChapter = project.getActiveChapter();
    let savedNotes = activeChapter ? await activeChapter.getNotesContentOrFile() : null;
    let currentNotes = savedNotes ? savedNotes : getEmptyDelta();
    notesQuill.setContents(currentNotes, 'api');

    notesHeader.innerText = 'Chapter Notes';
  }
  else{
    let savedNotes = await project.notesChap.getNotesContentOrFile();
    let currentNotes = savedNotes ? savedNotes : getEmptyDelta();
    notesQuill.setContents(currentNotes, 'api');

    notesHeader.innerText = 'Project Notes';
  }
}

function getEmptyDelta(){
  return {"ops":[{"insert":"\n"}]};
}

async function displayInitialChapter(){
  await displayChapterByIndex(project.activeChapterIndex);
}

function togglePanelDisplay(p){
  if(p == 1)
    userSettings.displayChapList = !userSettings.displayChapList;
  else if(p == 2)
    userSettings.displayEditor = !userSettings.displayEditor;
  else if(p == 3)
    userSettings.displayNotes = !userSettings.displayNotes;

  userSettings.save();

  updatePanelDisplays();
}

function updatePanelDisplays(){
  var chapList = document.getElementById('chapter-list-sidebar');
  var writingField = document.getElementById('writing-field');
  var notes = document.getElementById('project-notes');

  removeSpecialDisplayClasses(chapList);
  removeSpecialDisplayClasses(writingField);
  removeSpecialDisplayClasses(notes);

  var a = userSettings.displayChapList;
  var b = userSettings.displayEditor;
  var c = userSettings.displayNotes;

  if(a)
    chapList.classList.add('visible');
  if(b)
    writingField.classList.add('visible');
  if(c)
    notes.classList.add('visible');

  if(a && b && c){
    editorQuill.focus();
  }
  else if(a && b && !c){
    chapList.classList.add('sidebar-double-view');
    editorQuill.focus();
  }
  else if(a && !b && c){
    //Not sure here
    chapList.classList.add('sidebar-double-view');
    notes.classList.add('sidebar-notes-paired-with-chaps-view');
    notesQuill.focus();
  }
  else if(!a && b && c){
    notes.classList.add('sidebar-double-view');
    editorQuill.focus();
  }
  else if(a && !b && !c){
    chapList.classList.add('sidebar-single-view');
    chapList.focus();
  }
  else if(!a && b && !c){
    writingField.classList.add('writing-field-single-view');
    editorQuill.focus();
  }
  else if(!a && !b && c){
    notes.classList.add('sidebar-single-view');
    notesQuill.focus();
  }

}

function removeSpecialDisplayClasses(el){
  el.classList.remove('sidebar-single-view');
  el.classList.remove('sidebar-double-view');
  el.classList.remove('writing-field-single-view');
  el.classList.remove('sidebar-notes-paired-with-chaps-view');
  el.classList.remove('visible');
}

//User Actions

async function displayPreviousChapter(){
  if(project.activeChapterIndex > 0){
    await displayChapterByIndex(project.activeChapterIndex - 1);
    editorQuill.setSelection(0);
    project.textCursorPosition = 0;
  }
}

async function displayNextChapter(){
  if(!chapterList.isLastOfAll(project, chapterList.activeLocator(project))){
    await displayChapterByIndex(project.activeChapterIndex + 1);
    editorQuill.setSelection(0);
    project.textCursorPosition = 0;
  }

}

function moveChapUp(chapInd){
  var landed = chapterList.moveUp(project, chapterList.toLocator(project, chapInd));

  if(landed){
    project.hasUnsavedChanges = true;
    //Follow the chapter to wherever it ended up. Reordering inside a list shifts its combined
    //index by one; crossing the chapters/reference seam leaves it where it was.
    project.activeChapterIndex = chapterList.toCombinedIndex(project, landed);
  }

  updateFileList();
}

function moveChapDown(chapInd){
  var landed = chapterList.moveDown(project, chapterList.toLocator(project, chapInd));

  if(landed){
    project.hasUnsavedChanges = true;
    project.activeChapterIndex = chapterList.toCombinedIndex(project, landed);
  }

  updateFileList();
}


function createNewProject(){
  const requestProjectTitle = require('./components/views/new-project_display');
  requestProjectTitle(detached(async function(title){
    if(title && title != ""){
      project = newProject();
      project.title = title;
      project.author = userSettings.defaultAuthor;
      project.initNotesChap();
      await addNewChapter();
      await displayProject();
    }
  }));
}

async function addNewChapter(){
  var currentLoc = chapterList.activeLocator(project);
  var newChap = newChapter(project);
  newChap.hasUnsavedChanges = true;
  newChap.contents = getEmptyDelta();

  //A new chapter joins the Chapters list, right after the active one - except when a Reference
  //document is active, where it joins Reference instead. A Trash item active, or nothing in any
  //list yet, both fall through to appending onto the end of Chapters.
  var landed;
  if(currentLoc && currentLoc.list == 'reference')
    landed = chapterList.insertAt(project, 'reference', currentLoc.index + 1, newChap);
  else if(currentLoc && currentLoc.list == 'chapters')
    landed = chapterList.insertAt(project, 'chapters', currentLoc.index + 1, newChap);
  else
    landed = chapterList.append(project, 'chapters', newChap);

  project.hasUnsavedChanges = true;
  //displayChapterByIndex() below renders the sidebar itself as its last step, so this used to
  //render it a second time for nothing.
  var thisIndex = chapterList.toCombinedIndex(project, landed);
  await displayChapterByIndex(thisIndex);
  editorQuill.enable();
  changeChapterTitle(thisIndex);
}

//Autosave must not do what an explicit save does on a read-only project: routing it to Save As
//would pop a file dialog over the reader every autosave interval while the Help doc is open.
//Nothing is lost by skipping - saveFile() would refuse the write anyway.
async function autosaveProject(){
  if(project.isReadOnly)
    return;
  await saveProject();
}

async function saveProject(onComplete){
  //A read-only project (the bundled Help doc) has nowhere of its own to be written back to, so an
  //explicit save becomes Save As - the reader's annotated copy gets a home they chose, and
  //saveAs() clears the flag once it lands there.
  if(project.isReadOnly)
    saveProjectAs(onComplete);
  else if(project.filename != ""){
    clearCurrentChapterIfUnchanged();
    if(await project.saveFile()){
      project.hasUnsavedChanges = false;
      updateFileList();
      if(onComplete)
        onComplete(true);
    }
    else if(onComplete)
      onComplete(false);
  }
  else
    saveProjectAs(onComplete);
}

//Not awaited by the caller: the dialog is what takes time, and it reports through onComplete,
//exactly as before. showFileDialog() itself is async now (listing its initial directory goes
//through the platform facade), so the call is `.catch()`-ed rather than awaited - see detached()'s
//own comment for why a dropped rejection here would otherwise vanish silently.
function saveProjectAs(onComplete) {
  const options = {
    title: 'Save project as...',
    defaultPath: sysDirectories.docs,
    filters: [
      { name: 'WareWoolf Projects', extensions: ['woolf'] }
    ],
    bookmarkedPaths: [sysDirectories.docs, sysDirectories.home],
    projectDirectory: project.directory,
    dialogType: 'save'
  };

  const showFileDialog = require('./components/views/file-dialog_display');
  showFileDialog(options, detached(async function(filepath){
    if (filepath){
      var savedPath = await project.saveAs(filepath);
      if(savedPath){
        userSettings.lastProject = savedPath;
        userSettings.save();
        project.hasUnsavedChanges = false;
        updateFileList();
        updateTitleBar();
        if(onComplete)
          onComplete(true);
        return;
      }
    }
    if(onComplete)
      onComplete(false);
  })).catch(reportDetachedFailure);
}

function saveProjectCopy() {
  const options = {
    title: 'Save a copy of project as...',
    defaultPath: sysDirectories.docs,
    filters: [
      { name: 'WareWoolf Projects', extensions: ['woolf'] }
    ],
    bookmarkedPaths: [sysDirectories.docs, sysDirectories.home],
    projectDirectory: project.directory,
    dialogType: 'save'
  };

  const showFileDialog = require('./components/views/file-dialog_display');
  showFileDialog(options, detached(async function(filepath){
    if (filepath){
      await project.saveAs(filepath, true);
    }

    updateFileList();
    updateTitleBar();
  })).catch(reportDetachedFailure);
}

function openAProject() {
  const options = {
    title: 'Open project...',
    defaultPath: sysDirectories.docs,
    filters: [
      { name: 'WareWoolf Projects', extensions: ['woolf'] }
    ],
    bookmarkedPaths: [sysDirectories.docs, sysDirectories.home],
    projectDirectory: project.directory,
    dialogType: 'open'
  };

  const showFileDialog = require('./components/views/file-dialog_display');
  showFileDialog(options, detached(async function(filepath){
    if (filepath) {
      var missingChaps = await project.loadFile(filepath[0]);
      if(await projectFailedToLoad(filepath[0]))
        return;
      if(missingChaps.length > 0){
        const promptForMissingPups = require('./components/views/missing-pups_display');
        await promptForMissingPups(project, function(resp){
          displayProject().catch(reportDetachedFailure);
        });
      }
      else{
        await displayProject();
      }
      userSettings.lastProject = filepath[0];
      userSettings.save();
    }
  })).catch(reportDetachedFailure);
}



function clearCurrentChapterIfUnchanged(){
  var ch = project.getActiveChapter();
  if(ch && (ch.hasUnsavedChanges == undefined || ch.hasUnsavedChanges == false)){
    ch.contents = null;
    ch.notes = null;
  }
};

//Structural vs cosmetic footnote changes apply on different schedules and with different sources -
//see docs/footnotes-plan.md's "Source discipline". A structural change (a marker's own deletion
//cascading to its body, a pasted marker's payload materializing into a real body) is a real edit
//and belongs in the same undo entry as whatever triggered it, so it runs synchronously here, with
//source 'user'. Cosmetic renumbering/reordering is not itself a thing a writer should be able to
//undo, so it is debounced and applied with source 'silent' below.
var applyingFootnoteStructuralChange = false;
var footnoteRenumberTimer = null;

editorQuill.on('text-change', function(delta, oldDelta, source) {
  if(source == "user"){
    if(!applyingFootnoteStructuralChange)
      applyFootnoteStructuralChanges();

    //Guarded the same way the notes handler below already is: getActiveChapter() is undefined once
    //every chapter has been permanently deleted, and there is nothing to attach this text to.
    var chap = project.getActiveChapter();
    if(chap){
      chap.contents = editorQuill.getContents();
      chap.hasUnsavedChanges = true;
      project.hasUnsavedChanges = true;
    }

    scheduleFootnoteRenumber();
  }
});

//Applying this from inside the text-change handler re-enters it the moment updateContents() below
//fires its own text-change - applyingFootnoteStructuralChange is what stops that from recursing
//forever; the re-entrant call sees the now-clean content and finds nothing left to do regardless,
//but the flag makes that a guarantee rather than something resting on this pass happening to be
//idempotent.
function applyFootnoteStructuralChanges(){
  var Delta = Quill.import('delta');
  var current = editorQuill.getContents();
  var structural = applyStructuralFootnoteChanges(current);
  var diff = new Delta(current).diff(new Delta(structural));

  if(diff.ops.length === 0)
    return;

  applyingFootnoteStructuralChange = true;
  try{
    editorQuill.updateContents(diff, 'user');
  }
  finally{
    applyingFootnoteStructuralChange = false;
  }

  //Numbered here and now rather than left to the debounce below. A structural change is the one
  //case where waiting is visible: it has just put a marker and a body on screen carrying whatever
  //id materializePayloads picked for them, and both render their number straight from that id, so
  //a second of debounce is a second of the writer watching the wrong number. Both updates land
  //inside the same text-change, so the browser paints once, with the right number already in it.
  //
  //Unguarded by the caret check runFootnoteRenumber makes, deliberately: that check protects a
  //writer mid-sentence in a note from an idle timer reordering the ground under them, which is not
  //what this is - the writer just made an edit, and the reorder is part of it.
  applyFootnoteRenumber();
}

function scheduleFootnoteRenumber(){
  if(footnoteRenumberTimer)
    clearTimeout(footnoteRenumberTimer);

  footnoteRenumberTimer = setTimeout(runFootnoteRenumber, 1000);
}

//Skipped while the caret sits inside a footnote body, so a reorder never yanks the ground out from
//under someone mid-sentence in a note - deferred to save instead (see reconcile-footnotes.js's
//callers), which runs the full pass regardless of where the caret is.
function runFootnoteRenumber(){
  footnoteRenumberTimer = null;

  //getFormat() with no arguments force-focuses the editor to find a selection (see Quill's own
  //default parameter) - which is both pointless here (a debounced timer firing well after the
  //editor lost focus has no caret to protect) and, against a torn-down or never-focused editor,
  //throws rather than returning null. getSelection() alone never forces focus.
  var range = editorQuill.getSelection();
  if(range){
    var format = editorQuill.getFormat(range);
    if(format && format.footnoteBody != null)
      return;
  }

  applyFootnoteRenumber();
}

//Silent, so it is not itself undoable and does not re-enter the text-change handler above. Quill
//still hears about it through editor-change, which is what History listens on, so the undo stack
//is transformed rather than left pointing at indices this has moved.
function applyFootnoteRenumber(){
  var Delta = Quill.import('delta');
  var current = editorQuill.getContents();
  var renumbered = renumberFootnotes(current);
  var diff = new Delta(current).diff(new Delta(renumbered));

  if(diff.ops.length > 0)
    editorQuill.updateContents(diff, 'silent');
}

editorQuill.on('selection-change', function(range, oldRange, source){
  if(range){
    project.textCursorPosition = range.index;
  }

  updateActiveFootnoteHighlight(range);
})

//Highlights the marker and body that belong to each other. Only #editor-container - the element
//Quill was constructed on, outside .ql-editor itself - is ever touched here; a dedicated <style>
//element is what actually paints the highlight, via a plain, non-dynamic selector rebuilt on every
//selection change, rather than mutating any node .ql-editor's own MutationObserver would see.
var footnoteHighlightStyle = null;

function updateActiveFootnoteHighlight(range){
  if(footnoteHighlightStyle == null){
    footnoteHighlightStyle = document.createElement('style');
    document.head.appendChild(footnoteHighlightStyle);
  }

  var id = null;
  if(range){
    var format = editorQuill.getFormat(range);
    id = (format && format.footnoteBody != null) ? String(format.footnoteBody) : markerAt(editorQuill, range.index);
  }

  var container = document.getElementById('editor-container');

  if(id == null){
    container.removeAttribute('data-active-footnote');
    footnoteHighlightStyle.textContent = '';
    return;
  }

  container.setAttribute('data-active-footnote', id);

  var escaped = id.replace(/"/g, '\\"');
  footnoteHighlightStyle.textContent =
    '#editor-container .ww-fnref[data-n="' + escaped + '"], ' +
    '#editor-container [data-footnote="' + escaped + '"] { background-color: rgba(255, 213, 79, 0.45); }';
}

notesQuill.on('text-change', function(delta, oldDelta, source){
  if(source == 'user'){
    if(userSettings.displayChapNotes){
      //getActiveChapter() is undefined once every chapter has been permanently deleted -
      //nothing to attach these notes to in that state.
      var chap = project.getActiveChapter();
      if(chap){
        chap.notes = notesQuill.getContents();
        chap.hasUnsavedChanges = true;
      }
    }
    else {
      project.notesChap.notes = notesQuill.getContents();
      project.notesChap.hasUnsavedChanges = true;
    }

    project.hasUnsavedChanges = true;
  }
});

async function moveToTrash(ind){
  var loc = chapterList.toLocator(project, ind);

  //Nothing at that index to trash - on an empty project this used to splice an empty list and
  //push the resulting undefined into the trash.
  if(loc == null)
    return;

  //Already in the trash, so the next step is permanent deletion rather than another move.
  if(loc.list == 'trash'){
    verifyToDelete(ind);
    return;
  }

  project.hasUnsavedChanges = true;
  var wasActive = ind == project.activeChapterIndex;

  //Remembered so restoreFromTrash() can put the chapter back where it came from - otherwise a
  //deleted reference chapter would come back as a regular chapter.
  var chap = chapterList.remove(project, loc);
  chap.trashedFrom = loc.list;
  chapterList.append(project, 'trash', chap);

  if(wasActive){
    //Select whatever slid into the trashed chapter's place, falling back down the lists as they
    //empty out.
    var next = chapterList.selectionAfterRemoval(project, loc);
    await displayChapterByIndex(next ? chapterList.toCombinedIndex(project, next) : 0);
  }
  else
    updateFileList();
}

async function deleteChapter(ind){
  var loc = chapterList.toLocator(project, ind);
  var deletedChap = chapterList.remove(project, loc);

  //Always save project file after deleting a chapter
  //so if user closes without saving it won't expect
  //the deleted chapter at next load...
  await deletedChap.deleteFile();

  if(ind == project.activeChapterIndex){
    //Same "stay on whatever slid into the gap, else fall back" rule moveToTrash() uses - this
    //used to check only project.chapters.length, which meant deleting the last trashed chapter
    //blanked the editor even when the project still had reference chapters to show.
    var next = chapterList.selectionAfterRemoval(project, loc);
    if(next)
      await displayChapterByIndex(chapterList.toCombinedIndex(project, next));
    else{
      editorQuill.disable();
      editorQuill.setText("");
    }
  }

  //But save it *after* reassigning the activeChapterIndex
  //in case it is the last chapter that was deleted.
  //And only if it is not a new project that has not yet been saved.
  if(project.directory != '')
    await project.saveFile();
  updateFileList();
  console.log("deleted " + ind);
}

function verifyToDelete(ind){
  var loc = chapterList.toLocator(project, ind);
  if(loc && loc.list == 'trash'){
    const displayDeleteConfirmation = require('./components/views/delete-confirmation_display');
    displayDeleteConfirmation(detached(async function(){
      await deleteChapter(ind);
      editorQuill.focus();
    }));
  }
}

async function restoreFromTrash(ind){
  var loc = chapterList.toLocator(project, ind);

  if(!loc || loc.list != 'trash')
    return;

  var wasActive = ind == project.activeChapterIndex;
  //Where the selection points has to be remembered as a locator rather than as the number it is
  //stored as: restoring appends to Chapters, which renumbers every reference and trash item after
  //it, so the number would go on naming a different document once the move is done.
  var activeLoc = wasActive ? null : chapterList.activeLocator(project);
  if(activeLoc && activeLoc.list == 'trash' && activeLoc.index > loc.index)
    activeLoc.index -= 1;

  project.hasUnsavedChanges = true;
  var chap = chapterList.remove(project, loc);
  //Reference chapters were only ever trashed by moveToTrash(), which stamped this - default to
  //chapters for anything trashed before that stamp existed.
  var destList = chap.trashedFrom == 'reference' ? 'reference' : 'chapters';
  delete chap.trashedFrom;
  var landed = chapterList.append(project, destList, chap);

  if(wasActive){
    //Follow the restored chapter to its new place. Leaving activeChapterIndex where it was left
    //the editor still showing this chapter while the index named whatever slid into its old slot -
    //so the next keystroke was written into that other chapter, and saved over its file.
    await displayChapterByIndex(chapterList.toCombinedIndex(project, landed));
  }
  else{
    if(activeLoc)
      project.activeChapterIndex = chapterList.toCombinedIndex(project, activeLoc);
    updateFileList();
  }
}

function changeChapterTitle(ind){
  var chap = chapterList.chapterAt(project, ind);
  if(!chap)
    return;

  renameChapterInList(ind, {
    onCommit: function(newTitle){
      chap.title = newTitle;
      project.hasUnsavedChanges = true;
      chap.hasUnsavedChanges = true;
      updateFileList();
      editorQuill.focus();
    },
    onCancel: function(){
      updateFileList();
      editorQuill.focus();
    },
    onDismiss: function(){
      updateFileList();
    }
  });
}

//A footnote's marker and its body must land on the same side of the split, wherever the marker
//went - see reconcile-footnotes.js's redistributeFootnotes. Refused outright when the caret sits
//inside a footnote body: any snapping rule would either produce an empty chapter or silently move
//the split point the writer actually chose, and neither is better than asking them to move the
//caret out of the note first.
async function splitChapter(){
  var selection = editorQuill.getSelection(true);
  if(!selection)
    return;

  var format = editorQuill.getFormat(selection);
  if(format && format.footnoteBody != null){
    const showBlockedActionAlert = require('./components/views/blocked-action_display');
    showBlockedActionAlert('Cannot split a chapter inside a footnote. Move the caret out of the note first.');
    return;
  }

  var current = editorQuill.getContents();
  var fragments = redistributeFootnotes(splitDeltaAtIndices(current, [selection.index]));

  var Delta = Quill.import('delta');
  var reconciledFirst = new Delta(fragments[0]);
  editorQuill.updateContents(new Delta(current).diff(reconciledFirst), 'user');

  await addImportedChapter(fragments[1], "untitled");
  changeChapterTitle(project.activeChapterIndex);
}

function increaseEditorWidthSetting(){
  userSettings.editorWidth++;
  updateEditorWidth();
  userSettings.save();
}

function descreaseEditorWidthSetting(){
  userSettings.editorWidth--;
  updateEditorWidth();
  userSettings.save();
}

function increaseFontSizeSetting(){
  userSettings.fontSize++;
  updateFontSize();
  userSettings.save();
  scrollChapterListToActiveChapter();
}

function decreaseFontSizeSetting(){
  userSettings.fontSize--;
  updateFontSize();
  userSettings.save();
  scrollChapterListToActiveChapter();
}

function scrollChapterListToActiveChapter(){
  //No chapter/reference/trash item is marked active on a project with nothing in any of the
  //three lists.
  var activeChapter = document.querySelector('.activeChapter');
  if(!activeChapter)
    return;

  document.getElementById('chapter-list-sidebar').scrollTop =
    activeChapter.offsetTop - (document.getElementById('chapters-header').offsetHeight * 3);
}

//The Help doc is reference material, not the reader's own work: it has to describe the version
//actually installed. Copying it to userData on first open (as the Frankenstein example does, since
//that one is a starter project meant to be edited) meant the copy was made once and reused
//forever, so a release that updated the Help doc would never be seen by anyone who had already
//launched the app. Open the bundled copy in place instead, and mark the project read-only so the
//save paths know it cannot be written to. Anyone who wants to annotate it gets a Save As.
//Deliberately not setProject(path, true), even though that now takes the flag. setProject() runs
//convertLegacyProject() and the missing-chapters repair screen, and neither belongs to a document
//the reader cannot edit: repairing it would mean rewriting a file in the install directory, and
//there is nothing to repair anyway, since the Help doc ships complete.
async function openHelpDoc(){
  const bundledHelpDoc = sysDirectories.app + "/examples/HelpDoc/HelpDoc.woolf";

  await project.loadFile(bundledHelpDoc);
  if(await projectFailedToLoad(bundledHelpDoc))
    return;
  project.isReadOnly = true;
  await displayProject();
}

function exitApp(){
  if(userSettings.autoBackup == true && project.filename != ''){
    alertBackupResult('Loading backup tools...', true);
    const { backupProject, BACKUP_FINISHED } = require('./components/controllers/backup-project');
    backupProject(project, userSettings, sysDirectories.docs, function(update){
      alertBackupResult(update, true);
      if(update == BACKUP_FINISHED)
        confirmExit();
    });
  } else {
      confirmExit();
  }
}

function confirmExit(){
  platform.confirmExit().catch(function(err){
    require('./components/controllers/error-log').logError(err);
  });
}

//Adapts backup-project.js's stream of progress messages onto the alert popup: every message is
//shown, and the one that means the run is over takes the popup down with it.
function alertBackupResult(msg, allowExitWithoutBackup = false){
  const { showBackupAlert, hideBackupAlert } = require('./components/views/working_display');
  const { BACKUP_FINISHED } = require('./components/controllers/backup-project');

  if(msg == BACKUP_FINISHED){
    hideBackupAlert();
    return;
  }

  showBackupAlert(msg, allowExitWithoutBackup ? confirmExit : null);
}

async function addImportedChapter(chapDelta, title){
  var newChap = newChapter(project);
  newChap.hasUnsavedChanges = true;
  newChap.contents = chapDelta;
  newChap.title = title;

  //Same placement rule as addNewChapter(): joins Reference after the active document if that's
  //what's active, otherwise appends onto Chapters (which also covers a Trash item being active -
  //project.activeChapterIndex + 1 used to be passed straight to displayChapterByIndex() below,
  //which only happened to land correctly because a Chapter or Reference document being active
  //keeps that arithmetic in sync with the insert position; a Trash item active does not).
  var currentLoc = chapterList.activeLocator(project);
  var landed = (currentLoc && currentLoc.list == 'reference')
    ? chapterList.insertAt(project, 'reference', currentLoc.index + 1, newChap)
    : chapterList.insertAt(project, 'chapters', currentLoc && currentLoc.list == 'chapters' ? currentLoc.index + 1 : project.chapters.length, newChap);

  //displayChapterByIndex() below renders the sidebar itself as its last step, so this used to
  //render it a second time for nothing.
  await displayChapterByIndex(chapterList.toCombinedIndex(project, landed));
}

async function toggleChapterNotes(){
  userSettings.displayChapNotes = !userSettings.displayChapNotes;
  userSettings.save();
  await refreshNotesDisplay();
}


function editorHasFocus(){
  return editorIsVisible() && document.querySelector(".ql-editor") === document.activeElement;
}

function editorIsVisible(){
  return document.getElementById('writing-field').classList.contains('visible');
}

//Both channels below show the same "you have unsaved changes - save first?" prompt before doing
//something that would otherwise discard them; only exit-app-clicked refreshes the sidebar's
//unsaved-change markers first (open-clicked never has, though there's no obvious reason it
//shouldn't - preserved here rather than unified, since it's a real behaviour difference, not a
//mechanical one).
function proceedOrConfirmSave(continueFunc, refreshFileListFirst){
  if(project.hasUnsavedChanges){
    const displayExitConfirmation = require('./components/views/exit-confirmation_display');
    if(refreshFileListFirst)
      updateFileList();
    displayExitConfirmation(detached(saveProject), continueFunc);
  }
  else
    continueFunc();
}

//Most menu/IPC commands share one shape: lazily require a view module and call it with some
//subset of (project, userSettings, sysDirectories, ...), sometimes only while the editor has
//focus. Collecting them here means the focus guard - previously an ad-hoc `if(editorHasFocus())`
//repeated at some call sites and not others, with no way to see the whole set at a glance - is now
//one flag per entry, visible in one place. It does NOT change which channels currently have it:
//convert-tabs/renumber-chapters/indent-all/center-all-heads all edit chapter content project-wide
//without requiring editor focus, exactly as before, even though convert-first-lines and
//convert-italics (equally project-wide) do require it - a real inconsistency, left exactly as it
//was rather than resolved here, since which behaviour is correct is a product decision.
//
//A channel stays outside this table when it does not fit the shape above: open-clicked and
//exit-app-clicked are folded in via proceedOrConfirmSave() since their control flow reduces to
//that one pattern, but file-opened-from-outside-warewoolf takes its own argument (the opened
//path) and has a distinct multi-branch shape, so it is registered separately below the table.
const menuCommands = {
  'save-clicked': { run: function(){ return saveProject(); } },
  'save-as-clicked': { run: function(){ saveProjectAs(); } },
  'open-clicked': { run: function(){ proceedOrConfirmSave(openAProject); } },
  'new-project-clicked': { run: function(){ createNewProject(); } },
  'import-clicked': { run: function(){
    const showImportOptions = require('./components/views/import_display');
    showImportOptions(sysDirectories, detached(addImportedChapter), detached(async function(){
      await displayChapterByIndex(project.activeChapterIndex);
      if(project.chapters.length > 0)
        editorQuill.enable();
    }));
  } },
  'export-clicked': { run: function(){
    const showExportOptions = require('./components/views/export_display');
    showExportOptions(project, userSettings, sysDirectories);
  } },
  'properties-clicked': { run: function(){
    const showProperties = require('./components/views/properties_display');
    showProperties(project, userSettings);
  } },
  'compile-clicked': { run: function(){
    const showCompileOptions = require('./components/views/compile_display');
    showCompileOptions(project, sysDirectories, userSettings);
  } },
  'word-count-clicked': { run: function(){
    const showWordCount = require('./components/views/wordcount_display');
    return showWordCount(project, editorQuill);
  } },
  'find-replace-clicked': { requiresFocus: true, run: function(){
    const showFindReplace = require('./components/views/findreplace_display');
    showFindReplace(project, editorQuill, detached(displayChapterByIndex));
  } },
  'spellcheck-clicked': { requiresFocus: true, run: function(){
    const showSpellcheck = require('./components/views/spellcheck_display');
    const { getBeginningOfCurrentWord } = require('./components/controllers/spellcheck');
    const { getIndexableText } = require('./components/controllers/quill-utils');
    var currentIndex = editorQuill.getSelection(true).index;
    var beginningOfWord = getBeginningOfCurrentWord(getIndexableText(editorQuill), currentIndex);
    return showSpellcheck(editorQuill, project, detached(displayChapterByIndex), beginningOfWord);
  } },
  'convert-first-lines-clicked': { requiresFocus: true, run: function(){
    const showConvertFirstLines = require('./components/views/convert-first-lines_display');
    showConvertFirstLines(project, detached(function(){
      return displayChapterByIndex(project.activeChapterIndex);
    }));
  } },
  'headings-to-chaps-clicked': { requiresFocus: true, run: function(){
    const showBreakHeadingsOptions = require('./components/views/headings-to-chapters_display');
    showBreakHeadingsOptions(editorQuill, detached(addImportedChapter));
  } },
  'convert-italics-clicked': { requiresFocus: true, run: function(){
    const showItalicsOptions = require('./components/views/convert-italics_display');
    showItalicsOptions(project, detached(function(){
      return displayChapterByIndex(project.activeChapterIndex);
    }));
  } },
  'split-chapter-clicked': { requiresFocus: true, run: function(){ return splitChapter(); } },
  'add-chapter-clicked': { requiresFocus: true, run: function(){ return addNewChapter(); } },
  'delete-chapter-clicked': { requiresFocus: true, run: function(){ return moveToTrash(project.activeChapterIndex); } },
  'restore-chapter-clicked': { requiresFocus: true, run: function(){ return restoreFromTrash(project.activeChapterIndex); } },
  'shortcuts-clicked': { run: function(isMac){
    const showShortcutsHelp = require('./components/views/shortcuts-help_display');
    showShortcutsHelp({
      isMac: isMac,
      bindings: shortcutBindings,
      onSave: applyShortcutChanges
    });
  } },
  'outliner-clicked': { run: function(){
    const showOutliner = require('./components/views/outliner_display');
    return showOutliner(project);
  } },
  'convert-tabs-clicked': { run: function(){
    const showTabOptions = require('./components/views/convert-tabs-display');
    showTabOptions(project, detached(function(){
      return displayChapterByIndex(project.activeChapterIndex);
    }));
  } },
  'convert-substitutions-clicked': { run: function(){
    const showSubstitutionOptions = require('./components/views/convert-substitutions_display');
    showSubstitutionOptions(project, detached(function(){
      return displayChapterByIndex(project.activeChapterIndex);
    }));
  } },
  'about-clicked': { run: function(appVersion){
    const showAbout = require('./components/views/about_display');
    return showAbout(appVersion, platformInfo);
  } },
  'exit-app-clicked': { run: function(){ proceedOrConfirmSave(exitApp, true); } },
  'save-copy-clicked': { run: function(){ saveProjectCopy(); } },
  'help-doc-clicked': { run: function(){ return openHelpDoc(); } },
  'renumber-chapters-clicked': { run: function(){
    const showRenumberChapters = require('./components/views/renumber-chapters_display');
    showRenumberChapters(project, detached(function(){
      updateFileList();
      return displayChapterByIndex(project.activeChapterIndex);
    }));
  } },
  'send-via-email-clicked': { run: function(){
    const showEmailOptions = require('./components/views/email-doc_display');
    return showEmailOptions(project, userSettings, platform, editorQuill);
  } },
  'view-error-log-clicked': { run: function(){
    const showErrorLog = require('./components/views/error-log_display');
    return showErrorLog(userSettings, platform);
  } },
  'file-manager-clicked': { run: function(){
    const showFileManager = require('./components/views/file-manager_display');
    return showFileManager(sysDirectories, project.directory);
  } },
  'wifi-manager-clicked': { run: function(){
    const showWifiManager = require('./components/views/wifi-manager_display');
    showWifiManager();
  } },
  'save-backup-clicked': { run: function(){
    const { backupProject } = require('./components/controllers/backup-project');
    backupProject(project, userSettings, sysDirectories.docs, alertBackupResult);
  } },
  'settings-clicked': { run: function(){
    const showSettings = require('./components/views/settings_display');
    return showSettings(userSettings, autosaver, sysDirectories, detached(autosaveProject), function(){
      setDarkMode();
      autocorrectRules = resolveAutocorrectSetting();
    }, platformInfo);
  } },
  'corkboard-clicked': { run: function(){
    const showCorkboard = require('./components/views/corkboard_display');
    return showCorkboard(project, platformInfo);
  } },
  'indent-all-clicked': { run: async function(){
    const { indentAllParasInAllChaps } = require('./components/controllers/indent-all');
    await indentAllParasInAllChaps(project);
    await displayChapterByIndex(project.activeChapterIndex);
  } },
  'center-all-heads-clicked': { run: async function(){
    const { centerAllHeadingsInAllChaps } = require('./components/controllers/center-all-heads');
    await centerAllHeadingsInAllChaps(project);
    await displayChapterByIndex(project.activeChapterIndex);
  } }
};

//Phase 9a: these go through platform.on() rather than the raw ipc channel. Two things change with
//them, both worth knowing before reading the handlers below.
//
//A handler is called with the payload arguments only - preload.js drops the event object that used
//to arrive first, because forwarding it would hand the page `sender` and with it the whole ipc
//surface the bridge exists to withhold. So `function(e)` and `slice(arguments, 1)` are gone: the
//first argument is now the payload, where there is one.
//
//And the event name is validated against platform.js's EVENTS at subscribe time. A channel name
//that drifts from what index.js sends used to be silent - a menu item that simply did nothing, with
//nothing anywhere saying why. It now throws here, at startup, out of the first pass through this
//file.
Object.keys(menuCommands).forEach(function(channel){
  var command = menuCommands[channel];
  platform.on(channel, function(){
    if(command.requiresFocus && !editorHasFocus())
      return;
    //Wrapped because several of these are async now and nothing reads what a menu channel returns
    //- see detached(). The promise is handed back anyway: the bridge ignores it, but a test can
    //await the handler instead of guessing how many ticks the command needs.
    return detached(command.run)(...arguments);
  });
});

//Takes its own argument (the opened file's path) and has a distinct multi-branch shape - handling
//a chapter missing from disk mirrors openAProject()'s own file-dialog callback - so it is kept as
//an ordinary handler rather than forced into the single-argument shape above.
platform.on('file-opened-from-outside-warewoolf', detached(async function(fPath){
  if (fPath) {
    var missingChaps = await project.loadFile(fPath);
    if(await projectFailedToLoad(fPath))
      return;
    if(missingChaps.length > 0){
      const promptForMissingPups = require('./components/views/missing-pups_display');
      await promptForMissingPups(project, function(resp){
        displayProject().catch(reportDetachedFailure);
      });
    }
    else{
      await displayProject();
    }
    userSettings.lastProject = fPath;
    userSettings.save();
  }

}));
