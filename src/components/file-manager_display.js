function showFileManager(dirPaths){
    dirPaths.docsDir = convertFilepath(dirPaths.docsDir);
    dirPaths.homeDir = convertFilepath(dirPaths.homeDir);

    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var currentDirDisplay = document.createElement("p");
    currentDirDisplay.innerText = dirPaths.docsDir;
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
            populateFileList(dirShortcutSelect.value, fileListSelect, currentDirDisplay);
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
        populateFileList(currentDirDisplay.innerText, fileListSelect, currentDirDisplay);

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

      populateFileList(currentDirDisplay.innerText, fileListSelect, currentDirDisplay);
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

    var newFolderBtn = createButton("New <span class='access-key'>F</span>older");
    newFolderBtn.accessKey = "f";
    newFolderBtn.onclick = function(){
      newDirInputPanel.style.display = "block";
      newDirNameInput.focus();
    }
    popup.appendChild(newFolderBtn);

    var rename = createButton("Rename");
    popup.appendChild(rename);

    var deleteBtn = createButton("<span class='access-key'>D</span>elete");
    deleteBtn.accessKey = "d";
    deleteBtn.onclick = function(){
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

    var close = createButton("Close");
    close.onclick = function(){
        closePopups();
    };
    popup.appendChild(close);

    var filesToBeCut = [];

    fileListSelect.addEventListener('keydown', function(e){
        if(e.key === "Enter"){
            var selectedFiletype = fileListSelect.options[fileListSelect.selectedIndex].dataset.filetype;
            if (selectedFiletype == "dir"){
                populateFileList(currentDirDisplay.innerText + "/" + fileListSelect.value, fileListSelect, currentDirDisplay);
            }
            else if(fileListSelect.value == "uplevel"){
                populateFileList(getParentDirectory(currentDirDisplay.innerText), fileListSelect, currentDirDisplay);
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

          var selectedOps = fileListSelect.selectedOptions;
          for(i=0;i<selectedOps.length;i++){
            if(selectedOps[i].value != "uplevel"){
              selectedOps[i].classList.add('to-be-cut');
              filesToBeCut.push(currentDirDisplay.innerText + "/" + selectedOps[i].value);
            }
          }

        }
        else if(e.ctrlKey && e.key === "v"){
          if(filesToBeCut.length > 0){
            moveFiles(filesToBeCut, currentDirDisplay.innerText);
            filesToBeCut = [];

            populateFileList(currentDirDisplay.innerText, fileListSelect, currentDirDisplay);
          }
        }
    });

    populateShortcutsList(dirPaths, dirShortcutSelect);
    populateFileList(dirPaths.docsDir, fileListSelect, currentDirDisplay);

    document.body.appendChild(popup);
    fileListSelect.focus();
}

function moveFiles(filesToMove, newLocation){
  console.log(filesToMove);

  try{
    filesToMove.forEach((ftm, i) => {
      var newFileLoc = newLocation + "/" + ftm.split('/').pop();
      console.log("move from " + ftm + " to " + newFileLoc);

      fs.renameSync(ftm, newFileLoc);
    });
  }
  catch(err){
    logError(err);
  }
}

function createNewDirectory(dirName, dirLoc){
  try{
    if(fs.existsSync(dirLoc + "/" + dirName) == false)
      fs.mkdirSync(dirLoc + "/" + dirName);
  }
  catch(err){
    logError(err);
  }
}

function deleteFile(fpth){
  try {
    if(fs.existsSync(fpth))
      fs.rmSync(fpth, { recursive: true, force: true });
  }
  catch(err){
    logError(err);
  }
}

function getParentDirectory(filepath){
    var cutIndex = filepath.lastIndexOf('/');
    return cutIndex > -1 ? filepath.slice(0,cutIndex) : filepath;
}

function populateShortcutsList(dirPaths, listElement){
    var shortcuts = [];
    if (dirPaths.docsDir != null && dirPaths.docsDir != "")
        shortcuts.push(dirPaths.docsDir);

    if(dirPaths.homeDir != dirPaths.docsDir)
        shortcuts.push(dirPaths.homeDir);

    var cleanedProjDir = project.directory;
    if(project.directory.endsWith("/"))
        cleanedProjDir = project.directory.slice(0,-1);

    if(cleanedProjDir != "" && shortcuts.includes(cleanedProjDir) == false)
        shortcuts.push(cleanedProjDir);

    for(i=0;i<shortcuts.length;i++){
        var shortcut = document.createElement("option");
        shortcut.value = shortcuts[i];
        shortcut.innerText = "> " + shortcuts[i].split("/").pop();
        listElement.appendChild(shortcut);
    }
}

function populateFileList(directoryPath, listElement, currentDirDisplay){
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

function getFileList(dirPath){
    try {
        return fs.readdirSync(dirPath, {withFileTypes: true});
    } catch (err) {
        logErrror(err);
    }
}
