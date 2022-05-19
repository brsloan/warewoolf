function showImportOptions(docPath){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");
  var importForm = document.createElement("form");

  var convertFirstLinesLabel = document.createElement("label");
  convertFirstLinesLabel.innerText = "Convert First Lines To Titles: ";
  convertFirstLinesLabel.for = "convert-first-lines-check";
  importForm.appendChild(convertFirstLinesLabel);

  var convertFirstLinesCheck = document.createElement("input");
  convertFirstLinesCheck.type = "checkbox";
  convertFirstLinesCheck.id = "convert-first-lines-check";
  convertFirstLinesCheck.checked = true;
  importForm.appendChild(convertFirstLinesCheck);

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
    closePopups();
  };
  importForm.appendChild(cancelBtn);

  importForm.onsubmit = function(){
    getImportFilepaths(docPath);
    if(convertFirstLinesCheck.checked)
      convertFirstLinesToTitles();
    if(convertItalicsCheck.checked)
      convertMarkedItalics(italicsStrInput.value);
    displayChapterByIndex(project.activeChapterIndex);
    closePopups();
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
