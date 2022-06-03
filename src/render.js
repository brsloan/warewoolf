const { ipcRenderer } = require('electron');
const fs = require('fs');
const remote = require('@electron/remote');
const { dialog } = remote;
const Quill = require('quill');
const docx = require('docx');
const quillParser = require('quilljs-parser');

var editorQuill = new Quill('#editor-container', {
  modules: {
    history: {
      userOnly: true
    }
  },
  placeholder: ''
});

var notesQuill = new Quill('#notes-editor', {
  modules: {
    history: {
      userOnly: true
    }
  },
  placeholder: 'Notes...'
});

var project = newProject();
var userSettings = getUserSettings().load();

initialize();

function initialize(){
  setUpQuills();
  //Load last project opened, or if none logged, load example project
  var initialProject = userSettings.lastProject ? userSettings.lastProject : convertFilepath(__dirname) + "/examples/Frankenstein/Frankenstein.woolf";
  setProject(initialProject);
  applyUserSettings();
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
  updateDistractionFree();
}

function updateFontSize(){
  document.documentElement.style.setProperty('--main-font-size', userSettings.fontSize + 'pt');
  document.documentElement.style.setProperty('--dialog-font-size', (userSettings.fontSize + 2) + 'pt');
}

function updateEditorWidth(){
  document.documentElement.style.setProperty('--editor-width', userSettings.editorWidth + '%');
  document.documentElement.style.setProperty('--sidebar-width', ((100 - userSettings.editorWidth) / 2) + "%");
}

function setProject(filepath){
  if(filepath && filepath != null){
    project.loadFile(filepath);
  }

  displayProject();
}

function displayProject(){
  updateFileList();
  updateTitleBar();
  displayNotes();
  displayInitialChapter();
  editorQuill.focus();
}

function updateFileList(){
  var list = document.getElementById("chapter-list");

  clearList();
  generateChapterList();
  generateTrashList();

  function clearList() {
    while (list.hasChildNodes()) {
      list.removeChild(list.firstChild);
    }
  }

  function generateChapterList() {
    project.chapters.forEach(function (chap, chapIndex) {
      var listChap = document.createElement("li");
      listChap.innerHTML = chap.title;
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

  function generateTrashList() {
    var trashList = document.getElementById("trash-list");
    while (trashList.hasChildNodes()) {
      trashList.removeChild(trashList.firstChild);
    }
    project.trash.forEach(function (chap, chapIndex) {
      var listChap = document.createElement("li");
      listChap.innerHTML = chap.title;
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
  project.activeChapterIndex = ind;

  var chap;
  if(ind < project.chapters.length){
    chap = project.chapters[ind];
  }
  else {
    chap = project.trash[ind - project.chapters.length];
  }

  var contents;
  if(chap.contents != undefined && chap.contents != null){
    contents = chap.contents;
  }
  else{
     contents = chap.getFile();
  }

  editorQuill.setContents(contents);
  updateFileList();
}

function updateTitleBar(){
  document.title = "Warewoolf - " + (project.filename != "" ? project.filename : "unsaved project");
}

function displayNotes(){
  notesQuill.setContents(project.notes);
}

function displayInitialChapter(){
  displayChapterByIndex(project.activeChapterIndex);
}


//User Actions

function displayPreviousChapter(){
  if(project.activeChapterIndex > 0)
    displayChapterByIndex(project.activeChapterIndex - 1);
}

function displayNextChapter(){
  if(project.activeChapterIndex < project.chapters.length - 1 + project.trash.length)
    displayChapterByIndex(project.activeChapterIndex + 1);
}

function moveChapUp(chapInd){
  if(chapInd > 0 && chapInd < project.chapters.length){
    var chap = project.chapters.splice(chapInd, 1)[0];
    project.chapters.splice(chapInd - 1, 0, chap);
    project.activeChapterIndex--;
  }
  else if(chapInd > project.chapters.length){
    var trashChap = project.trash.splice(chapInd - project.chapters.length, 1)[0];
    project.trash.splice(chapInd - project.chapters.length - 1, 0, trashChap);
    project.activeChapterIndex--;
  }
  updateFileList();
}

function moveChapDown(chapInd){
  if(chapInd < project.chapters.length - 1){
    var chap = project.chapters.splice(chapInd, 1)[0];
    project.chapters.splice(chapInd + 1, 0, chap);
    project.activeChapterIndex++;
  }
  else if(chapInd > project.chapters.length - 1 && chapInd < project.chapters.length + project.trash.length - 1){
    var trashChap = project.trash.splice(chapInd - project.chapters.length, 1)[0];
    project.trash.splice(chapInd - project.chapters.length + 1, 0, trashChap);
    project.activeChapterIndex++;
  }
  updateFileList();
}


function createNewProject(){
  project = newProject();
  requestProjectTitle(function(title){
    project.title = title;
    addNewChapter();
    displayProject();
  });
}

function addNewChapter(){
  var newChap = newChapter();
  newChap.hasUnsavedChanges = true;
  newChap.contents = {"ops":[{"insert":"\n"}]};
  project.chapters.splice(project.activeChapterIndex + 1, 0, newChap);
  updateFileList();
  var thisIndex = project.chapters.indexOf(newChap);
  displayChapterByIndex(thisIndex);
  editorQuill.enable();
  changeChapterTitle(thisIndex);
}

function saveProject(docPath){
  if(project.filename != ""){
    clearCurrentChapterIfUnchanged();
    project.saveFile();
    updateFileList();
  }
  else
    saveProjectAs(docPath);
}

function saveProjectAs(docPath) {
  const options = {
    title: 'Save project as...',
    defaultPath: docPath,
    filters: [
      { name: 'WareWoolf Projects', extensions: ['woolf'] }
    ]
  };
  var filepath = dialog.showSaveDialogSync(options);
  if (filepath)
    project.saveAs(filepath);
  updateFileList();
  updateTitleBar();
}

function openAProject(docPath) {
  //Temp override doc path for testing in examples folder
  docPath = "./examples";

  const options = {
    title: 'Open project...',
    defaultPath: docPath,
    filters: [
      { name: 'WareWoolf Projects', extensions: ['woolf'] }
    ]
  };
  var filepath = dialog.showOpenDialogSync(options);
  if (filepath) {
    project.loadFile(filepath[0]);
    displayProject();
    userSettings.lastProject = filepath[0];
    userSettings.save();
  }
}

function clearCurrentChapterIfUnchanged(){
  var ch = project.getActiveChapter();
  if(ch && (ch.hasUnsavedChanges == undefined || ch.hasUnsavedChanges == false)){
    ch.contents = null;
  }
};

function moveToTrash(ind){
  if(indexIsTrash(ind) == false){
    var toTrash = project.chapters.splice(ind, 1)[0];
    project.trash.push(toTrash);

    if(ind == project.activeChapterIndex){
      if(project.chapters.length > 0){
        var newInd = ind < project.chapters.length || ind == 0 ? ind : ind - 1;
        displayChapterByIndex(newInd);
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
  //in case it is the last chapter that was deleted
  project.saveFile();
  updateFileList();
  console.log("deleted " + ind);
}

function verifyToDelete(ind){
  if(indexIsTrash(ind)){
    var popup = document.createElement("div");
    popup.classList.add("popup");
    var message = document.createElement("p");
    message.innerHTML = "Are you sure you want to delete this file? This is permanent.";
    popup.appendChild(message);
    var yesButton = createButton("Yes");
    yesButton.onclick = function(){
      deleteChapter(ind);
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

function indexIsTrash(ind){
  return ind > project.chapters.length - 1;
}

function restoreFromTrash(ind){
  if(indexIsTrash(ind)){
    var fromTrash = project.trash.splice(ind - project.chapters.length, 1)[0];
    project.chapters.push(fromTrash);
    updateFileList();
  }
}


function changeChapterTitle(ind){
  var chap;
  if(indexIsTrash(ind))
    chap = project.trash[ind - project.chapters.length];
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


function enableSearchView(){
  document.getElementById("chapter-list-sidebar").classList.add("sidebar-search-view");
  document.getElementById("project-notes").classList.add("sidebar-search-view");
  document.getElementById("writing-field").classList.add("writing-field-search-view");
}

function disableSearchView(){
  document.getElementById("chapter-list-sidebar").classList.remove("sidebar-search-view");
  document.getElementById("project-notes").classList.remove("sidebar-search-view");
  document.getElementById("writing-field").classList.remove("writing-field-search-view");
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

function toggleDistractionFree(){
  userSettings.distractionFreeMode = !userSettings.distractionFreeMode;
  updateDistractionFree();
  userSettings.save();
}

function updateDistractionFree(){
  if(userSettings.distractionFreeMode)
    enableDistractionFree();
  else {
    disableDistractionFree();
  }
}

function enableDistractionFree(){
  var sidebars = document.getElementsByClassName('sidebar');
  for(let i = 0;i < sidebars.length; i++){
    sidebars[i].classList.add('sidebar-distraction-free');
  }
  document.getElementById('writing-field').classList.add('writing-field-distraction-free');
}

function disableDistractionFree(){
  var sidebars = document.getElementsByClassName('sidebar');
  for(let i = 0;i < sidebars.length; i++){
    sidebars[i].classList.remove('sidebar-distraction-free');
  }
  document.getElementById('writing-field').classList.remove('writing-field-distraction-free');
}

function scrollChapterListToActiveChapter(){
  document.getElementById('chapter-list-sidebar')
  .scrollTop = document.querySelector('.activeChapter')
  .offsetTop;
}

///////////////////////////////////////////////////////////////////
  //Event Handlers ///////////////////////////////////////////////

editorQuill.on('text-change', function(delta, oldDelta, source) {
  if(source == "user"){
    var chap = project.getActiveChapter();
    chap.contents = editorQuill.getContents();
    chap.hasUnsavedChanges = true;
  }
});

notesQuill.on('text-change', function(delta, oldDelta, source){
  project.notes = notesQuill.getContents();
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
    if(e.ctrlKey && e.key === "ArrowLeft"){
      stopDefaultPropagation(e);
      removeElementsByClass('popup');
      disableSearchView();
      editorQuill.focus();
    }
    else if(e.ctrlKey && e.key === "ArrowRight"){
      stopDefaultPropagation(e);
      removeElementsByClass('popup');
      disableSearchView();
      notesQuill.focus();
    }
    else if(e.key === "Escape"){
      removeElementsByClass('popup');
      disableSearchView();
      editorQuill.focus();
    }
    else if(e.ctrlKey && e.key === "="){
      increaseFontSizeSetting();
    }
    else if(e.ctrlKey && e.key === "-"){
      decreaseFontSizeSetting();
    }
    else if(e.ctrlKey && e.altKey && e.key === "t"){
      if(userSettings.typewriterMode){
        disableTypewriterMode();
        userSettings.typewriterMode = false;
        userSettings.save();
      }
      else {
        enableTypewriterMode();
        userSettings.typewriterMode = true;
        userSettings.save();
      }

    }
    else if(e.key === 'F11'){
      toggleDistractionFree();
    }
} );

document.getElementById('editor-container').addEventListener('keydown', function(e){
  if (e.ctrlKey  && e.shiftKey && e.key === "ArrowUp") {
    stopDefaultPropagation(e);
    moveChapUp(project.activeChapterIndex);
  }
  else if(e.ctrlKey && e.shiftKey && e.key === "ArrowDown"){
    stopDefaultPropagation(e);
    moveChapDown(project.activeChapterIndex);
  }
  else if(e.ctrlKey && e.shiftKey && e.key === "ArrowLeft"){
    stopDefaultPropagation(e);
    changeChapterTitle(project.activeChapterIndex);
  }
  else if(e.ctrlKey && e.key === "ArrowUp"){
    stopDefaultPropagation(e);
    displayPreviousChapter();
  }
  else if(e.ctrlKey && e.key === "ArrowDown"){
    stopDefaultPropagation(e);
    displayNextChapter();
  }
  else if(e.ctrlKey && e.key === ","){
    descreaseEditorWidthSetting();
  }
  else if(e.ctrlKey && e.key === "."){
    increaseEditorWidthSetting();
  }
});

function stopDefaultPropagation(keyEvent){
  keyEvent.preventDefault();
  keyEvent.stopPropagation();
}

ipcRenderer.on("save-clicked", function(e, docPath){
  saveProject(docPath);
});

ipcRenderer.on("save-as-clicked", function(e, docPath){
  saveProjectAs(docPath);
});

ipcRenderer.on("open-clicked", function(e, docPath){
  openAProject(docPath);
});

ipcRenderer.on('new-project-clicked', function(e){
  createNewProject();
});

ipcRenderer.on('import-clicked', function(e, docPath){
  showImportOptions(docPath);
});

ipcRenderer.on('export-clicked', function(e, docPath){
  showExportOptions(docPath);
});

ipcRenderer.on('properties-clicked', function(e){
  showProperties();
});

ipcRenderer.on('compile-clicked', function(e){
  showCompileOptions();
});

ipcRenderer.on('word-count-clicked', function(e){
  showWordCount();
});

ipcRenderer.on('find-replace-clicked', function(e){
  showFindReplace();
});

ipcRenderer.on('spellcheck-clicked', function(e){
  showSpellcheck(editorQuill.getSelection(true).index);
});

ipcRenderer.on('convert-first-lines-clicked', function(e){
  if(editorHasFocus()){
    convertFirstLinesToTitles();
    displayChapterByIndex(project.activeChapterIndex);
  }
});

ipcRenderer.on('headings-to-chaps-clicked', function(e){
  if(editorHasFocus())
    showBreakHeadingsOptions();
});

ipcRenderer.on('convert-italics-clicked', function(e){
  if(editorHasFocus())
    showItalicsOptions();
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

ipcRenderer.on('shortcuts-clicked', function(e){
  showShortcutsHelp();
});

ipcRenderer.on('outliner-clicked', function(e){
  showOutliner();
});

ipcRenderer.on('convert-tabs-clicked', function(e){
  showTabOptions();
});

//**** utils ***/

function closePopups(){
  removeElementsByClass('popup');
  disableSearchView();
  editorQuill.focus();
}

function removeElementsByClass(className){
  var elements = document.getElementsByClassName(className);
  while(elements.length > 0){
      elements[0].onblur = null;
      elements[0].parentNode.removeChild(elements[0]);
  }
}

function convertFilepath(fpath){
  //Convert Windows filepaths to maintain linux/windows compatibility
  try{
    var converted = fpath.replaceAll('\\', '/');
  }
  catch(err){
    console.log(err);
  }

  return converted;
}

function createButton(text){
  var btn = document.createElement("button");
  btn.innerHTML = text;
  btn.type = "button";
  return btn;
}

function editorHasFocus(){
  return document.querySelector(".ql-editor") === document.activeElement;
}
