const { closePopups, createButton, removeElementsByClass, generateRow } = require('../controllers/utils');
const showFileDialog = require('./file-dialog_display');
const { showWorking, hideWorking } = require('./working_display');
const { compileProject } = require('../controllers/compile');

function showCompileOptions(project, sysDirectories, userSettings){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var popupTitle = document.createElement('h1');
    popupTitle.innerText = 'Compile Project';
    popup.appendChild(popupTitle);

    var compileForm = document.createElement("form");

    var compTbl = document.createElement('table');

    var typeLabel = document.createElement("label");
    typeLabel.innerText = "File Type: ";
    typeLabel.for = "filetype-select";

    var typeSelect = document.createElement("select");
    const typeOptions = [".docx", ".txt", ".mdfc", ".md", ".html"];
    typeOptions.forEach(function(op){
      var txtOp = document.createElement("option");
      txtOp.value = op;
      txtOp.innerText = op;
      typeSelect.appendChild(txtOp);
    });
    typeSelect.value = userSettings.compileType;

    compTbl.appendChild(generateRow(typeLabel, typeSelect));

    var insertStrLabel = document.createElement("label");
    insertStrLabel.innerText = "Insert string to mark chapter breaks: ";
    insertStrLabel.for = "insert-str-input";

    var insertStrInput = document.createElement("input");
    insertStrInput.type = "text";
    insertStrInput.value = userSettings.compileChapMark;
    insertStrInput.id = "insert-str-input";

    compTbl.appendChild(generateRow(insertStrLabel, insertStrInput));

    var insertHeadLabel = document.createElement("label");
    insertHeadLabel.innerText = "Insert chapter titles as headings: ";
    insertHeadLabel.for = "insert-head-check";

    var insertHeadCheck = document.createElement("input");
    insertHeadCheck.type = "checkbox";
    insertHeadCheck.id = "insert-head-check";
    insertHeadCheck.checked = userSettings.compileInsertHeaders;

    compTbl.appendChild(generateRow(insertHeadLabel, insertHeadCheck));

    var titlePageLabel = document.createElement('label');
    titlePageLabel.innerText = 'Generate Title Page: ';

    var titlePageCheck = document.createElement('input');
    titlePageCheck.type = 'checkbox';
    titlePageCheck.checked = userSettings.compileGenTitlePage;

    compTbl.appendChild(generateRow(titlePageLabel, titlePageCheck));

    compileForm.appendChild(compTbl);

    var compileBtn = document.createElement("input");
    compileBtn.type = "submit";
    compileBtn.value = "Compile";
    compileForm.appendChild(compileBtn);

    var cancelBtn = createButton("Cancel");
    cancelBtn.onclick = function(){
      closePopups();
    };
    compileForm.appendChild(cancelBtn);

    typeSelect.onchange = function(){
      if(typeSelect.value != '.docx')
        titlePageCheck.disabled = true;
      else {
        titlePageCheck.disabled = false;
      }
    }

    compileForm.onsubmit = function(e){
      e.preventDefault();

      userSettings.compileType = typeSelect.value;
      userSettings.compileInsertHeaders = insertHeadCheck.checked;
      userSettings.compileChapMark = insertStrInput.value;
      userSettings.compileGenTitlePage = titlePageCheck.checked;
      userSettings.save();

      var options = {
        type: typeSelect.value,
        insertStrng: insertStrInput.value,
        insertHead: insertHeadCheck.checked,
        generateTitlePage: titlePageCheck.checked
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
      if(filepath){
        showWorking();
        compileProject(project, options, filepath);
        hideWorking();
        cback();
      }
    })
  }

  module.exports = showCompileOptions;