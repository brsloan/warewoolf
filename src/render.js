const { ipcRenderer } = require('electron');
const fs = require('fs');
const { dialog } = require('electron').remote;
const Quill = require('quill');
const quillToWord = require('quill-to-word');


  var editorQuill = new Quill('#editor-container', {
    modules: {
      toolbar: [
        [{ header: [1, 2, false] }],
        ['italic'],
        [{ 'align': [] }]
      ],
      history: {
        userOnly: true
      }
    },
    placeholder: '',
    theme: 'snow'  // or 'bubble'
  });

  var notesQuill = new Quill('#notes-editor', {
    modules: {
      toolbar: [
        [{ header: [1, 2, false] }],
        ['bold', 'italic', 'underline']
      ],
      history: {
        userOnly: true
      }
    },
    placeholder: 'Notes...',
    theme: 'bubble'  // or 'bubble'
  });

 var project = newProject();

  initialize();

  function initialize(){
    setProject(convertFilepath(__dirname) + "/examples/Frankenstein/Frankenstein.woolf");
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

  function createNewProject(){
    project = newProject();
    requestProjectTitle(function(title){
      project.title = title;
      addNewChapter();
      displayProject();
    });
  }


  function requestProjectTitle(callback){
    var popup = document.createElement("div");
    popup.classList.add("popup");
    var titleForm = document.createElement("form");
    var message = document.createElement("label");
    message.innerText = "What is the title of this project?";
    message.for = "title-input";
    titleForm.appendChild(message);
    var titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.placeholder = "Mrs. Dalloway 2: Back In Action";
    titleInput.id = "title-input";
    titleForm.appendChild(titleInput);
    var createButton = document.createElement("input");
    createButton.type = "submit";
    createButton.value = "Create"
    titleForm.onsubmit = function(){
      var title;
      if(titleInput.value != "")
        title = titleInput.value;
      else
        title = "New Project";
      popup.remove();
      callback(title);
    }

    titleForm.appendChild(createButton);
    popup.appendChild(titleForm);
    document.body.appendChild(popup);
    titleInput.focus();
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
        if (chapIndex == project.activeChapterIndex)
          listChap.classList.add("activeChapter");
        if (chap.hasUnsavedChanges == true)
          listChap.innerHTML += "*";
        list.appendChild(listChap);
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

  function changeChapterTitle(ind){
    var chap;
    if(indexIsTrash(ind))
      chap = project.trash[ind - project.chapters.length];
    else
      chap = project.chapters[ind];

    var listName = document.querySelector("[data-chap-index='" + ind + "']");
    var nameBox = document.createElement("input");
    nameBox.type = "text";
    nameBox.classList.add("name-box");
    nameBox.addEventListener("keydown", function(e){
      if(e.key === "Enter" || e.key === "Tab"){
        stopDefaultPropagation(e);
        chap.title = nameBox.value;
        chap.hasUnsavedChanges = true;
        nameBox.remove();
        updateFileList();
        editorQuill.focus();
      }
      else if (e.key === "Escape"){
        nameBox.remove();
        updateFileList();
        editorQuill.focus();
      }
    });

    //TODO: Cannot for the life of me figure out how to make the goddam thing
    //disappaer on blur without introducing errors when the updateFileList
    //clears the old nodes before creating the new ones so fuck it
    /*
    var blur = false;
    nameBox.onblur = function(){
      if(!blur){
        blur = true;
        //nameBox.remove();
        nameBox.style.display = "none";
        updateFileList();
      }


      //editorQuill.focus();
    }; */

    listName.firstChild.remove();
    listName.appendChild(nameBox);
    nameBox.focus();

  }

  function displayPreviousChapter(){
    if(project.activeChapterIndex > 0)
      displayChapterByIndex(project.activeChapterIndex - 1);
  }

  function displayNextChapter(){
    if(project.activeChapterIndex < project.chapters.length - 1 + project.trash.length)
      displayChapterByIndex(project.activeChapterIndex + 1);
  }

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

  function clearCurrentChapterIfUnchanged(){
    var ch = project.getActiveChapter();
    if(ch && (ch.hasUnsavedChanges == undefined || ch.hasUnsavedChanges == false)){
      ch.contents = null;
    }
  };

  //Event Handlers

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

  document.addEventListener ("keydown", function (e) {
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
      else if(e.ctrlKey && e.key === "ArrowLeft"){
        stopDefaultPropagation(e);
        editorQuill.focus();
      }
      else if(e.ctrlKey && e.key === "ArrowRight"){
        stopDefaultPropagation(e);
        notesQuill.focus();
      }
      else if(e.key === "Escape"){
        removeElementsByClass('popup');
      }
  } );

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
    showSpellcheck();
  });

  ipcRenderer.on('convert-first-lines-clicked', function(e){
    convertFirstLinesToTitles();
    displayChapterByIndex(project.activeChapterIndex);
  });

  ipcRenderer.on('headings-to-chaps-clicked', function(e){
    showBreakHeadingsOptions();
  });

  ipcRenderer.on('convert-italics-clicked', function(e){
    showItalicsOptions();
  });

  ipcRenderer.on('split-chapter-clicked', function(e){
    splitChapter();
  });

  ipcRenderer.on('add-chapter-clicked', function(e){
    addNewChapter();
  });

  ipcRenderer.on('delete-chapter-clicked', function(e){
    moveToTrash(project.activeChapterIndex);
  });

  ipcRenderer.on('restore-chapter-clicked', function(e){
    restoreFromTrash(project.activeChapterIndex);
  });

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


function convertFirstLinesToTitles(){
  var tempQuill = getTempQuill();

  project.chapters.forEach(function(chap){
    var chapContents = chap.contents ? chap.contents : chap.getFile();
    tempQuill.setContents(chapContents);
    tempQuill.formatLine(1, 1, 'header', 1);
    tempQuill.formatLine(1, 1, 'align', 'center');
    chap.contents = tempQuill.getContents();
    chap.hasUnsavedChanges = true;
  });

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
  }
}



//**** utils ***/

function removeElementsByClass(className){
  var elements = document.getElementsByClassName(className);
  while(elements.length > 0){
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

function getTempQuill(){
  return new Quill(document.createElement('div'), {
      modules: {
          history: {
              userOnly: true
          }
      }
      });
}

function createButton(text){
  var btn = document.createElement("input");
  btn.type = "button";
  btn.value = text;
  return btn;
}
