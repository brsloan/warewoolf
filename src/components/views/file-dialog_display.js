const { closePopupDialogs, createButton } = require('../../render');


function showFileDialog(options, callback){
    var popup = document.createElement("div");
    popup.classList.add("popup-dialog");

    var dialogTitle = document.createElement('h3');
    dialogTitle.innerText = options.title;
    popup.appendChild(dialogTitle);

    var currentDirDisplay = document.createElement("p");
    currentDirDisplay.innerText = options.defaultPath;
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
            populateFileList(dirShortcutSelect.value, fileListSelect, currentDirDisplay, options.filters[filterSelect.value]);
        }
        else if(e.key === "ArrowRight"){
            fileListSelect.focus();
        }
    });

    var fileListSelect = document.createElement("select");
    fileListSelect.multiple = true;
    fileListSelect.classList.add("file-manager-list");
    selectFieldsContainer.appendChild(fileListSelect);

    var filenameIn = document.createElement('input');
    filenameIn.classList.add('save-input');

    if(options.dialogType == 'save'){
      //Only append filenameInput if in save mode
      filenameIn.type = 'text';
      filenameIn.value = "." + options.filters[0].extensions[0];
      popup.appendChild(filenameIn);

      fileListSelect.onchange = function(){
        if(fileListSelect.selectedOptions[0].dataset.filetype == 'file')
          filenameIn.value = fileListSelect.value;
      };

      filenameIn.addEventListener('keydown', function(e){
        if(e.key === 'Enter'){
          stopDefaultPropagation(e);
          closePopupDialogs();
          callback(currentDirDisplay.innerText + '/' + filenameIn.value);
        }
      });

      popup.appendChild(document.createElement('br'));
    }

    var filterSelect = getFilterSelect(options.filters);
    filterSelect.onchange = function(){
      populateFileList(currentDirDisplay.innerText, fileListSelect, currentDirDisplay, options.filters[filterSelect.value])
    }
    filterSelect.classList.add('save-input');
    popup.appendChild(filterSelect);

    popup.appendChild(document.createElement('br'));

    if(options.dialogType == 'open'){
      var openBtn = createButton('Open');
      openBtn.onclick = function(){
        openSelectedFile();
      }
      popup.appendChild(openBtn);
    }
    else if(options.dialogType == 'save'){
      var saveBtn = createButton('Save');
      saveBtn.onclick = function(){
        saveSelectedFile();
      }
      popup.appendChild(saveBtn);
    }
    else if(options.dialogType == 'chooseDirectory'){
      console.log('in choose dir');
      var chooseBtn = createButton('Choose Displayed Directory');
      chooseBtn.onclick = function(){
        openSelectedDir();
      }
      popup.appendChild(chooseBtn);
    }

    var close = createButton("Close");
    close.onclick = function(){
        closePopupDialogs();
    };
    popup.appendChild(close);

    var filesToBeCut = [];
    var filesToBeCopied = [];

    fileListSelect.addEventListener('keydown', function(e){
        if(e.key === "Enter"){
          e.preventDefault();
            var selectedFiletype = fileListSelect.options[fileListSelect.selectedIndex].dataset.filetype;
            if (selectedFiletype == "dir"){
                populateFileList(currentDirDisplay.innerText + "/" + fileListSelect.value, fileListSelect, currentDirDisplay, options.filters[filterSelect.value]);
            }
            else if(fileListSelect.value == "uplevel"){
                populateFileList(getParentDirectory(currentDirDisplay.innerText), fileListSelect, currentDirDisplay, options.filters[filterSelect.value]);
            }
            else if(selectedFiletype = 'file'){
              if(options.dialogType == 'open')
                openSelectedFile();
              else if(options.dialogType == 'save')
                saveSelectedFile();
              else if(options.dialogType == 'chooseDirectory')
                openSelectedDir();
            }
        }
        else if(e.key === "ArrowLeft"){
            dirShortcutSelect.focus();
        }
    });

    populateShortcutsList(options.bookmarkedPaths, dirShortcutSelect);
    populateFileList(options.defaultPath, fileListSelect, currentDirDisplay, options.filters[filterSelect.value]);

    document.body.appendChild(popup);
    if(options.dialogType !== 'save')
      fileListSelect.focus();
    else {
      filenameIn.focus();
      filenameIn.setSelectionRange(0,0);
    }

    function saveSelectedFile(){
      closePopupDialogs();
      var checkedFilename = checkFilenameForExtension(filenameIn.value, options.filters[filterSelect.value]);
      console.log('Inputted filename ' + filenameIn.value + ' converted to ' + checkedFilename);
      callback(currentDirDisplay.innerText + '/' + checkedFilename);
    }

    function openSelectedFile(){
      closePopupDialogs();
      callback(collectionToArray(fileListSelect.selectedOptions, currentDirDisplay.innerText + '/'));
    }

    function openSelectedDir(){
      closePopupDialogs();
      callback(currentDirDisplay.innerText);
    }
}

function checkFilenameForExtension(filename, filter){
  var checkedFilename = '';
  console.log('checker running, input is: ' + filename);

  if(filename.includes('.') == false){
    console.log(filename + 'does not have a period, so add extension...');
    checkedFilename = filename + '.' + filter.extensions[0];
  }
  else {
    console.log(filename + 'DOES have a period, so split it...');
    var fnameParts = filename.split('.');
    console.log(fnameParts);
    if(filter.extensions.includes(fnameParts[fnameParts.length - 1]) == false){
      fnameParts.pop();
      checkedFilename = fnameParts.join() + '.' + filter.extensions[0];
    }
    else {
      checkedFilename = filename;
    }
  }

  return checkedFilename;
}

function populateShortcutsList(shortcuts, listElement){
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

function populateFileList(directoryPath, listElement, currentDirDisplay, filter = null){
    currentDirDisplay.innerText = directoryPath;

    listElement.innerHTML = "";

    var files = getFileList(directoryPath);

    files.sort(function(a,b){
        return b.isDirectory() - a.isDirectory();
    });

    if(filter){
      files = files.filter(function(file, index, arr){
        var match = file.isDirectory();
        if(match == false){
          var fileExt = getFileExtension(file.name);
          var counter = 0;
          while(match == false && counter < filter.extensions.length){
            if(fileExt == filter.extensions[counter])
              match = true;
            counter++;
          }
        }
        return match;
      });
    }

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

function getFilterSelect(filters){
  var filterSelect = document.createElement('select');

  if(filters == null || filters.length == 0){
    var filterOp = document.createElement('option');
    filterOp.value = -1;
    filterOp.innerText = 'All Files (*.*)';
    filterSelect.appendChild(filterOp);
  }
  else {
    for(i=0;i<filters.length;i++){
      var filterOp = document.createElement('option');
      filterOp.value = i;
      filterOp.innerText = filters[i].name + ' (*.' + filters[i].extensions.join(', *.') + ')';
      filterSelect.appendChild(filterOp);
    }
  }

  return filterSelect;
};

function getFileExtension(fname){
  var segs = fname.split('.');
  return segs[segs.length - 1];
}

function collectionToArray(coll, pre = ''){
  var arr = [];
  for(i=0;i<coll.length;i++){
    arr.push(pre + coll[i].value)
  }
  return arr;
}

module.exports = showFileDialog;