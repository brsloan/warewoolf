const { closePopups, createButton, removeElementsByClass, generateRow } = require('../controllers/utils');
const showFileDialog = require('./file-dialog_display');
const { showWorking, hideWorking } = require('./working_display');
const { compileProject } = require('../controllers/compile');
const { logError } = require('../controllers/error-log');

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
    typeLabel.htmlFor = "filetype-select";

    var typeSelect = document.createElement("select");
    typeSelect.id = "filetype-select";
    const typeOptions = [".docx", ".txt", ".mdfc", ".md", ".html", ".epub"];
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
    insertStrLabel.htmlFor = "insert-str-input";

    var insertStrInput = document.createElement("input");
    insertStrInput.type = "text";
    insertStrInput.value = userSettings.compileChapMark;
    insertStrInput.id = "insert-str-input";

    compTbl.appendChild(generateRow(insertStrLabel, insertStrInput));

    var insertHeadLabel = document.createElement("label");
    insertHeadLabel.innerText = "Insert chapter titles as headings: ";
    insertHeadLabel.htmlFor = "insert-head-check";

    var insertHeadCheck = document.createElement("input");
    insertHeadCheck.type = "checkbox";
    insertHeadCheck.id = "insert-head-check";
    insertHeadCheck.checked = userSettings.compileInsertHeaders;

    compTbl.appendChild(generateRow(insertHeadLabel, insertHeadCheck));

    var titlePageLabel = document.createElement('label');
    titlePageLabel.innerText = 'Generate Title Page: ';
    titlePageLabel.htmlFor = 'title-page-check';

    var titlePageCheck = document.createElement('input');
    titlePageCheck.type = 'checkbox';
    titlePageCheck.id = 'title-page-check';
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
      if(typeSelect.value != '.docx' && typeSelect.value != '.html' && typeSelect.value != '.epub')
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
        generateTitlePage: titlePageCheck.checked,
        styleHeadingAsChapter: true
      }
      getCompileFilepath(project, userSettings, options, sysDirectories, function(){
        popup.remove();
      });
    };

    if(userSettings.compileType != '.docx' && userSettings.compileType != '.html' && userSettings.compileType != '.epub')
      titlePageCheck.disabled = true;

    popup.appendChild(compileForm);
    document.body.appendChild(popup);
    typeSelect.focus();

  }

  function getCompileFilepath(project, userSettings, options, sysDirectories, cback){
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
        //compileProject is async now (it reads chapters through the platform facade), so a failure
        //inside it arrives as a rejection rather than a throw. Caught here so the "Working..."
        //popup always comes back down - unhandled, it would sit over the reader forever.
        //Promise.resolve so a backing that hands back nothing at all is as safe as one that returns a
        //promise.
        Promise.resolve(compileProject(project, userSettings, options, filepath, function(){
          hideWorking();
          cback();
        })).catch(function(err){
          logError(err);
          hideWorking();
          cback();
        });
      }
    })
  }

  module.exports = showCompileOptions;