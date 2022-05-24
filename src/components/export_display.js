function showExportOptions(docPath){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");
    var exportForm = document.createElement("form");

    var typeLabel = document.createElement("label");
    typeLabel.innerText = "File Type: ";
    typeLabel.for = "filetype-select";
    exportForm.appendChild(typeLabel);

    var typeSelect = document.createElement("select");
    const typeOptions = [".docx", ".txt"];
    typeOptions.forEach(function(op){
      var txtOp = document.createElement("option");
      txtOp.value = op;
      txtOp.innerText = op;
      typeSelect.appendChild(txtOp);
    });
    exportForm.appendChild(typeSelect);

    exportForm.appendChild(document.createElement('br'));
  /*
    var insertHeadLabel = document.createElement("label");
    insertHeadLabel.innerText = "Insert chapter titles as headings: ";
    insertHeadLabel.for = "insert-head-check";
    exportForm.appendChild(insertHeadLabel);

    var insertHeadCheck = document.createElement("input");
    insertHeadCheck.type = "checkbox";
    insertHeadCheck.id = "insert-head-check";
    exportForm.appendChild(insertHeadCheck);

    exportForm.appendChild(document.createElement('br')); */

    var exportBtn = document.createElement("input");
    exportBtn.type = "submit";
    exportBtn.value = "Export";
    exportForm.appendChild(exportBtn);

    var cancelBtn = createButton("Cancel");
    cancelBtn.onclick = function(){
      closePopups();
    };
    exportForm.appendChild(cancelBtn);

    exportForm.onsubmit = function(){
      var options = {
        type: typeSelect.value
        //insertHead: insertHeadCheck.checked
      }
      getExportFilePath(options, docPath);
      closePopups();
    };

    popup.appendChild(exportForm);
    document.body.appendChild(popup);
    exportBtn.focus();
  }

  function getExportFilePath(options, docPath){
    const saveOptions = {
      title: 'Export files to... (Subdirectory will be created)',
      defaultPath: docPath,
      properties: ['openDirectory']
    };
    var filepath = convertFilepath(dialog.showOpenDialogSync(saveOptions)[0]);
    if(filepath)
      exportProject(options, filepath);
  }
