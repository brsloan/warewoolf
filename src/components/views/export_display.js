const { closePopups, createButton, removeElementsByClass } = require('../controllers/utils');
const showFileDialog = require('./file-dialog_display');
const { exportProject } = require('../controllers/export');
const { showWorkingAndThen, showWorking, hideWorking } = require('./working_display');

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
    expProjLab.htmlFor = 'proj-radio';
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
    expChapLab.htmlFor = 'chap-radio';
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
    typeLabel.htmlFor = "filetype-select";
    exportForm.appendChild(typeLabel);

    var typeSelect = document.createElement("select");
    typeSelect.id = "filetype-select";
    const typeOptions = [".docx", ".txt", ".mdfc", ".md", ".html", ".epub"];
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
    insertHeadLabel.htmlFor = "insert-head-check";
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
        what: expProjOp.checked ? 'project' : 'chapter',
        styleHeadingAsChapter: true,
        generateTitlePage: false
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
      if(dirpath){
        //Exporting can be slow on projects with many/large chapters, and .docx/.epub chapters
        //finish writing asynchronously - so show a working indicator (deferred via
        //showWorkingAndThen so it has a chance to paint first) instead of freezing with no
        //feedback, and wait for exportProject's completion callback before closing anything.
        showWorkingAndThen('Exporting...', function(){
          exportProject(project, userSettings, options, dirpath, function(errorCount){
            if(errorCount > 0){
              //Give the user a moment to see that something went wrong instead of the popup
              //just vanishing as if the export fully succeeded.
              showWorking(errorCount + (errorCount == 1 ? ' file' : ' files') + ' failed to export - see the Error Log for details.');
              setTimeout(function(){
                hideWorking();
                cback();
              }, 2500);
            }
            else{
              hideWorking();
              cback();
            }
          });
        });
      }
      else{
        cback();
      }
    });
  }

  module.exports = showExportOptions;