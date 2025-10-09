const { ipcRenderer } = require('electron');
const fs = require('fs');
const Quill = require('quill');
const sysDirectories = ipcRenderer.sendSync('get-directories');
const getUserSettings = require('./components/models/user-settings');
const newChapter = require('./components/models/chapter');
const newProject = require('./components/models/project');
const autosaver = require('./components/controllers/autosave');
const {
  removeElementsByClass,
  createButton,
  disableSearchView
} = require('./components/controllers/utils');
const fileRequestedOnOpen = ipcRenderer.sendSync('get-file-requested-on-open');
const { showBattery } = require('./components/views/battery_display');

var editorQuill = new Quill('#editor-container', {
  modules: {
    history: {
      userOnly: true
    }
  },
  placeholder: '',
  formats: ['bold', 'italic', 'strike', 'underline', 'blockquote', 'header', 'align']
});

var notesQuill = new Quill('#notes-editor', {
  modules: {
    history: {
      userOnly: true
    }
  },
  placeholder: 'Notes...',
  formats: ['bold', 'italic', 'strike', 'underline', 'blockquote', 'header', 'align']
});

var project = newProject();

var userSettings = getUserSettings(sysDirectories.userData + "/user-settings.json").load();

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
    enableTypewriterMode()
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
  var list = document.getElementById("chapter-list");

  clearList();
  generateChapterList();
  generateReferenceList();
  generateTrashList();

  function clearList() {
    while (list.hasChildNodes()) {
      try{
        list.removeChild(list.firstChild);
      }
      catch(err){
        console.log(err);
      }
    }
  }

  function generateChapterList() {
    project.chapters.forEach(function (chap, chapIndex) {
      var listChap = document.createElement("li");
      listChap.innerText = chap.title != '' ? chap.title : '(untitled)';
      listChap.dataset.chapIndex = chapIndex;
      listChap.onclick = function () {
        displayChapterByIndex(this.dataset.chapIndex);
      };
      listChap.ondblclick = function () {
        changeChapterTitle(this.dataset.chapIndex);
      };
      if (chap.hasUnsavedChanges == true)
        listChap.innerHTML += "*";
      list.appendChild(listChap);
      if(chapIndex == project.activeChapterIndex){
        listChap.classList.add("activeChapter");
        document.getElementById('chapter-list-sidebar').scrollTop = listChap.offsetTop;
      }

    });
  }

  function generateReferenceList(){
    var referenceList = document.getElementById('reference-list');
    while(referenceList.hasChildNodes()){
      try{
        referenceList.removeChild(referenceList.firstChild);
      }
      catch(err){
        console.log(err);
      }
    }
    project.reference.forEach(function(chap, chapIndex){
      var listChap = document.createElement("li");
      listChap.innerHTML = chap.title != '' ? chap.title : '(untitled)';
      listChap.dataset.chapIndex = project.chapters.length + chapIndex;
      listChap.onclick = function () {
        displayChapterByIndex(this.dataset.chapIndex);
      };
      listChap.ondblclick = function () {
        changeChapterTitle(this.dataset.chapIndex);
      };
      if (chapIndex + project.chapters.length == project.activeChapterIndex)
        listChap.classList.add("activeChapter");
      if (chap.hasUnsavedChanges == true)
        listChap.innerHTML += "*";
      referenceList.appendChild(listChap);
    });

    var refHeader = document.getElementById('reference-header');
    if(project.reference.length > 0 )
      refHeader.classList.remove('trash-header-empty');
    else
      refHeader.classList.add('trash-header-empty');
  }

  function generateTrashList() {
    var trashList = document.getElementById("trash-list");
    while (trashList.hasChildNodes()) {
      try{
        trashList.removeChild(trashList.firstChild);
      }
      catch(err){
        console.log(err);
      }
    }
    project.trash.forEach(function (chap, chapIndex) {
      var listChap = document.createElement("li");
      listChap.innerHTML = chap.title != '' ? chap.title : '(untitled)';
      listChap.dataset.chapIndex = project.chapters.length + project.reference.length + chapIndex;
      listChap.onclick = function () {
        displayChapterByIndex(this.dataset.chapIndex);
      };
      listChap.ondblclick = function () {
        changeChapterTitle(this.dataset.chapIndex);
      };
      if (chapIndex + project.chapters.length + project.reference.length == project.activeChapterIndex)
        listChap.classList.add("activeChapter");
      if (chap.hasUnsavedChanges == true)
        listChap.innerHTML += "*";
      trashList.appendChild(listChap);
    });

    var trashHeader = document.getElementById('trash-header');
    if(project.trash.length > 0 )
      trashHeader.classList.remove('trash-header-empty');
    else
      trashHeader.classList.add('trash-header-empty');
  }
}

function displayChapterByIndex(ind){
  clearCurrentChapterIfUnchanged();
  ind = parseInt(ind);

  //If trying to go beyond last chapter, stay on last chapter
  if(ind > project.chapters.length + project.reference.length + project.trash.length - 1)
    ind = project.chapters.length + project.reference.length + project.trash.length - 1;

  project.activeChapterIndex = ind;

  var chap;
  if(ind < project.chapters.length){
    chap = project.chapters[ind];
  }
  else if(ind < project.chapters.length + project.reference.length){
    chap = project.reference[ind - project.chapters.length]
  }
  else {
    chap = project.trash[ind - project.reference.length - project.chapters.length];
  }

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
    let savedNotes = project.getActiveChapter().getNotesContentOrFile();
    var currentNotes = savedNotes ? savedNotes : getEmptyDelta();
    notesQuill.setContents(currentNotes);

    notesHeader.innerText = 'Chapter Notes';
  }
  else{
    let savedNotes = project.notesChap.getNotesContentOrFile();
    var currentNotes = savedNotes ? savedNotes : getEmptyDelta();
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
  if(!chapIndexIs(project.activeChapterIndex).lastAll){
    displayChapterByIndex(project.activeChapterIndex + 1);
    editorQuill.setSelection(0);
    project.textCursorPosition = 0;
  }

}

function moveChapUp(chapInd){
  var indexIs = chapIndexIs(chapInd);
  if(indexIs.chapter && !indexIs.firstChapter){
    project.hasUnsavedChanges = true;
    var chap = project.chapters.splice(chapInd, 1)[0];
    project.chapters.splice(chapInd - 1, 0, chap);
    project.activeChapterIndex--;
  }
  else if(indexIs.firstReference){
    project.hasUnsavedChanges = true;
    var refChap = project.reference.splice(chapInd - project.chapters.length, 1)[0];
    project.chapters.splice(project.chapters.length,0,refChap); 
  }
  else if(indexIs.reference && !indexIs.firstReference){
    project.hasUnsavedChanges = true;
    var refChap = project.reference.splice(chapInd - project.chapters.length, 1)[0];
    project.reference.splice(chapInd - project.chapters.length - 1, 0, refChap);
    project.activeChapterIndex--;
  }
  else if(indexIs.trash && !indexIs.firstTrash){
    project.hasUnsavedChanges = true;
    var trashChap = project.trash.splice(chapInd - project.chapters.length - project.reference.length, 1)[0];
    project.trash.splice(chapInd - project.chapters.length - project.reference.length - 1, 0, trashChap);
    project.activeChapterIndex--;
  }

  updateFileList();
}

function moveChapDown(chapInd){
  var indexIs = chapIndexIs(chapInd);

  if(indexIs.chapter && !indexIs.lastChapter){
    project.hasUnsavedChanges = true;
    var chap = project.chapters.splice(chapInd, 1)[0];
    project.chapters.splice(chapInd + 1, 0, chap);
    project.activeChapterIndex++;
  }
  else if(indexIs.lastChapter){
    project.hasUnsavedChanges = true;
    var chap = project.chapters.splice(chapInd, 1)[0];
    project.reference.splice(0,0,chap);
  }
  else if(indexIs.reference && !indexIs.lastReference){
    project.hasUnsavedChanges = true;
    var refChap = project.reference.splice(chapInd - project.chapters.length, 1)[0];
    project.reference.splice(chapInd - project.chapters.length + 1, 0, refChap);
    project.activeChapterIndex++;
  }
  else if(indexIs.trash && !indexIs.lastTrash){
    project.hasUnsavedChanges = true;
    var trashChap = project.trash.splice(chapInd - project.chapters.length - project.reference.length, 1)[0];
    project.trash.splice(chapInd - project.chapters.length - project.reference.length + 1, 0, trashChap);
    project.activeChapterIndex++;
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
      addNewChapter();
      displayProject();
    }
  });
}

function addNewChapter(){
  var currentIndexIs = chapIndexIs(project.activeChapterIndex);
    //If not trash selected
  if(!currentIndexIs.trash){
    var newChap = newChapter();
    newChap.hasUnsavedChanges = true;
    newChap.contents = getEmptyDelta();
    if(currentIndexIs.chapter)
      project.chapters.splice(project.activeChapterIndex + 1, 0, newChap);
    else
      project.reference.splice(project.activeChapterIndex - project.chapters.length + 1, 0, newChap);
    
    project.hasUnsavedChanges = true;
    updateFileList();
    var thisIndex = project.activeChapterIndex + 1;
    displayChapterByIndex(thisIndex);
    editorQuill.enable();
    changeChapterTitle(thisIndex);
  }
}

function saveProject(){
  if(project.filename != ""){
    clearCurrentChapterIfUnchanged();
    project.saveFile();
    project.hasUnsavedChanges = false;
    updateFileList();
  }
  else
    saveProjectAs();
}

function saveProjectAs() {
  const options = {
    title: 'Save project as...',
    defaultPath: sysDirectories.docs,
    filters: [
      { name: 'WareWoolf Projects', extensions: ['woolf'] }
    ],
    bookmarkedPaths: [sysDirectories.docs, sysDirectories.home],
    dialogType: 'save'
  };

  const showFileDialog = require('./components/views/file-dialog_display');
  showFileDialog(options, function(filepath){
    if (filepath){
      filepath = project.saveAs(filepath);
      userSettings.lastProject = filepath;
      userSettings.save();
      project.hasUnsavedChanges = false;
      updateFileList();
      updateTitleBar();
    }
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
    dialogType: 'open'
  };

  const showFileDialog = require('./components/views/file-dialog_display');
  showFileDialog(options, function(filepath){
    if (filepath) {
      var missingChaps = project.loadFile(filepath[0]);
      if(missingChaps.length > 0){
        const promptForMissingPups = require('./components/views/missing-pups_display');
        promptForMissingPups(project, missingChaps);
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

function moveToTrash(ind){
  var chapIs = chapIndexIs(ind);
  if(chapIs.trash == false){
    project.hasUnsavedChanges = true;

    if(chapIs.reference){
      let toTrash = project.reference.splice(ind - project.chapters.length, 1)[0];
      project.trash.push(toTrash);
    }
    else{
      let toTrash = project.chapters.splice(ind, 1)[0];
      project.trash.push(toTrash);
    }
    
    //If deleting currently selected chapter, select next chapter if there is one, or the previous chapter if not.
    if(ind == project.activeChapterIndex){
      //If deleting a chapter and there are chapters left
      if(chapIs.chapter && project.chapters.length > 0){
        var newInd = ind < project.chapters.length || ind == 0 ? ind : ind - 1;
        displayChapterByIndex(newInd);
      }
      else if(chapIs.reference && project.reference.length > 0){
        var newInd = ind < project.chapters.length + project.reference.length || ind - project.chapters.length == 0 ? ind : ind - 1;
        displayChapterByIndex(newInd);
      }
      else if(chapIs.reference && project.reference.length < 1 && project.chapters.length > 0){
        displayChapterByIndex(project.chapters.length - 1);
      }
      else{
        displayChapterByIndex(0)
      }
    }
    else
      updateFileList();
  }
  else {
    verifyToDelete(ind);
  }
}

function deleteChapter(ind){
  var deletedChap = project.trash.splice(ind - project.chapters.length, 1)[0];

  //Always save project file after deleting a chapter
  //so if user closes without saving it won't expect
  //the deleted chapter at next load...
  deletedChap.deleteFile();

  if(ind == project.activeChapterIndex){
    if(project.trash.length > 0){
      var newInd = ind < project.trash.length + project.chapters.length || ind - project.chapters.length == 0 ? ind : ind - 1;
      displayChapterByIndex(newInd);
    }
    else{
      if(project.chapters.length > 0)
        displayChapterByIndex(project.chapters.length - 1);
      else{
        editorQuill.disable();
        editorQuill.setText("");
      }
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
  if(chapIndexIs(ind).trash){
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var warningTitle = document.createElement('h1');
    warningTitle.innerText = 'WARNING:'
    popup.appendChild(warningTitle);

    var message = document.createElement("p");
    message.innerText = "Are you sure you want to delete this file? This is permanent.";
    message.classList.add('warning-text');
    popup.appendChild(message);

    var yesButton = createButton("Yes");
    yesButton.onclick = function(){
      deleteChapter(ind);
      editorQuill.focus();
      popup.remove();
    }
    var noButton = createButton("No");
    noButton.onclick = function(){
      popup.remove();
    }
    popup.appendChild(yesButton);
    popup.appendChild(noButton);
    document.body.appendChild(popup);
    yesButton.focus();
  }
}

function chapIndexIs(ind){
  return {
    chapter: ind < project.chapters.length,
    firstChapter: ind == 0,
    lastChapter: ind == project.chapters.length - 1,
    reference: ind > project.chapters.length - 1 && ind < project.chapters.length + project.reference.length && project.reference.length > 0,
    firstReference: ind == project.chapters.length && project.reference.length > 0,
    lastReference: ind == project.chapters.length + project.reference.length - 1 && project.reference.length > 0,
    trash: ind > project.chapters.length + project.reference.length - 1,
    firstTrash: ind == project.chapters.length + project.reference.length,
    lastTrash: ind == project.chapters.length + project.reference.length + project.trash.length - 1 && project.trash.length > 0,
    lastAll: ind == project.chapters.length + project.reference.length + project.trash.length - 1
  }
}

function restoreFromTrash(ind){
  if(chapIndexIs(ind).trash){
    var fromTrash = project.trash.splice(ind - project.chapters.length - project.reference.length, 1)[0];
    project.chapters.push(fromTrash);
    updateFileList();
  }
}

function changeChapterTitle(ind){
  var chap;
  var chapIs = chapIndexIs(ind);
  if(chapIs.trash)
    chap = project.trash[ind - project.chapters.length - project.reference.length];
  else if(chapIs.reference)
    chap = project.reference[ind - project.chapters.length];
  else
    chap = project.chapters[ind];

  var listName = document.querySelector("[data-chap-index='" + ind + "']");
  removeElementsByClass('name-box');
  var nameBox = document.createElement("input");
  nameBox.type = "text";
  nameBox.classList.add("name-box");
  nameBox.addEventListener("keydown", function(e){
    if(e.key === "Enter" || e.key === "Tab"){
      stopDefaultPropagation(e);
      chap.title = nameBox.value;
      project.hasUnsavedChanges = true;
      chap.hasUnsavedChanges = true;
      removeElementsByClass('name-box');
      updateFileList();
      editorQuill.focus();
    }
    else if (e.key === "Escape"){
      removeElementsByClass('name-box');
      updateFileList();
      editorQuill.focus();
    }
  });

  nameBox.onblur = function(){
      removeElementsByClass('name-box');
      updateFileList();
  }

  listName.firstChild.remove();
  listName.appendChild(nameBox);
  nameBox.focus();

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
  document.getElementById('chapter-list-sidebar')
  .scrollTop = document.querySelector('.activeChapter')
  .offsetTop - (document.getElementById('chapters-header').offsetHeight * 3);
}

function openHelpDoc(){
  const helpDocPath = sysDirectories.app + "/examples/HelpDoc/HelpDoc.woolf";
  project.loadFile(helpDocPath);
  displayProject();
}

function exitApp(){
  if(userSettings.autoBackup == true && project.filename != ''){
    alertBackupResult('Loading backup tools...');
    const { backupProject } = require('./components/controllers/backup-project');
    backupProject(project, userSettings, sysDirectories.docs, function(update){
      alertBackupResult(update);
      if(update == 'Backup finished.')
        ipcRenderer.send('exit-app-confirmed');
    });
  } else {
      ipcRenderer.send('exit-app-confirmed');
  }
}

function alertBackupResult(msg){
  var backupAlert = document.getElementById('backup-alert');
  var backupAlertText = document.getElementById('backup-alert-text');

  if(backupAlert == null){
    backupAlert = document.createElement('div');
    backupAlert.id = 'backup-alert';
    backupAlert.classList.add('popup');
    backupAlert.classList.add('working-popup');
    document.body.appendChild(backupAlert);
    backupAlertText = document.createElement('p');
    backupAlertText.id = 'backup-alert-text';
    backupAlert.appendChild(backupAlertText);
  }

  backupAlertText.innerText = msg;

  if(msg == 'Backup finished.')
    backupAlert.remove();
}

function addImportedChapter(chapDelta, title){
  var newChap = newChapter();
  newChap.hasUnsavedChanges = true;
  newChap.contents = chapDelta;
  newChap.title = title;

  if(chapIndexIs(project.activeChapterIndex).reference){
    project.reference.splice(project.activeChapterIndex - project.chapters.length + 1, 0, newChap);
  }
  else{
    project.chapters.splice(project.activeChapterIndex + 1, 0, newChap);
  }
  
  updateFileList();
  displayChapterByIndex(project.activeChapterIndex + 1);
}

///////////////////////////////////////////////////////////////////
  //Event Handlers ///////////////////////////////////////////////

editorQuill.on('text-change', function(delta, oldDelta, source) {
  if(source == "user"){
    var chap = project.getActiveChapter();
    chap.contents = editorQuill.getContents();
    chap.hasUnsavedChanges = true;
    project.hasUnsavedChanges = true;
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
      var chap = project.getActiveChapter();
      chap.notes = notesQuill.getContents();
      chap.hasUnsavedChanges = true;
    }
    else {
      project.notesChap.notes = notesQuill.getContents();
      project.notesChap.hasUnsavedChanges = true;
    }
    
    project.hasUnsavedChanges = true;
  }
});

function addBindingsToQuill(q){
  q.keyboard.addBinding({
    key: 'T',
    shortKey: true,
    handler: function(range, context) {
      this.quill.format('align', 'center', 'user');
      this.quill.format('header', 1, 'user');
    }
  });

  for(let i = 1; i <= 4; i++){
    q.keyboard.addBinding({
      key: i.toString(),
      shortKey: true,
      handler: function(range, context) {
        this.quill.format('header', i, 'user');
      }
    });
  }

  q.keyboard.addBinding({
    key: 'L',
    shortKey: true,
    handler: function(range, context) {
      this.quill.format('align', null, 'user');
    }
  });

  q.keyboard.addBinding({
    key: 'E',
    shortKey: true,
    handler: function(range, context) {
      this.quill.format('align', 'center', 'user');
    }
  });

  q.keyboard.addBinding({
    key: 'R',
    shortKey: true,
    handler: function(range, context) {
      this.quill.format('align', 'right', 'user');
    }
  });

  q.keyboard.addBinding({
    key: 'J',
    shortKey: true,
    handler: function(range, context) {
      this.quill.format('align', 'justify', 'user');
    }
  });

  q.keyboard.addBinding({
    key: '0',
    shortKey: true,
    handler: function(range, context){
      this.quill.format('header', null, 'user');
    }
  });

  q.keyboard.addBinding({
    key: 'k',
    shortKey: true,
    handler: function(range, context){
      if(q.getFormat().strike)
        q.format('strike', false, 'user');
      else {
        q.format('strike', true, 'user');
      }
    }
  });

};


document.addEventListener ("keydown", function (e) {
    if((e.ctrlKey || e.metaKey) && e.key === "ArrowLeft"){
      stopDefaultPropagation(e);
      if(document.getElementById('writing-field').classList.contains('visible')){
        removeElementsByClass('popup');
        disableSearchView();
        editorQuill.focus();
      }
    }
    else if((e.ctrlKey || e.metaKey) && e.key === "ArrowRight"){
      stopDefaultPropagation(e);
      if(document.getElementById('project-notes').classList.contains('visible')){
        removeElementsByClass('popup');
        disableSearchView();
        notesQuill.focus();
      }
    }
    else if(e.key === "Escape"){
      removeElementsByClass('popup');
      removeElementsByClass('popup-dialog');
      disableSearchView();
      updatePanelDisplays();
    }
    else if((e.ctrlKey || e.metaKey) && e.key === "="){
      increaseFontSizeSetting();
    }
    else if((e.ctrlKey || e.metaKey) && e.key === "-"){
      decreaseFontSizeSetting();
    }
    else if((e.ctrlKey || e.metaKey) && e.altKey && e.key === "t"){
      if(userSettings.typewriterMode){
        disableTypewriterMode(editorQuill);
        userSettings.typewriterMode = false;
        userSettings.save();
      }
      else {
        enableTypewriterMode(editorQuill);
        userSettings.typewriterMode = true;
        userSettings.save();
      }
    }
    else if((e.ctrlKey || e.metaKey) && e.key === "m"){
      ipcRenderer.send('show-menu');
    }
    else if(e.key === 'F1'){
      stopDefaultPropagation(e);
      togglePanelDisplay(1);
    }
    else if(!e.ctrlKey && e.key === "F2"){
      stopDefaultPropagation(e);
      togglePanelDisplay(2);
    }
    else if((e.ctrlKey || e.metaKey) && e.key === "F3"){
      stopDefaultPropagation(e);
      toggleChapterNotes();
    }
    else if(e.key ==="F3"){
      stopDefaultPropagation(e);
      togglePanelDisplay(3);
    }
} );

function toggleChapterNotes(){
  userSettings.displayChapNotes = !userSettings.displayChapNotes;
  userSettings.save();
  refreshNotesDisplay();
}

document.getElementById('editor-container').addEventListener('keydown', editorControlEvents);
document.getElementById('chapter-list-sidebar').addEventListener('keydown', editorControlEvents);
document.getElementById('notes-editor').addEventListener('keydown', editorControlEvents);

function editorControlEvents(e){
  if ((e.ctrlKey || e.metaKey)  && e.shiftKey && e.key === "ArrowUp") {
    stopDefaultPropagation(e);
    moveChapUp(project.activeChapterIndex);
  }
  else if((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "ArrowDown"){
    stopDefaultPropagation(e);
    moveChapDown(project.activeChapterIndex);
  }
  else if((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "ArrowLeft"){
    stopDefaultPropagation(e);
    if(document.getElementById('chapter-list-sidebar').classList.contains('visible'))
      changeChapterTitle(project.activeChapterIndex);
  }
  else if((e.ctrlKey || e.metaKey) && e.key === "ArrowUp"){
    stopDefaultPropagation(e);
    displayPreviousChapter();
    if(e.currentTarget.id == 'notes-editor')
      notesQuill.focus();
  }
  else if((e.ctrlKey || e.metaKey) && e.key === "ArrowDown"){
    stopDefaultPropagation(e);
    displayNextChapter();
    if(e.currentTarget.id == 'notes-editor')
      notesQuill.focus();
  }
  else if((e.ctrlKey || e.metaKey) && e.key === ","){
    descreaseEditorWidthSetting();
  }
  else if((e.ctrlKey || e.metaKey) && e.key === "."){
    increaseEditorWidthSetting();
  }
  else if(e.key === "PageDown"){
    stopDefaultPropagation(e);
    if(e.currentTarget.id == 'notes-editor')
      goPageDown(notesQuill)
    else
      goPageDown(editorQuill);
  }
}

function goPageDown(quillObj){
  var selectedRange = quillObj.getSelection();

  if(selectedRange){
    var startingScrolltop = 0 + quillObj.root.scrollTop;
    var destinationY = quillObj.root.clientHeight;
    var textIndex = selectedRange.index + 1;

    var found = false;
    
    while(!found){
      var bounds = quillObj.selection.getBounds(textIndex, 1);

      if(bounds.y >= destinationY){
        found = true;
        quillObj.setSelection(textIndex);
        quillObj.root.scrollTop = startingScrolltop + bounds.y - bounds.height;
      }
      else if(bounds == undefined || bounds.y == undefined){
        found = true;
        quillObj.setSelection(textIndex - 1);
      }
      textIndex += 1;
    }
  }
}

function stopDefaultPropagation(keyEvent){
  keyEvent.preventDefault();
  keyEvent.stopPropagation();
}

ipcRenderer.on("save-clicked", function(e){
  saveProject();
});

ipcRenderer.on("save-as-clicked", function(e){
  saveProjectAs();
});

ipcRenderer.on("open-clicked", function(e){
  const displayExitConfirmation = require('./components/views/exit-confirmation_display');
  if(project.hasUnsavedChanges){
    displayExitConfirmation(saveProject, openAProject);
  }
  else{
    openAProject();
  }
});

ipcRenderer.on('new-project-clicked', function(e){
  createNewProject();
});

ipcRenderer.on('import-clicked', function(e){
  const showImportOptions = require('./components/views/import_display');
  showImportOptions(sysDirectories, addImportedChapter, function(){
    displayChapterByIndex(project.activeChapterIndex);
    if(project.chapters.length > 0)
      editorQuill.enable();
  });
});

ipcRenderer.on('export-clicked', function(e){
  const showExportOptions = require('./components/views/export_display');
  showExportOptions(project, userSettings, sysDirectories);
});

ipcRenderer.on('properties-clicked', function(e){
  const showProperties = require('./components/views/properties_display');
  showProperties(project, userSettings);
});

ipcRenderer.on('compile-clicked', function(e){
  const showCompileOptions = require('./components/views/compile_display');
  showCompileOptions(project, sysDirectories, userSettings);
});

ipcRenderer.on('word-count-clicked', function(e){
  const showWordCount = require('./components/views/wordcount_display');
  showWordCount(project, editorQuill);
});

ipcRenderer.on('find-replace-clicked', function(e){
  if(editorHasFocus()){
    const showFindReplace = require('./components/views/findreplace_display');
    showFindReplace(project, editorQuill, displayChapterByIndex);
  }
});

ipcRenderer.on('spellcheck-clicked', function(e){
  if(editorHasFocus()){
    const showSpellcheck = require('./components/views/spellcheck_display');
    const { getBeginningOfCurrentWord } = require('./components/controllers/spellcheck');
    var currentIndex = editorQuill.getSelection(true).index;
    var beginningOfWord = getBeginningOfCurrentWord(editorQuill.getText(), currentIndex);
    showSpellcheck(editorQuill, project, sysDirectories, displayChapterByIndex, beginningOfWord);
  }
});

ipcRenderer.on('convert-first-lines-clicked', function(e){
  const showConvertFirstLines = require('./components/views/convert-first-lines_display');
  if(editorHasFocus()){
    showConvertFirstLines(project, function(){
        displayChapterByIndex(project.activeChapterIndex);
    });
  }
});

ipcRenderer.on('headings-to-chaps-clicked', function(e){
  if(editorHasFocus()){
    const showBreakHeadingsOptions = require('./components/views/headings-to-chapters_display');
    showBreakHeadingsOptions(editorQuill, addImportedChapter);
  }
    
});

ipcRenderer.on('convert-italics-clicked', function(e){
  if(editorHasFocus()){
    const showItalicsOptions = require('./components/views/convert-italics_display');
    showItalicsOptions(project, function(){
      displayChapterByIndex(project.activeChapterIndex);
    });
  }
});

ipcRenderer.on('split-chapter-clicked', function(e){
  if(editorHasFocus())
    splitChapter();
});

ipcRenderer.on('add-chapter-clicked', function(e){
  if(editorHasFocus())
    addNewChapter();
});

ipcRenderer.on('delete-chapter-clicked', function(e){
  if(editorHasFocus())
    moveToTrash(project.activeChapterIndex);
});

ipcRenderer.on('restore-chapter-clicked', function(e){
  if(editorHasFocus())
    restoreFromTrash(project.activeChapterIndex);
});

ipcRenderer.on('shortcuts-clicked', function(e, isMac){
  const showShortcutsHelp = require('./components/views/shortcuts-help_display');
  showShortcutsHelp(isMac);
});

ipcRenderer.on('outliner-clicked', function(e){
  const showOutliner = require('./components/views/outliner_display');
  showOutliner(project);
});

ipcRenderer.on('convert-tabs-clicked', function(e){
  const showTabOptions = require('./components/views/convert-tabs-display');
  showTabOptions(project, function(){
    displayChapterByIndex(project.activeChapterIndex);
  });
});

ipcRenderer.on('about-clicked', function(e, appVersion){
  const showAbout = require('./components/views/about_display');
  showAbout(sysDirectories, appVersion);
});

ipcRenderer.on('exit-app-clicked', function(e){
  if(project.hasUnsavedChanges){
    const displayExitConfirmation = require('./components/views/exit-confirmation_display');
    updateFileList();
    displayExitConfirmation(saveProject, exitApp);
  }
  else{
    exitApp();
  }
});

ipcRenderer.on('save-copy-clicked', function(e){
  saveProjectCopy();
});

ipcRenderer.on('help-doc-clicked', function(e){
  openHelpDoc();
});

ipcRenderer.on('renumber-chapters-clicked', function(e){
  const showRenumberChapters = require('./components/views/renumber-chapters_display');
  showRenumberChapters(project, function(){
    updateFileList();
    displayChapterByIndex(project.activeChapterIndex);
  });
});

ipcRenderer.on('send-via-email-clicked', function(e){
  const showEmailOptions = require('./components/views/email-doc_display');
  showEmailOptions(project, userSettings, editorQuill);
});

ipcRenderer.on('view-error-log-clicked', function(e){
  const showErrorLog = require('./components/views/error-log_display');
  showErrorLog(userSettings);
});

ipcRenderer.on('file-manager-clicked', function(e){
  const showFileManager = require('./components/views/file-manager_display');
  showFileManager(sysDirectories, project.directory);
});

ipcRenderer.on('wifi-manager-clicked', function(e){
  const showWifiManager = require('./components/views/wifi-manager_display');
  showWifiManager();
});

ipcRenderer.on('save-backup-clicked', function(e){
  const { backupProject } = require('./components/controllers/backup-project');
  backupProject(project, userSettings, sysDirectories.docs, alertBackupResult);
});

ipcRenderer.on('settings-clicked', function(e){
  const showSettings = require('./components/views/settings_display');
  showSettings(userSettings, autosaver, sysDirectories, function(){
    setDarkMode();
  });
});

ipcRenderer.on('corkboard-clicked', function(e){
  const showCorkboard = require('./components/views/corkboard_display');
  showCorkboard(project);
});

ipcRenderer.on('file-opened-from-outside-warewoolf', function(event, fPath){
  if (fPath) {
    var missingChaps = project.loadFile(fPath);
    if(missingChaps.length > 0){
      const promptForMissingPups = require('./components/views/missing-pups_display');
      promptForMissingPups(project, missingChaps);
    }
    else{
      displayProject();
    }
    userSettings.lastProject = fPath;
    userSettings.save();
  }

});

//**** utils ***/


function editorHasFocus(){
  return editorIsVisible() && document.querySelector(".ql-editor") === document.activeElement;
}

function editorIsVisible(){
  return document.getElementById('writing-field').classList.contains('visible');
}