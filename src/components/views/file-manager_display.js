const { closePopups, createButton, removeElementsByClass } = require('../controllers/utils');
const { unzipProject } = require('../controllers/backup-project');
const { createNewDirectory, renameFiles, moveFiles, getFileList, deleteFile, getParentDirectory } = require('../controllers/file-manager');

function showFileManager(sysDir, projDir){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var currentDirDisplay = document.createElement("p");
    currentDirDisplay.innerText = sysDir.docs;
    popup.appendChild(currentDirDisplay);

    var selectFieldsContainer = document.createElement("div");
    selectFieldsContainer.classList.add("file-select-container");
    popup.appendChild(selectFieldsContainer);

    var dirShortcutSelect = document.createElement("select");
    dirShortcutSelect.classList.add("file-dir-shortcuts");
    dirShortcutSelect.size = 20;
    selectFieldsContainer.appendChild(dirShortcutSelect);
    dirShortcutSelect.addEventListener('keydown', function(e){
        if(e.key === "Enter"){
            populateFMFileList(dirShortcutSelect.value, fileListSelect, currentDirDisplay);
        }
        else if(e.key === "ArrowRight"){
            fileListSelect.focus();
        }
    });

    var fileListSelect = document.createElement("select");
    fileListSelect.multiple = true;
    fileListSelect.classList.add("file-manager-list");
    selectFieldsContainer.appendChild(fileListSelect);

    popup.appendChild(document.createElement('br'));

    var newDirInputPanel = document.createElement('div');
    newDirInputPanel.style.display = "none";

    var newDirNameInLabel = document.createElement('label');
    newDirNameInLabel.innerText = "Name:";
    newDirInputPanel.appendChild(newDirNameInLabel);

    var newDirNameInput = document.createElement('input');
    newDirNameInput.type = "text";
    newDirNameInput.addEventListener("keydown", function(e){
      if(e.key === 'Enter'){
        stopDefaultPropagation(e);
        console.log("entered: " + newDirNameInput.value);

        createNewDirectory(newDirNameInput.value, currentDirDisplay.innerText);
        populateFMFileList(currentDirDisplay.innerText, fileListSelect, currentDirDisplay);

        newDirNameInput.value = "";
        newDirInputPanel.style.display = "none";
        fileListSelect.focus();
      }
      else if(e.key === "Escape"){
        stopDefaultPropagation(e);
        newDirNameInput.value = "";
        newDirInputPanel.style.display = "none";
        fileListSelect.focus();
      }
    });
    newDirInputPanel.appendChild(newDirNameInput);

    popup.appendChild(newDirInputPanel);

    var deleteVerifyPanel = document.createElement('div');
    deleteVerifyPanel.style.display = "none";

    var verifyMessage = document.createElement('p');
    verifyMessage.innerText = "Are you sure you want to permanently delete these files? This cannot be undone.";
    deleteVerifyPanel.appendChild(verifyMessage);

    var verifyDeleteList = document.createElement('ul');
    deleteVerifyPanel.appendChild(verifyDeleteList);

    var verifyDeleteBtn = createButton("Permanently Delete");
    verifyDeleteBtn.onclick = function(){
      var selectedFiles = Array.from(fileListSelect.selectedOptions).map(({ value }) => value);
      selectedFiles.forEach((item, i) => {
        if(item != "uplevel")
          deleteFile(currentDirDisplay.innerText + "/" + item);
      });

      populateFMFileList(currentDirDisplay.innerText, fileListSelect, currentDirDisplay);
      deleteVerifyPanel.style.display = "none";
      fileListSelect.focus();
    };
    deleteVerifyPanel.appendChild(verifyDeleteBtn);

    var cancelDeleteBtn = createButton("Cancel");
    cancelDeleteBtn.onclick = function(){
      deleteVerifyPanel.style.display = "none";
      fileListSelect.focus();
    };
    deleteVerifyPanel.appendChild(cancelDeleteBtn);

    popup.appendChild(deleteVerifyPanel);

    var renamePanel = document.createElement('div');
    renamePanel.style.display = "none";

    var renameLabel = document.createElement('label');
    renameLabel.innerText = "New Name:";
    renamePanel.appendChild(renameLabel);

    var renameInput = document.createElement('input');
    renameInput.type = "text";
    renameInput.addEventListener("keydown", function(e){
      if(e.key === "Enter"){
        var selectedFiles = Array.from(fileListSelect.selectedOptions).map(({ value }) => value);

        renameFiles(selectedFiles, renameInput.value, currentDirDisplay.innerText);

        populateFMFileList(currentDirDisplay.innerText, fileListSelect, currentDirDisplay);

        renamePanel.style.display = "none";
        fileListSelect.focus();
      }
    });

    renamePanel.appendChild(renameInput);

    popup.appendChild(renamePanel);

    var newFolderBtn = createButton("New <span class='access-key'>F</span>older");
    newFolderBtn.accessKey = "f";
    newFolderBtn.onclick = function(){
      deleteVerifyPanel.style.display = "none";
      renamePanel.style.display = "none";
      newDirInputPanel.style.display = "block";
      newDirNameInput.focus();
    }
    popup.appendChild(newFolderBtn);

    var renameBtn = createButton("<span class='access-key'>R</span>ename");
    renameBtn.accessKey = "r";
    renameBtn.onclick = function(){
      newDirInputPanel.style.display = "none";
      deleteVerifyPanel.style.display = "none";
      renamePanel.style.display = "block";
      renameInput.value = fileListSelect.selectedOptions[0].value;
      renameInput.focus();
    };
    popup.appendChild(renameBtn);

    var deleteBtn = createButton("<span class='access-key'>D</span>elete");
    deleteBtn.accessKey = "d";
    deleteBtn.onclick = function(){
      newDirInputPanel.style.display = "none";
      renamePanel.style.display = "none";

      verifyDeleteList.innerHTML = "";
      var selectedFiles = Array.from(fileListSelect.selectedOptions).map(({ value }) => value);
      if(selectedFiles.includes('uplevel')){
        selectedFiles.splice(selectedFiles.indexOf('uplevel'), 1);
      }

      if(selectedFiles.length > 0){
        selectedFiles.forEach((item, i) => {
          if(item != "uplevel"){
            var listItem = document.createElement('li');
            listItem.innerText = item;
            verifyDeleteList.appendChild(listItem);
          }
        });
        deleteVerifyPanel.style.display = "block";
        verifyDeleteBtn.focus();
      }
    };
    popup.appendChild(deleteBtn);

    var unzipBtn = createButton("<span class='access-key'>U</span>nzip");
    unzipBtn.accessKey = "u";
    unzipBtn.onclick = function(){
      unzipProject(currentDirDisplay.innerText + '/' + fileListSelect.selectedOptions[0].value, function(){
          populateFMFileList(currentDirDisplay.innerText, fileListSelect, currentDirDisplay);
      });
    };
    popup.appendChild(unzipBtn);

    var close = createButton("Close");
    close.onclick = function(){
        closePopups();
    };
    popup.appendChild(close);

    var filesToBeCut = [];
    var filesToBeCopied = [];

    fileListSelect.addEventListener('keydown', function(e){
        if(e.key === "Enter"){
            var selectedFiletype = fileListSelect.options[fileListSelect.selectedIndex].dataset.filetype;
            if (selectedFiletype == "dir"){
                populateFMFileList(currentDirDisplay.innerText + "/" + fileListSelect.value, fileListSelect, currentDirDisplay);
            }
            else if(fileListSelect.value == "uplevel"){
                populateFMFileList(getParentDirectory(currentDirDisplay.innerText), fileListSelect, currentDirDisplay);
            }
        }
        else if(e.key === "ArrowLeft"){
            dirShortcutSelect.focus();
        }
        else if(e.key === "Delete"){
          stopDefaultPropagation(e);
          deleteBtn.click();
        }
        else if(e.ctrlKey && e.key === "d"){
          stopDefaultPropagation(e);
          deleteBtn.click();
        }
        else if(e.ctrlKey && e.key === "x"){
          stopDefaultPropagation(e);
          filesToBeCut = [];
          filesToBeCopied = [];

          var selectedOps = fileListSelect.selectedOptions;
          for(i=0;i<selectedOps.length;i++){
            if(selectedOps[i].value != "uplevel"){
              selectedOps[i].classList.add('to-be-cut');
              filesToBeCut.push(currentDirDisplay.innerText + "/" + selectedOps[i].value);
            }
          }

        }
        else if(e.ctrlKey && e.key ==="c"){
          stopDefaultPropagation(e);
          if(filesToBeCut.length > 0){
            filesToBeCut = [];
            var allOps = fileListSelect.options;
            for(i=0;i<allOps.length;i++){
              allOps[i].classList.remove('to-be-cut');
            }
          }

          filesToBeCopied = [];

          var selectedOps = fileListSelect.selectedOptions;
          for(i=0;i<selectedOps.length;i++){
            if(selectedOps[i].value != "uplevel"){
              filesToBeCopied.push(currentDirDisplay.innerText + "/" + selectedOps[i].value);
            }
          }
        }
        else if(e.ctrlKey && e.key === "v"){
          stopDefaultPropagation(e);
          if(filesToBeCut.length > 0){
            moveFiles(filesToBeCut, currentDirDisplay.innerText);
            filesToBeCut = [];

            populateFMFileList(currentDirDisplay.innerText, fileListSelect, currentDirDisplay);
          }
          else if(filesToBeCopied.length > 0){
            copyFiles(filesToBeCopied, currentDirDisplay.innerText);
            filesToBeCopied = [];

            populateFMFileList(currentDirDisplay.innerText, fileListSelect, currentDirDisplay);
          }
        }
    });

    populateFMShortcutsList(projDir, sysDir, dirShortcutSelect);
    populateFMFileList(sysDir.docs, fileListSelect, currentDirDisplay);

    document.body.appendChild(popup);
    fileListSelect.focus();
}

function populateFMShortcutsList(projDir, sysDir, listElement){
    var shortcuts = [];
    if (sysDir.docs != null && sysDir.docs != "")
        shortcuts.push(sysDir.docs);

    if(sysDir.home != sysDir.docs)
        shortcuts.push(sysDir.home);

    var cleanedProjDir = projDir;
    if(projDir.endsWith("/"))
        cleanedProjDir = projDir.slice(0,-1);

    if(cleanedProjDir != "" && shortcuts.includes(cleanedProjDir) == false)
        shortcuts.push(cleanedProjDir);

    for(i=0;i<shortcuts.length;i++){
        var shortcut = document.createElement("option");
        shortcut.value = shortcuts[i];
        shortcut.innerText = "> " + shortcuts[i].split("/").pop();
        listElement.appendChild(shortcut);
    }
}

function populateFMFileList(directoryPath, listElement, currentDirDisplay){
    currentDirDisplay.innerText = directoryPath;

    listElement.innerHTML = "";

    var files = getFileList(directoryPath);
    files.sort(function(a,b){
        return b.isDirectory() - a.isDirectory();
    });

    var parentDir = document.createElement("option");
    parentDir.value = "uplevel";
    parentDir.innerText = "< Parent Directory";
    listElement.appendChild(parentDir);


    for(i=0;i<files.length;i++){
        var filename = document.createElement("option");
        filename.value = files[i].name;
        filename.innerText = (files[i].isDirectory() ? "> " : "") + files[i].name;
        filename.dataset.filetype = files[i].isDirectory() ? "dir" : "file";

        listElement.appendChild(filename);
    }

    parentDir.selected = true;
}

module.exports = showFileManager;