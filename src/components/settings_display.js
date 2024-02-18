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

  var saveBackupDir = createButton("Save");
  saveBackupDir.onclick = function(){
    if(backupDirInput.value != ""){
      userSettings.backupDirectory = backupDirInput.value;
    }
    userSettings.save();
  }
  settingsForm.appendChild(saveBackupDir);

  popup.appendChild(settingsForm);

  var closeBtn = createButton("Close");
  closeBtn.onclick = function(){
    closePopups();
  };
  popup.appendChild(closeBtn);

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
