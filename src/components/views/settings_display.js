function showSettings(docsDir){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var settingsHeader = document.createElement('h1');
  settingsHeader.innerText = "Settings";
  popup.appendChild(settingsHeader);

  var settingsForm = document.createElement('form');

  var backupDirLabel = document.createElement('label');
  backupDirLabel.innerText = "Backups Directory: ";
  settingsForm.appendChild(backupDirLabel);

  var backupDirInput = document.createElement('input');
  backupDirInput.type = "text";
  backupDirInput.value = userSettings.backupDirectory ? userSettings.backupDirectory : "";
  backupDirInput.id = 'backup-dir-input';
  settingsForm.appendChild(backupDirInput);

  var backupDirPicker = createButton("Change...");
  backupDirPicker.onclick = function(){
    var defaultDir = backupDirInput.value != "" ? backupDirInput.value : docsDir;
    var chosenDir = promptToChooseDirectory(defaultDir);
    backupDirInput.value = chosenDir;
  }
  settingsForm.appendChild(backupDirPicker);

  settingsForm.appendChild(document.createElement('br'));

  var autoBackupLabel = document.createElement('label');
  autoBackupLabel.innerText = 'Auto Backup On Close: ';
  settingsForm.appendChild(autoBackupLabel);

  var autoBackupCheck = document.createElement('input');
  autoBackupCheck.type = 'checkbox';
  autoBackupCheck.checked = userSettings.autoBackup;
  settingsForm.appendChild(autoBackupCheck);

  settingsForm.appendChild(document.createElement('br'));

  var backupsLimitLabel = document.createElement('label');
  backupsLimitLabel.innerText = 'Quantity of latest backups to keep? (0=infinite): ';
  settingsForm.appendChild(backupsLimitLabel);

  var backupLimitInput = document.createElement('input');
  backupLimitInput.type = 'number';
  backupLimitInput.min = 0;
  backupLimitInput.value = userSettings.backupsToKeep;
  settingsForm.appendChild(backupLimitInput);

  settingsForm.appendChild(document.createElement('br'));

  var autosaveLabel = document.createElement('label');
  autosaveLabel.innerText = 'Autosave every X minutes (0=never): ';
  settingsForm.appendChild(autosaveLabel);

  var autosaveIntervalInput = document.createElement('input');
  autosaveIntervalInput.type = 'number';
  autosaveIntervalInput.min = 0;
  autosaveIntervalInput.value = userSettings.autosaveInterval;
  settingsForm.appendChild(autosaveIntervalInput);

  popup.appendChild(settingsForm);

  var saveBackupDir = createButton("Save");
  saveBackupDir.onclick = function(){
    if(backupDirInput.value != ""){
      userSettings.backupDirectory = convertFilepath(backupDirInput.value);
    }
    userSettings.autoBackup = autoBackupCheck.checked;
    userSettings.backupsToKeep = backupLimitInput.value;
    userSettings.autosaveInterval = autosaveIntervalInput.value;
    userSettings.save();
    updateAutosave();
    closePopups();
  }
  popup.appendChild(saveBackupDir);

  var closeBtn = createButton("Close");
  closeBtn.onclick = function(){
    closePopups();
  };
  popup.appendChild(closeBtn);

  closeBtn.focus();

  document.body.appendChild(popup);
}

function promptToChooseDirectory(defPath){
  //TODO: Known electron bug causes this to appear BEHIND screen after one successful use.
  //Consider replacing with own filepicker entirely
  const options = {
    title: 'Choose Backups Directory...',
    defaultPath: defPath,
    properties: ['openDirectory']
  };

  var filepath = dialog.showOpenDialogSync(options);
  return filepath ? filepath : "";
}
