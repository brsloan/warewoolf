const { closePopups, createButton, removeElementsByClass, generateRow, describeDialog } = require('../controllers/utils');
const { getTitlePageValues, setTitlePageValues } = require('../controllers/fountain');

function showProperties(project, userSettings){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var popupTitle = document.createElement('h1');
    popupTitle.innerText = 'Project Properties';
    popup.appendChild(popupTitle);
    describeDialog(popup, popupTitle);

    var propForm = document.createElement("form");

    var propTable = document.createElement("table");

    var titleLabel = document.createElement("label");
    titleLabel.innerText = "Title: ";
    titleLabel.htmlFor = "title-input";

    var titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.value = project.title;
    titleInput.id = "title-input";

    propTable.appendChild(generateRow(titleLabel, titleInput));

    var authorLabel = document.createElement("label");
    authorLabel.innerText = "Author: ";
    authorLabel.htmlFor = "author-input";

    var authorInput = document.createElement("input");
    authorInput.type = "text";
    authorInput.value = project.author;
    authorInput.id = "author-input";

    propTable.appendChild(generateRow(authorLabel, authorInput));

    propForm.appendChild(propTable);

    //A screenplay's title page (docs/screenplay-plan.md): the Fountain keys beyond Title and
    //Author, which the two fields above already carry and are mirrored into on Apply. Written
    //back through fountain.js's helpers so the order of keys the writer had is kept, and a field
    //left empty takes its key out rather than writing "Credit:" with nothing after it.
    var titlePageInputs = [];
    if(project.type === 'screenplay'){
      var titlePageSet = document.createElement('fieldset');
      var titlePageLegend = document.createElement('legend');
      titlePageLegend.innerText = 'Title Page';
      titlePageSet.appendChild(titlePageLegend);

      var titlePageTable = document.createElement('table');
      [
        { key: 'Credit', multiline: false },
        { key: 'Source', multiline: false },
        { key: 'Draft date', multiline: false },
        { key: 'Copyright', multiline: false },
        { key: 'Contact', multiline: true },
        { key: 'Notes', multiline: true }
      ].forEach(function(field){
        var label = document.createElement('label');
        label.innerText = field.key + ': ';
        label.htmlFor = 'title-page-' + field.key.toLowerCase().replace(/\s+/g, '-');

        var input = document.createElement(field.multiline ? 'textarea' : 'input');
        if(!field.multiline)
          input.type = 'text';
        input.id = label.htmlFor;
        input.value = getTitlePageValues(project.titlePage, field.key).join('\n');

        titlePageTable.appendChild(generateRow(label, input));
        titlePageInputs.push({ key: field.key, input: input });
      });

      titlePageSet.appendChild(titlePageTable);
      propForm.appendChild(titlePageSet);
    }

    var apply = document.createElement("input");
    apply.type = "submit";
    apply.value = "Apply";
    propForm.onsubmit = function(e){
      e.preventDefault();
      project.title = titleInput.value;
      project.author = authorInput.value;

      if(project.type === 'screenplay'){
        var page = setTitlePageValues(project.titlePage, 'Title', [titleInput.value]);
        page = setTitlePageValues(page, 'Author', [authorInput.value]);
        titlePageInputs.forEach(function(field){
          page = setTitlePageValues(page, field.key, field.input.value.split(/\r\n|\r|\n/));
        });
        project.titlePage = page;

        //The title page lives in the script's file, so the script is what has to be rewritten.
        project.chapters.forEach(function(chap){
          if(chap.format === 'fountain' || /\.fountain$/i.test(chap.filename || ''))
            chap.hasUnsavedChanges = true;
        });
      }

      project.hasUnsavedChanges = true;
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
    pupDirWarning.innerText = "(DO NOT CHANGE THIS UNLESS YOU KNOW WHAT YOU ARE DOING. This is the relative filepath that tells your project file where to find the individual .txt files that are its chapters.)";
    pupDirWarning.classList.add('popup-text-small');
    advancedArea.appendChild(pupDirWarning);

    var pupDirInput = document.createElement('input');
    pupDirInput.type = "text";
    pupDirInput.setAttribute('aria-label', 'Chapters directory');
    pupDirInput.value = project.chapsDirectory;
    advancedArea.appendChild(pupDirInput);

    var pupDirSubmit = createButton("Save Changes To Chaps Directory");
    var pupDirConfirm = document.createElement('p');
    pupDirConfirm.classList.add('popup-text-small');
    pupDirSubmit.onclick = async function(){
      if(pupDirInput.value.length > 0 && !pupDirInput.value.endsWith('/')){
        pupDirInput.value += "/";
      }
      project.chapsDirectory = pupDirInput.value;
      //Awaited so "Saved." only appears once the project file has actually been written.
      await project.saveFile();
      pupDirConfirm.innerText = "Saved.";
    };
    advancedArea.appendChild(pupDirSubmit);
    advancedArea.appendChild(pupDirConfirm);

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