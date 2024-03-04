function showRenumberChapters(){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var popupTitle = document.createElement('h1');
  popupTitle.innerText = 'Renumber Chapters';
  popup.appendChild(popupTitle);

  var undoWarning = document.createElement('p');
  undoWarning.innerText = 'WARNING: This action cannot be undone. Be sure to save first.';
  undoWarning.classList.add('warning-text');
  popup.appendChild(undoWarning);


  var renumberForm = document.createElement('form');

  var renumTable = document.createElement('table');

  var formatLabel = document.createElement('label');
  formatLabel.innerText = 'Rename Format ("[num]" indicates where to insert number):';
  formatLabel.for = 'renumber-format-label';
  //renumberForm.appendChild(formatLabel);

  //renumberForm.appendChild(document.createElement('br'));

  var formatInput = document.createElement('input');
  formatInput.type = 'text';
  formatInput.value = 'Chapter [num]';
  formatInput.id = 'renumber-format-input';
  //renumberForm.appendChild(formatInput);

  renumTable.appendChild(generateRow(formatLabel, formatInput));
  //renumberForm.appendChild(document.createElement('br'));

  var useNumeralsLabel = document.createElement("label");
  useNumeralsLabel.innerText = "Use Numerals: ";
  useNumeralsLabel.for = "use-numerals-check";
  //renumberForm.appendChild(useNumeralsLabel);

  var useNumeralsCheck = document.createElement("input");
  useNumeralsCheck.type = "checkbox";
  useNumeralsCheck.id = "use-numerals-check";
  //renumberForm.appendChild(useNumeralsCheck);

  renumTable.appendChild(generateRow(useNumeralsLabel, useNumeralsCheck));
  //renumberForm.appendChild(document.createElement('br'));

  var insertReplaceLabel = document.createElement("label");
  insertReplaceLabel.innerText = "Insert/Replace In Chapter (will replace first line of every chapter): ";
  insertReplaceLabel.for = "insert-replace-check";
  //renumberForm.appendChild(insertReplaceLabel);

  var insertReplaceCheck = document.createElement("input");
  insertReplaceCheck.type = "checkbox";
  insertReplaceCheck.id = "insert-replace-check";
  //renumberForm.appendChild(insertReplaceCheck);

  renumTable.appendChild(generateRow(insertReplaceLabel, insertReplaceCheck));
  //renumberForm.appendChild(document.createElement('br'));

  var startChapLabel = document.createElement("label");
  startChapLabel.innerText = "Start Renumbering At: ";
  startChapLabel.for = "start-chap-select";
  //renumberForm.appendChild(startChapLabel);

  var startChapDrop = getChapterDropdown(0);
  startChapDrop.id = 'start-chap-select';
  //renumberForm.appendChild(startChapDrop);

  renumTable.appendChild(generateRow(startChapLabel, startChapDrop));
  //renumberForm.appendChild(document.createElement('br'));

  var endChapLabel = document.createElement("label");
  endChapLabel.innerText = "End Renumbering At: ";
  endChapLabel.for = "end-chap-select";
  renumberForm.appendChild(endChapLabel)

  var endChapDrop = getChapterDropdown(project.chapters.length - 1);
  endChapDrop.id = 'end-chap-select';
  renumberForm.appendChild(endChapDrop);

  renumTable.appendChild(generateRow(endChapLabel, endChapDrop));
  //renumberForm.appendChild(document.createElement('br'));

  renumberForm.appendChild(renumTable);

  var submit = createButton("Submit");
  submit.onclick = function(){
    renumberChaps(parseInt(startChapDrop.value), parseInt(endChapDrop.value), insertReplaceCheck.checked, useNumeralsCheck.checked, formatInput.value);
    updateFileList();
    displayChapterByIndex(project.activeChapterIndex);
    closePopups();
  };
  renumberForm.appendChild(submit);

  var close = createButton("Close");
  close.onclick = function(){
    closePopups();
  };
  renumberForm.appendChild(close);

  popup.appendChild(renumberForm);

  document.body.appendChild(popup);
  close.focus();

  function getChapterDropdown(selectVal){
    let chapDrop = document.createElement('select');

    project.chapters.forEach((chap, i) => {
      let chapOp = document.createElement('option');
      chapOp.value = i;
      chapOp.innerText = chap.title;
      if(i == selectVal)
        chapOp.selected = true;
      chapDrop.appendChild(chapOp);
    });

    return chapDrop;
  }
}
