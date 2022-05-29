function showImportOptions(docPath){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");
  var importForm = document.createElement("form");

  var filetypes = [
    { name: 'Plain Text', id: 'txtSelect', extensions: ['txt'] },
    { name: 'MarkdownFic', id: 'mdfcSelect', extensions: ['mdfc', 'txt'] }
  ];

  filetypes.forEach((type, i) => {
    var filetypeSelect = document.createElement('input');
    filetypeSelect.type = 'radio';
    filetypeSelect.name = 'typeSelect';
    filetypeSelect.value = i;
    filetypeSelect.id = type.id;
    importForm.appendChild(filetypeSelect);

    var typeLabel = document.createElement('label');
    typeLabel.for = filetypeSelect.name;
    typeLabel.innerText = type.name;
    importForm.appendChild(typeLabel);
  });

  var plainTextOptionsSet = document.createElement('fieldset');

  var plainTextOptionsLabel = document.createElement('legend');
  plainTextOptionsLabel.innerText = 'Plaintext Options';
  plainTextOptionsSet.appendChild(plainTextOptionsLabel);

  var convertFirstLinesLabel = document.createElement("label");
  convertFirstLinesLabel.innerText = "Convert First Lines To Titles: ";
  convertFirstLinesLabel.for = "convert-first-lines-check";
  plainTextOptionsSet.appendChild(convertFirstLinesLabel);

  var convertFirstLinesCheck = document.createElement("input");
  convertFirstLinesCheck.type = "checkbox";
  convertFirstLinesCheck.id = "convert-first-lines-check";
  convertFirstLinesCheck.checked = true;
  plainTextOptionsSet.appendChild(convertFirstLinesCheck);

  plainTextOptionsSet.appendChild(document.createElement('br'));

  var convertItalicsLabel = document.createElement("label");
  convertItalicsLabel.innerText = "Convert marked italics: ";
  convertItalicsLabel.for = "convert-italics-check";
  plainTextOptionsSet.appendChild(convertItalicsLabel);

  var convertItalicsCheck = document.createElement("input");
  convertItalicsCheck.type = "checkbox";
  convertItalicsCheck.id = "convert-italics-check";
  convertItalicsCheck.checked = true;
  plainTextOptionsSet.appendChild(convertItalicsCheck);

  var italicsStrLabel = document.createElement("label");
  italicsStrLabel.innerText = "Marker character: ";
  italicsStrLabel.for = "italics-str-input";
  plainTextOptionsSet.appendChild(italicsStrLabel);

  var italicsStrInput = document.createElement("input");
  italicsStrInput.type = "text";
  italicsStrInput.value = "*";
  italicsStrInput.id = "italics-str-input";
  plainTextOptionsSet.appendChild(italicsStrInput);

  plainTextOptionsSet.appendChild(document.createElement('br'));

  var convertTabsLabel = document.createElement("label");
  convertTabsLabel.innerText = "Convert marked tabs: ";
  convertTabsLabel.for = "convert-tabs-check";
  plainTextOptionsSet.appendChild(convertTabsLabel);

  var convertTabsCheck = document.createElement("input");
  convertTabsCheck.type = "checkbox";
  convertTabsCheck.id = "convert-tabs-check";
  convertTabsCheck.checked = true;
  plainTextOptionsSet.appendChild(convertTabsCheck);

  var tabsStrLabel = document.createElement("label");
  tabsStrLabel.innerText = "Tab string (default 4 spaces): ";
  tabsStrLabel.for = "tabs-str-input";
  plainTextOptionsSet.appendChild(tabsStrLabel);

  var tabsStrInput = document.createElement("input");
  tabsStrInput.type = "text";
  tabsStrInput.value = "    ";
  tabsStrInput.id = "tabs-str-input";
  plainTextOptionsSet.appendChild(tabsStrInput);

  importForm.appendChild(plainTextOptionsSet);

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

  importForm.onsubmit = function(e){
    e.preventDefault();

    var importOptions = {
      fileType: filetypes[document.querySelector('input[name="typeSelect"]:checked').value]
    };
    importOptions.txtOptions = {
      convertFirstLines: convertFirstLinesCheck.checked,
      convertItalics: {
        convert: convertItalicsCheck.checked,
        marker: italicsStrInput.value
      },
      convertTabs: {
        convert: convertTabsCheck.checked,
        marker: tabsStrInput.value
      }
    };

    initiateImport(docPath, importOptions);

    closePopups();
    displayChapterByIndex(project.activeChapterIndex);
  };

  popup.appendChild(importForm);
  document.body.appendChild(popup);

  var textSelect = document.getElementById('txtSelect');
  textSelect.checked = true;
  importForm.onchange = function(){
    plainTextOptionsSet.disabled = !textSelect.checked;
  };

  importBtn.focus();
}
