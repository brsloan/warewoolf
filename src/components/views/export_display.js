const { closePopups, createButton, removeElementsByClass, describeDialog } = require('../controllers/utils');
const showFileDialog = require('./file-dialog_display');
const { exportProject, exportScreenplayFile, screenplayChapter } = require('../controllers/export');
const { logError } = require('../controllers/error-log');
const { showWorkingAndThen, showWorking, hideWorking } = require('./working_display');

function showExportOptions(project, userSettings, sysDirectories){
    if(project.type === 'screenplay'){
      showScreenplayExportOptions(project, sysDirectories);
      return;
    }

    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var popupTitle = document.createElement('h1');
    popupTitle.innerText = 'Export';
    popup.appendChild(popupTitle);
    describeDialog(popup, popupTitle);

    var exportForm = document.createElement("form");

    //Each name and its button in one .radio-option, so the line can only break between the two
    //choices and never between a choice and the button that answers it.
    var expProjOption = document.createElement('span');
    expProjOption.classList.add('radio-option');
    exportForm.appendChild(expProjOption);

    var expProjLab = document.createElement('label');
    expProjLab.innerText = 'Project';
    expProjLab.htmlFor = 'proj-radio';
    expProjOption.appendChild(expProjLab);

    var expProjOp = document.createElement('input');
    expProjOp.type = 'radio';
    expProjOp.id = 'proj-radio';
    expProjOp.name = 'export-what';
    expProjOp.value = 'project';
    expProjOp.checked = true;
    expProjOption.appendChild(expProjOp);

    var expChapOption = document.createElement('span');
    expChapOption.classList.add('radio-option');
    exportForm.appendChild(expChapOption);

    var expChapLab = document.createElement('label');
    expChapLab.innerText = ' | Chapter';
    expChapLab.htmlFor = 'chap-radio';
    expChapOption.appendChild(expChapLab);

    var expChapOp = document.createElement('input');
    expChapOp.type = 'radio';
    expChapOp.id = 'chap-radio';
    expChapOp.name = 'export-what';
    expChapOp.value = 'chapter';
    expChapOption.appendChild(expChapOp);

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

    //The longest label in the dialog, and the box sits after it, so this is the pair likeliest to
    //be split across a line break. Wrapped in one .checkbox-option to keep the box with it.
    var sceneBreakOption = document.createElement('span');
    sceneBreakOption.classList.add('checkbox-option');
    exportForm.appendChild(sceneBreakOption);

    var sceneBreakLabel = document.createElement('label');
    sceneBreakLabel.innerText = 'Mark scene breaks with a centered #: ';
    sceneBreakLabel.htmlFor = 'scene-break-check';
    sceneBreakOption.appendChild(sceneBreakLabel);

    var sceneBreakCheck = document.createElement('input');
    sceneBreakCheck.type = 'checkbox';
    sceneBreakCheck.id = 'scene-break-check';
    sceneBreakCheck.checked = userSettings.markSceneBreaks;
    sceneBreakOption.appendChild(sceneBreakCheck);

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

      //The only thing this dialog has ever had worth remembering, and the same setting the Compile
      //dialog writes - see user-settings.js.
      userSettings.markSceneBreaks = sceneBreakCheck.checked;
      userSettings.save();

      var options = {
        type: typeSelect.value,
        what: expProjOp.checked ? 'project' : 'chapter',
        styleHeadingAsChapter: true,
        generateTitlePage: false,
        markSceneBreaks: sceneBreakCheck.checked
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

  //A screenplay project's export: one script, one file, wherever the writer puts it. The dialog is
  //a format to choose and then a Save As, not the directory chooser above, since there is no set
  //of numbered chapter files to make a folder for. See docs/screenplay-plan.md, Phase 7.
  const SCREENPLAY_FORMATS = [
    { type: '.pdf', name: 'PDF', extensions: ['pdf'] },
    { type: '.fdx', name: 'Final Draft', extensions: ['fdx'] },
    { type: '.fountain', name: 'Fountain', extensions: ['fountain'] },
    { type: '.txt', name: 'Plain Text', extensions: ['txt'] }
  ];

  function showScreenplayExportOptions(project, sysDirectories){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var popupTitle = document.createElement('h1');
    popupTitle.innerText = 'Export Screenplay';
    popup.appendChild(popupTitle);
    describeDialog(popup, popupTitle);

    var exportForm = document.createElement("form");

    var typeLabel = document.createElement("label");
    typeLabel.innerText = "File Type: ";
    typeLabel.htmlFor = "filetype-select";
    exportForm.appendChild(typeLabel);

    var typeSelect = document.createElement("select");
    typeSelect.id = "filetype-select";
    SCREENPLAY_FORMATS.forEach(function(format){
      var option = document.createElement("option");
      option.value = format.type;
      option.innerText = format.type;
      typeSelect.appendChild(option);
    });
    exportForm.appendChild(typeSelect);

    exportForm.appendChild(document.createElement('br'));

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

      var format = SCREENPLAY_FORMATS.find(function(f){ return f.type === typeSelect.value; });
      var chapter = screenplayChapter(project);

      if(!chapter){
        closePopups();
        require('./blocked-action_display')('This project has no script to export.');
        return;
      }

      showFileDialog({
        title: 'Export screenplay as...',
        defaultPath: sysDirectories.docs,
        defaultFilename: project.title,
        filters: [{ name: format.name, extensions: format.extensions }],
        bookmarkedPaths: [sysDirectories.docs, sysDirectories.home],
        projectDirectory: project.directory,
        dialogType: 'save'
      }, function(filepath){
        if(!filepath){
          closePopups();
          return;
        }

        showWorkingAndThen('Exporting...', function(){
          Promise.resolve(exportScreenplayFile(project, chapter, format.type, filepath)).then(function(){
            hideWorking();
            closePopups();
          }).catch(function(err){
            logError(err);
            showWorking('The export failed - see the Error Log for details.');
            setTimeout(function(){
              hideWorking();
              closePopups();
            }, 2500);
          });
        });
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
          //Promise.resolve so a backing that hands back nothing at all is as safe as one that returns
          //a promise.
          Promise.resolve(exportProject(project, userSettings, options, dirpath, function(errorCount){
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
          })).catch(function(err){
            //exportProject is async now (it reads chapters through the platform facade), so a
            //failure inside it arrives as a rejection rather than a throw. Caught here so the
            //"Exporting..." popup always comes back down - unhandled, it would sit over the reader
            //forever.
            logError(err);
            hideWorking();
            cback();
          });
        });
      }
      else{
        cback();
      }
    });
  }

  module.exports = showExportOptions;