function showSettings(sysDirectories, callback){
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
    var defaultDir = backupDirInput.value != "" ? backupDirInput.value : sysDirectories.docs;
    promptToChooseDirectory(defaultDir, sysDirectories, function(dirpath){
      backupDirInput.value = dirpath;
    });

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

  settingsForm.appendChild(document.createElement('br'));

  var darkModeLabel = document.createElement('label');
  darkModeLabel.innerText = 'Dark Mode: ';
  settingsForm.appendChild(darkModeLabel);

  settingsForm.appendChild(document.createElement('br'));

  var darkModeSys = document.createElement('input');
  darkModeSys.type = 'radio';
  darkModeSys.name = 'dark-mode';
  darkModeSys.value = 'system';
  darkModeSys.id = 'dark-mode-sys';
  if(userSettings.darkMode == 'system')
    darkModeSys.checked = true;
  settingsForm.appendChild(darkModeSys);

  var darkModeSysLabel = document.createElement('label');
  darkModeSysLabel.innerText = "System Default";
  darkModeSysLabel.for = 'dark-mode-sys';
  settingsForm.appendChild(darkModeSysLabel);

  settingsForm.appendChild(document.createElement('br'));

  var darkModeDark = document.createElement('input');
  darkModeDark.type = 'radio';
  darkModeDark.name = 'dark-mode';
  darkModeDark.value = 'dark';
  darkModeDark.id = 'dark-mode-dark';
  if(userSettings.darkMode == 'dark')
    darkModeDark.checked = true;
  settingsForm.appendChild(darkModeDark);

  var darkModeDarkLabel = document.createElement('label');
  darkModeDarkLabel.innerText = "Dark";
  darkModeDarkLabel.for = 'dark-mode-dark';
  settingsForm.appendChild(darkModeDarkLabel);

  settingsForm.appendChild(document.createElement('br'));

  var darkModeLight = document.createElement('input');
  darkModeLight.type = 'radio';
  darkModeLight.name = 'dark-mode';
  darkModeLight.value = 'light';
  darkModeLight.id = 'dark-mode-light';
  if(userSettings.darkMode == 'light')
    darkModeLight.checked = true;
  settingsForm.appendChild(darkModeLight);

  var darkModeLightLabel = document.createElement('label');
  darkModeLightLabel.innerText = "Light";
  darkModeLightLabel.for = 'dark-mode-light';
  settingsForm.appendChild(darkModeLightLabel);

  settingsForm.appendChild(document.createElement('br'));

  var infoSet = document.createElement('fieldset');
  var infoLegend = document.createElement('legend');
  infoLegend.innerText = 'Author Info';
  infoSet.appendChild(infoLegend);

  var defAuthLab = document.createElement('label');
  defAuthLab.innerText = 'Default Author: ';
  infoSet.appendChild(defAuthLab);

  var defAuthIn = document.createElement('input');
  defAuthIn.type = 'text';
  defAuthIn.value = userSettings.defaultAuthor;
  infoSet.appendChild(defAuthIn);

  infoSet.appendChild(document.createElement('br'));

  var addressLab = document.createElement('label');
  addressLab.innerText = 'Address Info (for cover page export): ';
  infoSet.appendChild(addressLab);

  var addressIn = document.createElement('input');
  addressIn.type = 'text';
  addressIn.value = userSettings.addressInfo;
  infoSet.appendChild(addressIn);

  settingsForm.appendChild(infoSet);
  popup.appendChild(settingsForm);

  var saveBtn = createButton("Save");
  saveBtn.onclick = function(){
    if(backupDirInput.value != ""){
      userSettings.backupDirectory = convertFilepath(backupDirInput.value);
    }
    userSettings.autoBackup = autoBackupCheck.checked;
    userSettings.backupsToKeep = backupLimitInput.value;
    userSettings.autosaveInterval = autosaveIntervalInput.value;
    userSettings.darkMode = document.querySelector('input[type=radio][name=dark-mode]:checked').value;
    userSettings.defaultAuthor = defAuthIn.value;
    userSettings.addressInfo = addressIn.value;

    userSettings.save();
    updateAutosave();
    callback();
    closePopups();
  }
  popup.appendChild(saveBtn);

  var closeBtn = createButton("Close");
  closeBtn.onclick = function(){
    closePopups();
  };
  popup.appendChild(closeBtn);

  document.body.appendChild(popup);

  backupDirInput.focus();
}

function promptToChooseDirectory(defPath, sysDirectories, cback){
  const options = {
    title: 'Choose Backups Directory...',
    defaultPath: defPath,
    filters: [],
    bookmarkedPaths: [sysDirectories.docs, sysDirectories.home],
    dialogType: 'chooseDirectory'
  };

  showFileDialog(options, function(dirpath){
    cback(dirpath ? dirpath : "");
  })
}
