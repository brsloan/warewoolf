const { closePopups, createButton, removeElementsByClass } = require('../controllers/utils');
const showFileDialog = require('./file-dialog_display');
const { exportProject } = require('../controllers/export');

function showExportOptions(project, userSettings, sysDirectories){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var popupTitle = document.createElement('h1');
    popupTitle.innerText = 'Export';
    popup.appendChild(popupTitle);

    var exportForm = document.createElement("form");

    var expProjLab = document.createElement('label');
    expProjLab.innerText = 'Project';
    expProjLab.for = 'proj-radio';
    exportForm.appendChild(expProjLab);

    var expProjOp = document.createElement('input');
    expProjOp.type = 'radio';
    expProjOp.id = 'proj-radio';
    expProjOp.name = 'export-what';
    expProjOp.value = 'project';
    expProjOp.checked = true;
    exportForm.appendChild(expProjOp);

    var expChapLab = document.createElement('label');
    expChapLab.innerText = ' | Chapter';
    expChapLab.for = 'chap-radio';
    exportForm.appendChild(expChapLab);

    var expChapOp = document.createElement('input');
    expChapOp.type = 'radio';
    expChapOp.id = 'chap-radio';
    expChapOp.name = 'export-what';
    expChapOp.value = 'chapter';
    exportForm.appendChild(expChapOp);

    exportForm.appendChild(document.createElement('br'));

    var typeLabel = document.createElement("label");
    typeLabel.innerText = "File Type: ";
    typeLabel.for = "filetype-select";
    exportForm.appendChild(typeLabel);

    var typeSelect = document.createElement("select");
    const typeOptions = [".docx", ".txt", ".mdfc"];
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

    exportForm.onsubmit = function(e){
      e.preventDefault();

      var options = {
        type: typeSelect.value,
        what: expProjOp.checked ? 'project' : 'chapter'
        //insertHead: insertHeadCheck.checked
      }
      getExportFilePath(project, userSettings, options, sysDirectories, function(){
          closePopups();
      });
    };

    popup.appendChild(exportForm);
    document.body.appendChild(popup);
    exportBtn.focus();
  }

  function getExportFilePath(project, userSettings, options, sysDirectories, cback){
    const saveOptions = {
      title: 'Export files to... (Subdirectory "' + (project.title.length > 0 ? project.title.replace(/[^a-z0-9]/gi, '_') : 'exports') + '" will be created)',
      defaultPath: sysDirectories.docs,
      bookmarkedPaths: [sysDirectories.docs, sysDirectories.home],
      filters: [],
      dialogType: 'chooseDirectory'
    };

    showFileDialog(saveOptions, function(dirpath){
      if(dirpath)
        exportProject(project, userSettings, options, dirpath);
      cback();
    });
  }

  module.exports = showExportOptions;