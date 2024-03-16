const { closePopups, createButton, removeElementsByClass, generateRow } = require('../controllers/utils');

function showProperties(project, userSettings){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var popupTitle = document.createElement('h1');
    popupTitle.innerText = 'Project Properties';
    popup.appendChild(popupTitle);

    var propForm = document.createElement("form");

    var propTable = document.createElement("table");

    var titleLabel = document.createElement("label");
    titleLabel.innerText = "Title: ";
    titleLabel.for = "title-input";

    var titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.value = project.title;
    titleInput.id = "title-input";

    propTable.appendChild(generateRow(titleLabel, titleInput));

    var authorLabel = document.createElement("label");
    authorLabel.innerText = "Author: ";
    authorLabel.for = "author-input";

    var authorInput = document.createElement("input");
    authorInput.type = "text";
    authorInput.value = project.author;
    authorInput.id = "author-input";

    propTable.appendChild(generateRow(authorLabel, authorInput));

    propForm.appendChild(propTable);

    var apply = document.createElement("input");
    apply.type = "submit";
    apply.value = "Apply";
    propForm.onsubmit = function(e){
      e.preventDefault();
      project.title = titleInput.value;
      project.author = authorInput.value;
      closePopups();
    }
    propForm.appendChild(apply);
    var cancel = createButton("Cancel");
    cancel.onclick = function(){
      closePopups();
    };
    propForm.appendChild(cancel);

    popup.appendChild(propForm);

    popup.appendChild(document.createElement('br'));

    var fileSet = document.createElement('fieldset');
    var fileLeg = document.createElement('legend');
    fileLeg.innerText = 'File Properties';
    fileSet.appendChild(fileLeg);

    var filenameLabel = document.createElement('p');
    filenameLabel.innerText = "Filename:";
    fileSet.appendChild(filenameLabel);

    var filename = document.createElement('p');
    filename.innerText = project.filename;
    filename.classList.add('popup-text-small');
    fileSet.appendChild(filename);

    var directoryLabel = document.createElement('p');
    directoryLabel.innerText = "Directory:";
    fileSet.appendChild(directoryLabel);

    var directory = document.createElement('p');
    directory.innerText = project.directory;
    directory.classList.add('popup-text-small');
    fileSet.appendChild(directory);

    var advancedBtn = createButton("-- Reveal Advanced --");
    fileSet.appendChild(advancedBtn);

    var advancedArea = document.createElement('div');
    advancedArea.style.display = "none";

    advancedBtn.onclick = function(){
      advancedArea.style.display = "block";
    };

    var pupDirLabel = document.createElement('p');
    pupDirLabel.innerText = "Chapters Directory:";
    advancedArea.appendChild(pupDirLabel);

    var pupDirWarning = document.createElement('p');
    pupDirWarning.innerText = "(DO NOT CHANGE THIS UNLESS YOU KNOW WHAT YOU ARE DOING. This is the relative filepath that tells your project file where to find the individual .pup files that are its chapters.)";
    pupDirWarning.classList.add('popup-text-small');
    advancedArea.appendChild(pupDirWarning);

    var pupDirInput = document.createElement('input');
    pupDirInput.type = "text";
    pupDirInput.value = project.chapsDirectory;
    advancedArea.appendChild(pupDirInput);

    var pupDirSubmit = createButton("Save Changes To Chaps Directory");
    pupDirSubmit.onclick = function(){
      if(!pupDirInput.value.endsWith('/')){
        pupDirInput.value += "/";
      }
      project.chapsDirectory = pupDirInput.value;
      project.saveFile();
    };
    advancedArea.appendChild(pupDirSubmit);

    var settingsFilepathLabel = document.createElement('p');
    settingsFilepathLabel.innerText = "User Settings Filepath:";
    advancedArea.appendChild(settingsFilepathLabel);

    var settingsFilepathText = document.createElement('p');
    settingsFilepathText.innerText = userSettings.getSettingsFilepath();
    settingsFilepathText.classList.add('popup-text-small');
    advancedArea.appendChild(settingsFilepathText);

    fileSet.appendChild(advancedArea);
    popup.appendChild(fileSet);
    document.body.appendChild(popup);
    titleInput.focus();
  }

  module.exports = showProperties;