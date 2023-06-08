function showFileManager(docPath){
    docPath = convertFilepath(docPath);
    
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var currentDirDisplay = document.createElement("p");
    currentDirDisplay.innerText = docPath;
    popup.appendChild(currentDirDisplay);

    var selectFieldsContainer = document.createElement("div");
    selectFieldsContainer.classList.add("file-select-container");
    popup.appendChild(selectFieldsContainer);

    var dirShortcutList = document.createElement("select");
    dirShortcutList.classList.add("file-dir-shortcuts");
    dirShortcutList.size = 20;
    selectFieldsContainer.appendChild(dirShortcutList);

    var fileListSelect = document.createElement("select");
    fileListSelect.multiple = true;
    fileListSelect.classList.add("file-manager-list");
    selectFieldsContainer.appendChild(fileListSelect);
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
    });

    popup.appendChild(document.createElement('br'));

    var newFolder = createButton("New Folder");
    popup.appendChild(newFolder);

    var rename = createButton("Rename");
    popup.appendChild(rename);

    var deleteBtn = createButton("Delete");
    popup.appendChild(deleteBtn);

    var close = createButton("Close");
    close.onclick = function(){
        closePopups();
    };
    popup.appendChild(close);

    populateShortcutsList(dirShortcutList);
    populateFileList(docPath, fileListSelect, currentDirDisplay);

    document.body.appendChild(popup);
    fileListSelect.focus();
}

function getParentDirectory(filepath){
    var cutIndex = filepath.lastIndexOf('/');
    return cutIndex > -1 ? filepath.slice(0,cutIndex) : filepath;
}

function populateShortcutsList(listElement){
    var shortcuts = getShortcutsFake();
    for(i=0;i<shortcuts.length;i++){
        var shortcut = document.createElement("option");
        shortcut.value = shortcuts[i];
        shortcut.innerText = "> " + shortcuts[i].split("/").pop();
        listElement.appendChild(shortcut);
    }
}

function getShortcutsFake(){
    return [
        "/usr/name",
        "/usr/name/documents",
        "usr/media/thumbdrive1",
        "usr/media/thumbdrive2"
    ]
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