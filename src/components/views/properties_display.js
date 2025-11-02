const { closePopups, createButton, removeElementsByClass, generateRow } = require('../controllers/utils');

function showProperties(project, userSettings){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    const makeSecondColumnFillWidth = true;

    var popupTitle = document.createElement('h1');
    popupTitle.innerText = 'Project Properties';
    popup.appendChild(popupTitle);

    var propForm = document.createElement("form");

    var propTable = document.createElement("table");
    propTable.id = 'properties-table';

    var titleLabel = document.createElement("label");
    titleLabel.innerText = "Title: ";
    titleLabel.for = "title-input";

    var titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.value = project.title;
    titleInput.id = "title-input";

    propTable.appendChild(generateRow(titleLabel, titleInput, makeSecondColumnFillWidth));

    var creditLabel = document.createElement("label");
    creditLabel.innerText = "Credit: ";
    creditLabel.for = "credit-input";
    var creditInput = document.createElement("input");
    creditInput.type = "text";
    creditInput.value = project.credit;
    creditInput.id = "credit-input";
    
    if(project.screenplay){
      propTable.appendChild(generateRow(creditLabel, creditInput, makeSecondColumnFillWidth));
    }

    var authorLabel = document.createElement("label");
    authorLabel.innerText = "Author: ";
    authorLabel.for = "author-input";

    var authorInput = document.createElement("input");
    authorInput.type = "text";
    authorInput.value = project.author;
    authorInput.id = "author-input";

    propTable.appendChild(generateRow(authorLabel, authorInput, makeSecondColumnFillWidth));
    

    var sourceLabel = document.createElement("label");
    sourceLabel.innerText = "Source: ";
    sourceLabel.for = "source-input";
    var sourceInput = document.createElement("input");
    sourceInput.type = "text";
    sourceInput.value = project.source;
    sourceInput.id = "source-input";

    var draftDateLabel = document.createElement("label");
    draftDateLabel.innerText = "Draft Date: ";
    draftDateLabel.for = "draftDate-input";
    var draftDateInput = document.createElement("input");
    draftDateInput.type = "text";
    draftDateInput.value = project.draftDate;
    draftDateInput.id = "draftDate-input";

    var contactLabel = document.createElement("label");
    contactLabel.innerText = "Contact: ";
    contactLabel.for = "contact-input";
    var contactInput = document.createElement("textarea");
    contactInput.value = project.contact;
    contactInput.id = "contact-input";
    
    if(project.screenplay){
      propTable.appendChild(generateRow(sourceLabel, sourceInput, makeSecondColumnFillWidth));
      propTable.appendChild(generateRow(draftDateLabel, draftDateInput, makeSecondColumnFillWidth));
      propTable.appendChild(generateRow(contactLabel, contactInput, makeSecondColumnFillWidth));
    }
    
    propForm.appendChild(propTable);

    var apply = document.createElement("input");
    apply.type = "submit";
    apply.value = "Apply";
    propForm.onsubmit = function(e){
      e.preventDefault();
      project.title = titleInput.value;
      project.author = authorInput.value;
      if(project.screenplay){
        project.credit = creditInput.value;
        project.draftDate = draftDateInput.value;
        project.contact = contactInput.value;
        project.source = sourceInput.value;
      }
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