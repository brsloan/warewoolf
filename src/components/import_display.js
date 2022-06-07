function showImportOptions(docPath){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");
  var importForm = document.createElement("form");

  var filetypes = [
    { name: 'Plain Text', id: 'txtSelect', extensions: ['txt'] },
    { name: 'MarkdownFic', id: 'mdfcSelect', extensions: ['mdfc', 'txt', "md"] }
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

  var opsTable = document.createElement('table');

  var convertItalicsLabel = document.createElement("label");
  convertItalicsLabel.innerText = "Convert marked italics: ";
  convertItalicsLabel.for = "convert-italics-check";

  var convertItalicsCheck = document.createElement("input");
  convertItalicsCheck.type = "checkbox";
  convertItalicsCheck.id = "convert-italics-check";
  convertItalicsCheck.checked = true;

  opsTable.appendChild(generateRow(convertItalicsLabel, convertItalicsCheck));

  var italicsStrLabel = document.createElement("label");
  italicsStrLabel.innerText = "Marker character: ";
  italicsStrLabel.for = "italics-str-input";
  italicsStrLabel.classList.add('sublabel');

  var italicsStrInput = document.createElement("input");
  italicsStrInput.type = "text";
  italicsStrInput.value = "*";
  italicsStrInput.id = "italics-str-input";
  plainTextOptionsSet.appendChild(italicsStrInput);

  opsTable.appendChild(generateRow(italicsStrLabel, italicsStrInput));

  var convertTabsLabel = document.createElement("label");
  convertTabsLabel.innerText = "Convert marked tabs: ";
  convertTabsLabel.for = "convert-tabs-check";

  var convertTabsCheck = document.createElement("input");
  convertTabsCheck.type = "checkbox";
  convertTabsCheck.id = "convert-tabs-check";
  convertTabsCheck.checked = true;

  opsTable.appendChild(generateRow(convertTabsLabel, convertTabsCheck));

  var tabsStrLabel = document.createElement("label");
  tabsStrLabel.innerText = "Tab string (default 4 spaces): ";
  tabsStrLabel.for = "tabs-str-input";
  tabsStrLabel.classList.add('sublabel');

  var tabsStrInput = document.createElement("input");
  tabsStrInput.type = "text";
  tabsStrInput.value = "    ";
  tabsStrInput.id = "tabs-str-input";

  opsTable.appendChild(generateRow(tabsStrLabel, tabsStrInput));

  var splitChapsLabel = document.createElement("label");
  splitChapsLabel.innerText = "Split Into Chapters: ";
  splitChapsLabel.for = "split-chaps-check";

  var splitChapsCheck = document.createElement("input");
  splitChapsCheck.type = "checkbox";
  splitChapsCheck.id = "split-chaps-check";
  splitChapsCheck.checked = true;

  opsTable.appendChild(generateRow(splitChapsLabel, splitChapsCheck));

  var chapsStrLabel = document.createElement("label");
  chapsStrLabel.innerText = "Chapter Split Marker: ";
  chapsStrLabel.for = "chaps-str-input";
  chapsStrLabel.classList.add('sublabel');

  var chapsStrInput = document.createElement("input");
  chapsStrInput.type = "text";
  chapsStrInput.value = "<ch>";
  chapsStrInput.id = "chaps-str-input";

  opsTable.appendChild(generateRow(chapsStrLabel, chapsStrInput));

  var convertFirstLinesLabel = document.createElement("label");
  convertFirstLinesLabel.innerText = "Convert First Lines To Titles: ";
  convertFirstLinesLabel.for = "convert-first-lines-check";

  var convertFirstLinesCheck = document.createElement("input");
  convertFirstLinesCheck.type = "checkbox";
  convertFirstLinesCheck.id = "convert-first-lines-check";
  convertFirstLinesCheck.checked = true;

  opsTable.appendChild(generateRow(convertFirstLinesLabel, convertFirstLinesCheck));
  plainTextOptionsSet.appendChild(opsTable);
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
      },
      splitChapters: {
        split: splitChapsCheck.checked,
        marker: chapsStrInput.value
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

function generateRow(elOne, elTwo){
  var row = document.createElement('tr');
  var cellOne = document.createElement('td');
  cellOne.appendChild(elOne);
  row.appendChild(cellOne);
  var cellTwo = document.createElement('td');
  cellTwo.appendChild(elTwo);
  row.appendChild(cellTwo);
  return row;
}
