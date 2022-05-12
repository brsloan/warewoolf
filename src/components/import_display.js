function showImportOptions(docPath){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");
  var importForm = document.createElement("form");

  var convertHeadingsLabel = document.createElement("label");
  convertHeadingsLabel.innerText = "Break Headings Into Chapters: ";
  convertHeadingsLabel.for = "convert-headings-check";
  importForm.appendChild(convertHeadingsLabel);

  var convertHeadingsCheck = document.createElement("input");
  convertHeadingsCheck.type = "checkbox";
  convertHeadingsCheck.id = "convert-headings-check";
  convertHeadingsCheck.checked = true;
  importForm.appendChild(convertHeadingsCheck);

  var headingLevelLabel = document.createElement("label");
  headingLevelLabel.innerText = "Heading Level: ";
  headingLevelLabel.for = "heading-level-select";
  importForm.appendChild(headingLevelLabel);

  var headingSelect = document.createElement("select");
  const headingOptions = ["1", "2", "3", "4"];
  headingOptions.forEach(function(op){
    var hdOp = document.createElement("option");
    hdOp.value = op;
    hdOp.innerText = op;
    headingSelect.appendChild(hdOp);
  });
  importForm.appendChild(headingSelect);

  importForm.appendChild(document.createElement('br'));

  var convertItalicsLabel = document.createElement("label");
  convertItalicsLabel.innerText = "Convert marked italics: ";
  convertItalicsLabel.for = "convert-italics-check";
  importForm.appendChild(convertItalicsLabel);

  var convertItalicsCheck = document.createElement("input");
  convertItalicsCheck.type = "checkbox";
  convertItalicsCheck.id = "convert-italics-check";
  convertItalicsCheck.checked = true;
  importForm.appendChild(convertItalicsCheck);

  var italicsStrLabel = document.createElement("label");
  italicsStrLabel.innerText = "Marker character: ";
  italicsStrLabel.for = "italics-str-input";
  importForm.appendChild(italicsStrLabel);

  var italicsStrInput = document.createElement("input");
  italicsStrInput.type = "text";
  italicsStrInput.value = "*";
  italicsStrInput.id = "italics-str-input";
  importForm.appendChild(italicsStrInput);

  importForm.appendChild(document.createElement('br'));

  var importBtn = document.createElement("input");
  importBtn.type = "submit";
  importBtn.value = "Import";
  importForm.appendChild(importBtn);

  var cancelBtn = createButton("Cancel");
  cancelBtn.onclick = function(){
    popup.remove();
  };
  importForm.appendChild(cancelBtn);

  importForm.onsubmit = function(){
    getImportFilepaths(docPath);
    if(convertHeadingsCheck.checked)
      breakHeadingsIntoChapters(headingSelect.value);
    if(convertItalicsCheck.checked)
      convertMarkedItalics(italicsStrInput.value);
    displayChapterByIndex(project.activeChapterIndex);
    popup.remove();
  };

  popup.appendChild(importForm);
  document.body.appendChild(popup);
}



function getImportFilepaths(docPath){
    const options = {
      title: 'Import files...',
      defaultPath: docPath,
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Text Files', extensions: ['txt'] }
      ]
    };
    var filepaths = dialog.showOpenDialogSync(options);
    if(filepaths)
      importFiles(filepaths);
  }
