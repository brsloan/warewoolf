const { ipcRenderer } = require('electron');
const fs = require('fs');
const Quill = require('quill');
const sysDirectories = ipcRenderer.sendSync('get-directories');
require('./components/controllers/error-log').setLogDirectory(sysDirectories.userData);
const getUserSettings = require('./components/models/user-settings');
const getCredentialStore = require('./components/models/credential-store');
const getSecureStorage = require('./components/controllers/secure-storage');
const newChapter = require('./components/models/chapter');
const newProject = require('./components/models/project');
const autosaver = require('./components/controllers/autosave');
const chapterList = require('./components/controllers/chapter-list');
const { registerKeybindings } = require('./components/controllers/keybindings');
const { addBindingsToQuill } = require('./components/controllers/quill-utils');
const { enableTypewriterMode, disableTypewriterMode } = require('./components/controllers/typewriter-mode');
const {
  removeElementsByClass,
  disableSearchView
} = require('./components/controllers/utils');
const fileRequestedOnOpen = ipcRenderer.sendSync('get-file-requested-on-open');
const { showBattery } = require('./components/views/battery_display');
const { renderChapterList, renameChapterInList } = require('./components/views/chapter-list_display');

var editorQuill = new Quill('#editor-container', {
  modules: {
    history: {
      userOnly: true
    }
  },
  placeholder: '',
  formats: ['bold', 'italic', 'strike', 'underline', 'blockquote', 'header', 'align', 'list', 'indent']
});

var notesQuill = new Quill('#notes-editor', {
  modules: {
    history: {
      userOnly: true
    }
  },
  placeholder: 'Notes...',
  formats: ['bold', 'italic', 'strike', 'underline', 'blockquote', 'header', 'align', 'list', 'indent']
});

var project = newProject();

var userSettings = getUserSettings(sysDirectories.userData + "/user-settings.json").load();
var credentialStore = getCredentialStore(sysDirectories.userData, getSecureStorage());
//Lift any password saved by an older version out of user-settings.json, where it sat under a
//key that shipped in the source, and re-seal it with whatever this machine can actually offer.
credentialStore.migrateLegacyPassword(userSettings);

initialize();

function initialize(){
  setUpQuills();
  applyUserSettings();
  loadInitialProject();
}

function loadInitialProject(){
  //Load requested project, last project opened, or if none logged, load example project, and if example gone, create new project
  const defaultProject = sysDirectories.app + "/examples/Frankenstein/Frankenstein.woolf";

  if(fileRequestedOnOpen != null && fs.existsSync(fileRequestedOnOpen)){
    setProject(fileRequestedOnOpen);
    userSettings.lastProject = fileRequestedOnOpen;
  }
  else if(userSettings.lastProject != null && fs.existsSync(userSettings.lastProject))
    setProject(userSettings.lastProject);
  else if(fs.existsSync(defaultProject)){
    setProject(defaultProject);
    userSettings.lastProject = defaultProject;
  }
  else {
    //Start new project
    createNewProject();
  }
}

function setUpQuills(){
  addBindingsToQuill(editorQuill);
  addBindingsToQuill(notesQuill);
  disableTabbingToEditors();
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
  autosaver.initiateAutosave(userSettings.autosaveIntMinutes, saveProject);
  setDarkMode();
  if(userSettings.showBattery && process.platform == 'linux')
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
  ipcRenderer.send('set-dark-mode', userSettings.darkMode);
}

function setProject(filepath){
  if(filepath && filepath != null){
    var missingChaps = project.loadFile(filepath);
    if(projectFailedToLoad(filepath))
      return;
    if(missingChaps.length > 0){
      console.log('could not find all chapters.');
      const promptForMissingPups = require('./components/views/missing-pups_display');
      promptForMissingPups(project, function(resp){
        if(resp == 'save')
          setProject(filepath);
        else
          createNewProject();
      });
    }
    else{
      convertLegacyProject();
      displayProject();
    }
  }
}

//Every path that opens a project file runs its result through this. Returns true when the file
//could not be read at all - truncated by a power loss mid-save, or simply not a .woolf - in which
//case the failure has already been dealt with here and the caller should stop rather than go on to
//display a project that is not there.
function projectFailedToLoad(filepath){
  if(!project.loadError)
    return false;

  var loadError = project.loadError;

  //loadFile() assigns the parsed file onto the project before it walks the chapter lists, so a
  //failure partway through leaves chapters that were never turned into chapter objects behind on
  //it. Start from a clean project rather than trying to display a half-loaded one.
  project = newProject();
  project.initNotesChap();
  displayProject();

  const reportProjectLoadFailure = require('./components/views/project-load-error_display');
  reportProjectLoadFailure(filepath, loadError);
  return true;
}

function convertLegacyProject(){

  //Convert legacy notes from v2.1 and before
  if(project.notes){
    project.notesChap.notes = project.notes;
    project.notesChap.saveNotesFile();
  }

  //Convert legacy chapters from v1.1 and before
  project.chapters.forEach(function(chap, i){
    if(chap.filename.includes('.pup')){
      chap.contents = chap.getFile();
      chap.saveFile();
      chap.contents = null;
    }
  });
  project.saveFile();
}

function displayProject(){
  updateFileList();
  updateTitleBar();
  refreshNotesDisplay();
  displayInitialChapter();
  setWordCountOnLoad();
  editorQuill.focus();
  editorQuill.setSelection(project.textCursorPosition);
  scrollChapterListToActiveChapter();
}

function setWordCountOnLoad(){
  const { getTotalWordCount } = require('./components/controllers/wordcount');
  project.wordCountOnLoad = getTotalWordCount(project);
}

function updateFileList(){
  renderChapterList(project, {
    onSelect: displayChapterByIndex,
    onRename: changeChapterTitle
  });
}

function displayChapterByIndex(ind){
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
     contents = chap.getFile();
  }

  var correctNotesChap = userSettings.displayChapNotes ? chap : project.notesChap;
  var notes;
  if(correctNotesChap.notes != undefined && correctNotesChap.notes != null){
    notes = correctNotesChap.notes;
  }
  else {
    let savedNotes = correctNotesChap.getNotesFile();
    notes = savedNotes ? savedNotes : getEmptyDelta();
  }

  editorQuill.setContents(contents, 'api');
  notesQuill.setContents(notes, 'api');
  updateFileList();
}

function updateTitleBar(){
  document.title = "Warewoolf - " + (project.filename != "" ? project.filename : "unsaved project");
}

function refreshNotesDisplay(){
  var notesHeader = document.getElementById('notes-header');

  if(userSettings.displayChapNotes){
    var activeChapter = project.getActiveChapter();
    let savedNotes = activeChapter ? activeChapter.getNotesContentOrFile() : null;
    let currentNotes = savedNotes ? savedNotes : getEmptyDelta();
    notesQuill.setContents(currentNotes, 'api');

    notesHeader.innerText = 'Chapter Notes';
  }
  else{
    let savedNotes = project.notesChap.getNotesContentOrFile();
    let currentNotes = savedNotes ? savedNotes : getEmptyDelta();
    notesQuill.setContents(currentNotes, 'api');

    notesHeader.innerText = 'Project Notes';
  }
}

function getEmptyDelta(){
  return {"ops":[{"insert":"\n"}]};
}

function displayInitialChapter(){
  displayChapterByIndex(project.activeChapterIndex);
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

function displayPreviousChapter(){
  if(project.activeChapterIndex > 0){
    displayChapterByIndex(project.activeChapterIndex - 1);
    editorQuill.setSelection(0);
    project.textCursorPosition = 0;
  }
}

function displayNextChapter(){
  if(!chapterList.isLastOfAll(project, chapterList.activeLocator(project))){
    displayChapterByIndex(project.activeChapterIndex + 1);
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
  requestProjectTitle(function(title){
    if(title && title != ""){
      project = newProject();
      project.title = title;
      project.author = userSettings.defaultAuthor;
      project.initNotesChap();
      addNewChapter();
      displayProject();
    }
  });
}

function addNewChapter(){
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
  displayChapterByIndex(thisIndex);
  editorQuill.enable();
  changeChapterTitle(thisIndex);
}

function saveProject(onComplete){
  if(project.filename != ""){
    clearCurrentChapterIfUnchanged();
    if(project.saveFile()){
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
  showFileDialog(options, function(filepath){
    if (filepath){
      var savedPath = project.saveAs(filepath);
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
  });
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
  showFileDialog(options, function(filepath){
    if (filepath){
      project.saveAs(filepath, true);
    }

    updateFileList();
    updateTitleBar();
  })
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
  showFileDialog(options, function(filepath){
    if (filepath) {
      var missingChaps = project.loadFile(filepath[0]);
      if(projectFailedToLoad(filepath[0]))
        return;
      if(missingChaps.length > 0){
        const promptForMissingPups = require('./components/views/missing-pups_display');
        promptForMissingPups(project, function(resp){
          displayProject();
        });
      }
      else{
        displayProject();
      }
      userSettings.lastProject = filepath[0];
      userSettings.save();
    }
  });
}



function clearCurrentChapterIfUnchanged(){
  var ch = project.getActiveChapter();
  if(ch && (ch.hasUnsavedChanges == undefined || ch.hasUnsavedChanges == false)){
    ch.contents = null;
    ch.notes = null;
  }
};

editorQuill.on('text-change', function(delta, oldDelta, source) {
  if(source == "user"){
    //Guarded the same way the notes handler below already is: getActiveChapter() is undefined once
    //every chapter has been permanently deleted, and there is nothing to attach this text to.
    var chap = project.getActiveChapter();
    if(chap){
      chap.contents = editorQuill.getContents();
      chap.hasUnsavedChanges = true;
      project.hasUnsavedChanges = true;
    }
  }
});

editorQuill.on('selection-change', function(range, oldRange, source){
  if(range){
    project.textCursorPosition = range.index;
  }
})

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

function moveToTrash(ind){
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
    displayChapterByIndex(next ? chapterList.toCombinedIndex(project, next) : 0);
  }
  else
    updateFileList();
}

function deleteChapter(ind){
  var loc = chapterList.toLocator(project, ind);
  var deletedChap = chapterList.remove(project, loc);

  //Always save project file after deleting a chapter
  //so if user closes without saving it won't expect
  //the deleted chapter at next load...
  deletedChap.deleteFile();

  if(ind == project.activeChapterIndex){
    //Same "stay on whatever slid into the gap, else fall back" rule moveToTrash() uses - this
    //used to check only project.chapters.length, which meant deleting the last trashed chapter
    //blanked the editor even when the project still had reference chapters to show.
    var next = chapterList.selectionAfterRemoval(project, loc);
    if(next)
      displayChapterByIndex(chapterList.toCombinedIndex(project, next));
    else{
      editorQuill.disable();
      editorQuill.setText("");
    }
  }

  //But save it *after* reassigning the activeChapterIndex
  //in case it is the last chapter that was deleted.
  //And only if it is not a new project that has not yet been saved.
  if(project.directory != '')
    project.saveFile();
  updateFileList();
  console.log("deleted " + ind);
}

function verifyToDelete(ind){
  var loc = chapterList.toLocator(project, ind);
  if(loc && loc.list == 'trash'){
    const displayDeleteConfirmation = require('./components/views/delete-confirmation_display');
    displayDeleteConfirmation(function(){
      deleteChapter(ind);
      editorQuill.focus();
    });
  }
}

function restoreFromTrash(ind){
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
    displayChapterByIndex(chapterList.toCombinedIndex(project, landed));
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

function splitChapter(){
  var selection = editorQuill.getSelection(true);
  if(selection){
      var newChap = editorQuill.getContents(selection.index);
      console.log("deleting " + selection.index + " to " + editorQuill.getLength());
      editorQuill.deleteText(selection.index, editorQuill.getLength(), 'user');
      addImportedChapter(newChap, "untitled");
      changeChapterTitle(project.activeChapterIndex);
  }
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

function openHelpDoc(){
  const helpDocPath = sysDirectories.app + "/examples/HelpDoc/HelpDoc.woolf";
  project.loadFile(helpDocPath);
  if(projectFailedToLoad(helpDocPath))
    return;
  displayProject();
}

function exitApp(){
  if(userSettings.autoBackup == true && project.filename != ''){
    alertBackupResult('Loading backup tools...', true);
    const { backupProject, BACKUP_FINISHED } = require('./components/controllers/backup-project');
    backupProject(project, userSettings, sysDirectories.docs, function(update){
      alertBackupResult(update, true);
      if(update == BACKUP_FINISHED)
        ipcRenderer.send('exit-app-confirmed');
    });
  } else {
      ipcRenderer.send('exit-app-confirmed');
  }
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

  showBackupAlert(msg, allowExitWithoutBackup ? function(){
    ipcRenderer.send('exit-app-confirmed');
  } : null);
}

function addImportedChapter(chapDelta, title){
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
  displayChapterByIndex(chapterList.toCombinedIndex(project, landed));
}

function toggleChapterNotes(){
  userSettings.displayChapNotes = !userSettings.displayChapNotes;
  userSettings.save();
  refreshNotesDisplay();
}


function editorHasFocus(){
  return editorIsVisible() && document.querySelector(".ql-editor") === document.activeElement;
}

function editorIsVisible(){
  return document.getElementById('writing-field').classList.contains('visible');
}

//Wires up every keyboard shortcut that is not a menu item - see keybindings.js for the dispatch
//itself. context.project is a getter, not the object directly, because createNewProject() below
//replaces it with a brand new one; capturing it here would leave every shortcut acting on the
//project this app started with rather than whatever project is actually open.
var unregisterKeybindings = registerKeybindings({
  getProject: function(){ return project; },
  userSettings: userSettings,
  editorQuill: editorQuill,
  notesQuill: notesQuill,
  actions: {
    moveChapUp: moveChapUp,
    moveChapDown: moveChapDown,
    changeChapterTitle: changeChapterTitle,
    displayPreviousChapter: displayPreviousChapter,
    displayNextChapter: displayNextChapter,
    togglePanelDisplay: togglePanelDisplay,
    toggleChapterNotes: toggleChapterNotes,
    updatePanelDisplays: updatePanelDisplays,
    increaseFontSizeSetting: increaseFontSizeSetting,
    decreaseFontSizeSetting: decreaseFontSizeSetting,
    increaseEditorWidthSetting: increaseEditorWidthSetting,
    descreaseEditorWidthSetting: descreaseEditorWidthSetting
  }
});

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
    displayExitConfirmation(saveProject, continueFunc);
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
  'save-clicked': { run: function(){ saveProject(); } },
  'save-as-clicked': { run: function(){ saveProjectAs(); } },
  'open-clicked': { run: function(){ proceedOrConfirmSave(openAProject); } },
  'new-project-clicked': { run: function(){ createNewProject(); } },
  'import-clicked': { run: function(){
    const showImportOptions = require('./components/views/import_display');
    showImportOptions(sysDirectories, addImportedChapter, function(){
      displayChapterByIndex(project.activeChapterIndex);
      if(project.chapters.length > 0)
        editorQuill.enable();
    });
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
    showWordCount(project, editorQuill);
  } },
  'find-replace-clicked': { requiresFocus: true, run: function(){
    const showFindReplace = require('./components/views/findreplace_display');
    showFindReplace(project, editorQuill, displayChapterByIndex);
  } },
  'spellcheck-clicked': { requiresFocus: true, run: function(){
    const showSpellcheck = require('./components/views/spellcheck_display');
    const { getBeginningOfCurrentWord } = require('./components/controllers/spellcheck');
    var currentIndex = editorQuill.getSelection(true).index;
    var beginningOfWord = getBeginningOfCurrentWord(editorQuill.getText(), currentIndex);
    showSpellcheck(editorQuill, project, sysDirectories, displayChapterByIndex, beginningOfWord);
  } },
  'convert-first-lines-clicked': { requiresFocus: true, run: function(){
    const showConvertFirstLines = require('./components/views/convert-first-lines_display');
    showConvertFirstLines(project, function(){
      displayChapterByIndex(project.activeChapterIndex);
    });
  } },
  'headings-to-chaps-clicked': { requiresFocus: true, run: function(){
    const showBreakHeadingsOptions = require('./components/views/headings-to-chapters_display');
    showBreakHeadingsOptions(editorQuill, addImportedChapter);
  } },
  'convert-italics-clicked': { requiresFocus: true, run: function(){
    const showItalicsOptions = require('./components/views/convert-italics_display');
    showItalicsOptions(project, function(){
      displayChapterByIndex(project.activeChapterIndex);
    });
  } },
  'split-chapter-clicked': { requiresFocus: true, run: function(){ splitChapter(); } },
  'add-chapter-clicked': { requiresFocus: true, run: function(){ addNewChapter(); } },
  'delete-chapter-clicked': { requiresFocus: true, run: function(){ moveToTrash(project.activeChapterIndex); } },
  'restore-chapter-clicked': { requiresFocus: true, run: function(){ restoreFromTrash(project.activeChapterIndex); } },
  'shortcuts-clicked': { run: function(isMac){
    const showShortcutsHelp = require('./components/views/shortcuts-help_display');
    showShortcutsHelp(isMac);
  } },
  'outliner-clicked': { run: function(){
    const showOutliner = require('./components/views/outliner_display');
    showOutliner(project);
  } },
  'convert-tabs-clicked': { run: function(){
    const showTabOptions = require('./components/views/convert-tabs-display');
    showTabOptions(project, function(){
      displayChapterByIndex(project.activeChapterIndex);
    });
  } },
  'about-clicked': { run: function(appVersion){
    const showAbout = require('./components/views/about_display');
    showAbout(sysDirectories, appVersion);
  } },
  'exit-app-clicked': { run: function(){ proceedOrConfirmSave(exitApp, true); } },
  'save-copy-clicked': { run: function(){ saveProjectCopy(); } },
  'help-doc-clicked': { run: function(){ openHelpDoc(); } },
  'renumber-chapters-clicked': { run: function(){
    const showRenumberChapters = require('./components/views/renumber-chapters_display');
    showRenumberChapters(project, function(){
      updateFileList();
      displayChapterByIndex(project.activeChapterIndex);
    });
  } },
  'send-via-email-clicked': { run: function(){
    const showEmailOptions = require('./components/views/email-doc_display');
    showEmailOptions(project, userSettings, credentialStore, editorQuill);
  } },
  'view-error-log-clicked': { run: function(){
    const showErrorLog = require('./components/views/error-log_display');
    showErrorLog(userSettings, credentialStore);
  } },
  'file-manager-clicked': { run: function(){
    const showFileManager = require('./components/views/file-manager_display');
    showFileManager(sysDirectories, project.directory);
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
    showSettings(userSettings, autosaver, sysDirectories, saveProject, function(){
      setDarkMode();
    });
  } },
  'corkboard-clicked': { run: function(){
    const showCorkboard = require('./components/views/corkboard_display');
    showCorkboard(project);
  } },
  'indent-all-clicked': { run: function(){
    const { indentAllParasInAllChaps } = require('./components/controllers/indent-all');
    indentAllParasInAllChaps(project);
    displayChapterByIndex(project.activeChapterIndex);
  } },
  'center-all-heads-clicked': { run: function(){
    const { centerAllHeadingsInAllChaps } = require('./components/controllers/center-all-heads');
    centerAllHeadingsInAllChaps(project);
    displayChapterByIndex(project.activeChapterIndex);
  } }
};

Object.keys(menuCommands).forEach(function(channel){
  var command = menuCommands[channel];
  ipcRenderer.on(channel, function(e){
    if(command.requiresFocus && !editorHasFocus())
      return;
    command.run.apply(null, Array.prototype.slice.call(arguments, 1));
  });
});

//Takes its own argument (the opened file's path) and has a distinct multi-branch shape - handling
//a chapter missing from disk mirrors openAProject()'s own file-dialog callback - so it is kept as
//an ordinary handler rather than forced into the single-argument shape above.
ipcRenderer.on('file-opened-from-outside-warewoolf', function(event, fPath){
  if (fPath) {
    var missingChaps = project.loadFile(fPath);
    if(projectFailedToLoad(fPath))
      return;
    if(missingChaps.length > 0){
      const promptForMissingPups = require('./components/views/missing-pups_display');
      promptForMissingPups(project, function(resp){
        displayProject();
      });
    }
    else{
      displayProject();
    }
    userSettings.lastProject = fPath;
    userSettings.save();
  }

});

//Every handler above is registered by the time this runs, so it is safe for index.js's close guard
//to hand a window close over to this renderer and wait. Anything at this file's top level throwing
//before here - a damaged project file used to - means the guard never gets this and lets closes
//through itself instead, rather than holding a dead window open.
ipcRenderer.send('renderer-ready');

//Exposed for testing only - nothing in the app itself reads this module's exports, since it's
//loaded as a plain <script> tag rather than required. Limited to the chapter/reference/trash
//list engine, the most bug-prone and highest-value part of this file to unit test directly.
module.exports = {
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
  //Tears down the keyboard listeners this module attaches on load. Nothing in the app itself calls
  //this - there is exactly one of these for the app's whole lifetime - but a test harness that
  //re-requires render.js per test needs it to undo the previous require's listeners, or they pile
  //up on the shared `document` across every test in the file.
  _unregisterKeybindings: unregisterKeybindings
};
