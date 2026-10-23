const { closePopups, createButton, removeElementsByClass, generateRow, describeDialog } = require('../controllers/utils');
const { listProjectBackups, restoreBackup } = require('../controllers/backup-project');
const { logError } = require('../controllers/error-log');

//Lists the backups in the Backups directory by date and unzips the chosen one, so going back to a
//backup no longer means finding it in the File Manager and unzipping it by hand. The restored copy
//is a separate project beside the archive it came from; the open project is left as it is.
//onRestore(projectPath) is handed the restored .woolf file to open.
async function showRestoreBackup(project, userSettings, onRestore){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var popupTitle = document.createElement('h1');
  popupTitle.innerText = 'Restore Backup';
  popup.appendChild(popupTitle);
  describeDialog(popup, popupTitle);

  var explanation = document.createElement('p');
  explanation.innerText = 'The backup opens as its own copy in the Backups folder, and the project you have open now'
    + ' is not changed. Use Save As to keep the restored copy somewhere else.';
  popup.appendChild(explanation);

  var backupTable = document.createElement('table');

  var allProjectsCheck = document.createElement('input');
  allProjectsCheck.type = 'checkbox';
  allProjectsCheck.id = 'restore-all-projects-check';
  //With no project open there is no "this project" to narrow to.
  allProjectsCheck.checked = !project.filename;

  var allProjectsLabel = document.createElement('label');
  allProjectsLabel.innerText = 'Show backups of every project: ';
  allProjectsLabel.htmlFor = allProjectsCheck.id;

  backupTable.appendChild(generateRow(allProjectsLabel, allProjectsCheck));

  var backupSelect = document.createElement('select');
  backupSelect.id = 'restore-backup-select';
  backupSelect.size = 12;

  var backupLabel = document.createElement('label');
  backupLabel.innerText = 'Backups (newest first): ';
  backupLabel.htmlFor = backupSelect.id;

  backupTable.appendChild(generateRow(backupLabel, backupSelect));
  popup.appendChild(backupTable);

  var errorText = document.createElement('p');
  errorText.classList.add('warning-text');
  popup.appendChild(errorText);

  var restoreBtn = createButton("<span class='access-key'>R</span>estore");
  restoreBtn.accessKey = 'r';
  restoreBtn.onclick = restoreSelected;
  popup.appendChild(restoreBtn);

  var close = createButton("Close");
  close.onclick = function(){
    closePopups();
  };
  popup.appendChild(close);

  backupSelect.onkeydown = function(e){
    if(e.key === 'Enter'){
      e.preventDefault();
      restoreSelected();
    }
  };
  backupSelect.ondblclick = restoreSelected;
  allProjectsCheck.onchange = fillList;

  document.body.appendChild(popup);
  await fillList();

  return popup;

  async function fillList(){
    backupSelect.innerHTML = '';
    errorText.innerText = '';

    var backups = [];
    if(userSettings.backupDirectory){
      try{
        backups = await listProjectBackups(userSettings.backupDirectory, allProjectsCheck.checked ? null : project.filename);
      }
      catch(err){
        logError(err);
        errorText.innerText = 'Could not read the Backups directory: ' + userSettings.backupDirectory;
      }
    }

    backups.forEach(function(backup){
      var op = document.createElement('option');
      op.value = backup.path;
      op.innerText = formatDate(backup.date) + (allProjectsCheck.checked ? ' - ' + backup.project : '');
      backupSelect.appendChild(op);
    });

    if(backups.length > 0){
      backupSelect.selectedIndex = 0;
      backupSelect.focus();
    }
    else{
      if(errorText.innerText === '')
        errorText.innerText = allProjectsCheck.checked || !project.filename
          ? 'There are no backups yet.'
          : 'This project has no backups yet.';
      (project.filename ? allProjectsCheck : close).focus();
    }
    restoreBtn.disabled = backups.length === 0;
  }

  async function restoreSelected(){
    if(backupSelect.selectedIndex < 0)
      return;

    var backupPath = backupSelect.value;
    restoreBtn.disabled = true;
    errorText.innerText = 'Restoring...';
    try{
      var projectPath = await restoreBackup(backupPath);
      closePopups();
      return onRestore(projectPath);
    }
    catch(err){
      logError(err);
      errorText.innerText = 'Could not restore that backup. ' + (err && err.message ? err.message : '');
      restoreBtn.disabled = false;
    }
  }
}

function formatDate(date){
  return date.toLocaleString(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit'
  });
}

module.exports = showRestoreBackup;
