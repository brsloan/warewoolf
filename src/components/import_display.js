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

  var convertTabsLabel = document.createElement("label");
  convertTabsLabel.innerText = "Convert marked tabs: ";
  convertTabsLabel.for = "convert-tabs-check";
  importForm.appendChild(convertTabsLabel);

  var convertTabsCheck = document.createElement("input");
  convertTabsCheck.type = "checkbox";
  convertTabsCheck.id = "convert-tabs-check";
  convertTabsCheck.checked = true;
  importForm.appendChild(convertTabsCheck);

  var tabsStrLabel = document.createElement("label");
  tabsStrLabel.innerText = "Tab string (default 4 spaces): ";
  tabsStrLabel.for = "tabs-str-input";
  importForm.appendChild(tabsStrLabel);

  var tabsStrInput = document.createElement("input");
  tabsStrInput.type = "text";
  tabsStrInput.value = "    ";
  tabsStrInput.id = "tabs-str-input";
  importForm.appendChild(tabsStrInput);

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
    var filepaths = getImportFilepaths(docPath);
    //importPlainText(filepaths);
    console.log(filepaths);
    try{
      importFiles(filepaths, {
        convertFirstLines: convertFirstLinesCheck.checked,
        convertItalics: {
          convert: convertItalicsCheck.checked,
          marker: italicsStrInput.value
        },
        convertTabs: {
          convert: convertTabsCheck.checked,
          marker: tabsStrInput.value
        }
      });
    }
    catch(err){
      console.log(err);
    }

    displayChapterByIndex(project.activeChapterIndex);
    closePopups();
  };

  popup.appendChild(importForm);
  document.body.appendChild(popup);
  importBtn.focus();
}
