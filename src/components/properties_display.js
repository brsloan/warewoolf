function showProperties(){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var filenameLabel = document.createElement('p');
    filenameLabel.innerText = "Filename:";
    popup.appendChild(filenameLabel);

    var filename = document.createElement('p');
    filename.innerText = project.filename;
    filename.classList.add('popup-text-small');
    popup.appendChild(filename);

    var directoryLabel = document.createElement('p');
    directoryLabel.innerText = "Directory:";
    popup.appendChild(directoryLabel);

    var directory = document.createElement('p');
    directory.innerText = project.directory;
    directory.classList.add('popup-text-small');
    popup.appendChild(directory);

    var pupDirLabel = document.createElement('p');
    pupDirLabel.innerText = "Chapters Directory:";
    popup.appendChild(pupDirLabel);

    var pupDir = document.createElement('p');
    pupDir.innerText = project.directory + project.filename.split(".")[0].concat("_pups/");
    pupDir.classList.add('popup-text-small');
    popup.appendChild(pupDir);

    var settingsFilepathLabel = document.createElement('p');
    settingsFilepathLabel.innerText = "User Settings Filepath:";
    popup.appendChild(settingsFilepathLabel);

    var settingsFilepathText = document.createElement('p');
    settingsFilepathText.innerText = userSettings.getSettingsFilepath();
    settingsFilepathText.classList.add('popup-text-small');
    popup.appendChild(settingsFilepathText);

    var propForm = document.createElement("form");

    var propTable = document.createElement("table");

    var titleLabel = document.createElement("label");
    titleLabel.innerText = "Project Title: ";
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
    document.body.appendChild(popup);
    titleInput.focus();
  }
