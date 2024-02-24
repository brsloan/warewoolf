function showCompileOptions(sysDirectories){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");
    var compileForm = document.createElement("form");

    var typeLabel = document.createElement("label");
    typeLabel.innerText = "File Type: ";
    typeLabel.for = "filetype-select";
    compileForm.appendChild(typeLabel);

    var typeSelect = document.createElement("select");
    const typeOptions = [".docx", ".txt", ".mdfc"];
    typeOptions.forEach(function(op){
      var txtOp = document.createElement("option");
      txtOp.value = op;
      txtOp.innerText = op;
      typeSelect.appendChild(txtOp);
    });
    compileForm.appendChild(typeSelect);

    compileForm.appendChild(document.createElement('br'));

    var insertStrLabel = document.createElement("label");
    insertStrLabel.innerText = "Insert string to mark chapter breaks: ";
    insertStrLabel.for = "insert-str-input";
    compileForm.appendChild(insertStrLabel);

    var insertStrInput = document.createElement("input");
    insertStrInput.type = "text";
    insertStrInput.value = "";
    insertStrInput.id = "insert-str-input";
    compileForm.appendChild(insertStrInput);

    compileForm.appendChild(document.createElement('br'));

    var insertHeadLabel = document.createElement("label");
    insertHeadLabel.innerText = "Insert chapter titles as headings: ";
    insertHeadLabel.for = "insert-head-check";
    compileForm.appendChild(insertHeadLabel);

    var insertHeadCheck = document.createElement("input");
    insertHeadCheck.type = "checkbox";
    insertHeadCheck.id = "insert-head-check";
    compileForm.appendChild(insertHeadCheck);

    compileForm.appendChild(document.createElement('br'));

    var compileBtn = document.createElement("input");
    compileBtn.type = "submit";
    compileBtn.value = "Compile";
    compileForm.appendChild(compileBtn);

    var cancelBtn = createButton("Cancel");
    cancelBtn.onclick = function(){
      closePopups();
    };
    compileForm.appendChild(cancelBtn);

    compileForm.onsubmit = function(e){
      e.preventDefault();
      var options = {
        type: typeSelect.value,
        insertStrng: insertStrInput.value,
        insertHead: insertHeadCheck.checked
      }
      getCompileFilepath(options, sysDirectories, function(){
        popup.remove();
      });
    };

    popup.appendChild(compileForm);
    document.body.appendChild(popup);
    typeSelect.focus();

  }

  function getCompileFilepath(options, sysDirectories, cback){
    const dialogOptions = {
      title: 'Save compilation as...',
      defaultPath: sysDirectories.docs,
      filters: [
        { name: 'Documents', extensions: [options.type.replaceAll('.','')] }
      ],
      bookmarkedPaths: [sysDirectories.docs, sysDirectories.home],
      dialogType: 'save'
    };
    
    showFileDialog(dialogOptions, function(filepath){
      if (filepath)
        compileProject(options, filepath);
        cback();
    })
  }
