const { ipcRenderer } = require('electron');
const fs = require('fs');
//const { remote } = require('electron');
//const {Menu, MenuItem} = remote;
//var menu = Menu.getApplicationMenu();
const { dialog } = require('electron').remote;

  var editorQuill = new Quill('#editor-container', {
    modules: {
      toolbar: [
        [{ header: [1, 2, false] }],
        ['italic'],
        [{ 'align': [] }]
      ]
    },
    placeholder: '',
    theme: 'snow'  // or 'bubble'
  });
  
  var notesQuill = new Quill('#notes-editor', {
    modules: {
      toolbar: [
        [{ header: [1, 2, false] }],
        ['bold', 'italic', 'underline']
      ]
    },
    placeholder: 'Notes...',
    theme: 'bubble'  // or 'bubble'
  });
  
 var project = newProject();
  
  initialize();
  
  function initialize(){
    project.loadFile("mobyDickProject.woolf");
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
    document.title = "Warewoolf: " + project.title;
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
      var yesButton = document.createElement("input");
      yesButton.type = "button";
      yesButton.value = "Yes"
      yesButton.onclick = function(){
        deleteChapter(ind);
        popup.remove();
      }
      var noButton = document.createElement("input");
      noButton.type = "button";
      noButton.value = "No";
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
  
  function saveChangedChapters(){
    project.chapters.forEach(function(chap, ind){
      if(chap.hasUnsavedChanges){
        chap.saveFile();
        chap.hasUnsavedChanges = false;
        if(ind != project.activeChapterIndex){
          chap.contents = null;
        }
      }
    });
    project.trash.forEach(function(chap, ind){
      if(chap.hasUnsavedChanges){
        chap.saveFile();
        chap.hasUnsavedChanges = false;
        //TODO: handle active index stuff for trash items
        chap.contents = null;
      }
    });
    updateFileList();
  }

  
  function saveProject(){
    //MUST save chapters before project, as new chapters have their filenames generated when saved
    saveChangedChapters();
    clearCurrentChapterIfUnchanged();
    project.saveFile();
    
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
      else if(e.ctrlKey && e.key === "ArrowUp"){
        stopDefaultPropagation(e);
        displayPreviousChapter();
      }
      else if(e.ctrlKey && e.key === "ArrowDown"){
        stopDefaultPropagation(e);
        displayNextChapter();
      }
     // else if(e.ctrlKey && e.key === "s"){
     //   stopDefaultPropagation(e);
     //   saveProject();
    //  }
      else if(e.ctrlKey && e.key === "n"){
        stopDefaultPropagation(e);
        addNewChapter();
      }
      else if(e.ctrlKey && e.key === "d"){
        stopDefaultPropagation(e);
        moveToTrash(project.activeChapterIndex);
      }
      else if(e.ctrlKey && e.key === "r"){
        stopDefaultPropagation(e);
        restoreFromTrash(project.activeChapterIndex);
      }
      else if(e.ctrlKey && e.key === "ArrowLeft"){
        stopDefaultPropagation(e);
        changeChapterTitle(project.activeChapterIndex);
      }
      else if(e.ctrlKey && e.key === "ArrowRight"){
        stopDefaultPropagation(e);
        notesQuill.focus();
      }
  } );
  
  function stopDefaultPropagation(keyEvent){
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
  }
  
  ipcRenderer.on("save-clicked", function(e){
    saveProject();
  });

  ipcRenderer.on("save-as-clicked", function(e){
    const options = {
      title: 'Save project as...',
      defaultPath: '/' + project.filename.split(".")[0],
      filters: [
        { name: 'WareWoolf Projects', extensions: ['woolf'] }
      ]
    }
    var filepath = dialog.showSaveDialogSync(options);
    project.saveAs(filepath);

  });