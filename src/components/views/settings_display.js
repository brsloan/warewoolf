const { closePopups, createButton, removeElementsByClass, convertFilepath, generateRow } = require('../controllers/utils');
const { showBattery, removeBattery } = require('./battery_display');

function showSettings(userSettings, autosaver, sysDirectories, callback){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var settingsHeader = document.createElement('h1');
  settingsHeader.innerText = "Settings";
  popup.appendChild(settingsHeader);

  var settingsForm = document.createElement('form');

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

  var addressIn = document.createElement('textarea');
  addressIn.rows = 5;
  addressIn.value = userSettings.addressInfo;
  addressIn.placeholder = '123 Main Street\nWinseburg, Ohio 46041\n555-555-0123\nemail@warewoolf.org';
  addressIn.id = 'address-info-input';
  infoSet.appendChild(addressIn);

  settingsForm.appendChild(infoSet);

  var saveSet = document.createElement('fieldset');
  var saveSetLeg = document.createElement('legend');
  saveSetLeg.innerText = 'Saving';
  saveSet.appendChild(saveSetLeg);

  var backupDirLabel = document.createElement('label');
  backupDirLabel.innerText = "Backups Directory: ";
  saveSet.appendChild(backupDirLabel);

  saveSet.appendChild(document.createElement('br'));

  var backupDirInput = document.createElement('input');
  backupDirInput.type = "text";
  backupDirInput.value = userSettings.backupDirectory ? userSettings.backupDirectory : "";
  backupDirInput.id = 'backup-dir-input';
  saveSet.appendChild(backupDirInput);

  var backupDirPicker = createButton("Change...");
  backupDirPicker.onclick = function(){
    var defaultDir = backupDirInput.value != "" ? backupDirInput.value : sysDirectories.docs;
    promptToChooseDirectory(defaultDir, sysDirectories, function(dirpath){
      backupDirInput.value = dirpath;
    });

  }
  saveSet.appendChild(backupDirPicker);

  saveSet.appendChild(document.createElement('br'));

  var backupTbl = document.createElement('table');

  var autoBackupLabel = document.createElement('label');
  autoBackupLabel.innerText = 'Auto Backup On Close: ';

  var autoBackupCheck = document.createElement('input');
  autoBackupCheck.type = 'checkbox';
  autoBackupCheck.checked = userSettings.autoBackup;

  backupTbl.appendChild(generateRow(autoBackupLabel, autoBackupCheck));

  var backupsLimitLabel = document.createElement('label');
  backupsLimitLabel.innerText = 'Latest backups to keep (0=infinite): ';

  var backupLimitInput = document.createElement('input');
  backupLimitInput.type = 'number';
  backupLimitInput.min = 0;
  backupLimitInput.value = userSettings.backupsToKeep;
  backupLimitInput.classList.add('number-ticker');

  backupTbl.appendChild(generateRow(backupsLimitLabel, backupLimitInput));

  var autosaveLabel = document.createElement('label');
  autosaveLabel.innerText = 'Autosave every X minutes (0=never): ';

  var autosaveIntervalInput = document.createElement('input');
  autosaveIntervalInput.type = 'number';
  autosaveIntervalInput.min = 0;
  autosaveIntervalInput.value = userSettings.autosaveIntMinutes;
  autosaveIntervalInput.classList.add('number-ticker');

  backupTbl.appendChild(generateRow(autosaveLabel, autosaveIntervalInput));

  saveSet.appendChild(backupTbl);
  settingsForm.appendChild(saveSet);

  var appearanceSet = document.createElement('fieldset');
  var appearanceLeg = document.createElement('legend');
  appearanceLeg.innerText = "Appearance";
  appearanceSet.appendChild(appearanceLeg);

  var darkModeLabel = document.createElement('label');
  darkModeLabel.innerText = 'Dark Mode: ';
  appearanceSet.appendChild(darkModeLabel);

  appearanceSet.appendChild(document.createElement('br'));

  var darkModeSys = document.createElement('input');
  darkModeSys.type = 'radio';
  darkModeSys.name = 'dark-mode';
  darkModeSys.value = 'system';
  darkModeSys.id = 'dark-mode-sys';
  if(userSettings.darkMode == 'system')
    darkModeSys.checked = true;
  appearanceSet.appendChild(darkModeSys);

  var darkModeSysLabel = document.createElement('label');
  darkModeSysLabel.innerText = "System Default";
  darkModeSysLabel.for = 'dark-mode-sys';
  appearanceSet.appendChild(darkModeSysLabel);

  appearanceSet.appendChild(document.createElement('br'));

  var darkModeDark = document.createElement('input');
  darkModeDark.type = 'radio';
  darkModeDark.name = 'dark-mode';
  darkModeDark.value = 'dark';
  darkModeDark.id = 'dark-mode-dark';
  if(userSettings.darkMode == 'dark')
    darkModeDark.checked = true;
  appearanceSet.appendChild(darkModeDark);

  var darkModeDarkLabel = document.createElement('label');
  darkModeDarkLabel.innerText = "Dark";
  darkModeDarkLabel.for = 'dark-mode-dark';
  appearanceSet.appendChild(darkModeDarkLabel);

  appearanceSet.appendChild(document.createElement('br'));

  var darkModeLight = document.createElement('input');
  darkModeLight.type = 'radio';
  darkModeLight.name = 'dark-mode';
  darkModeLight.value = 'light';
  darkModeLight.id = 'dark-mode-light';
  if(userSettings.darkMode == 'light')
    darkModeLight.checked = true;
  appearanceSet.appendChild(darkModeLight);

  var darkModeLightLabel = document.createElement('label');
  darkModeLightLabel.innerText = "Light";
  darkModeLightLabel.for = 'dark-mode-light';
  appearanceSet.appendChild(darkModeLightLabel);

  settingsForm.appendChild(appearanceSet);

  var batterySet = document.createElement('fieldset');
  var battLegend = document.createElement('legend');
  battLegend.innerText = 'Battery';
  batterySet.appendChild(battLegend);

  var batteryDisplayLabel = document.createElement('label');
  batteryDisplayLabel.innerText = 'Display Battery Charge ';
  batteryDisplayLabel.for = 'battery-display-check';
  batterySet.appendChild(batteryDisplayLabel);

  var batteryDisplayCheck = document.createElement('input');
  batteryDisplayCheck.type = 'checkbox';
  batteryDisplayCheck.id = 'battery-display-check';
  batteryDisplayCheck.name = 'battery-display-check';
  batteryDisplayCheck.checked = userSettings.showBattery;
  batterySet.appendChild(batteryDisplayCheck);

  if(process.platform == 'linux'){
    settingsForm.appendChild(batterySet);
  }

  popup.appendChild(settingsForm);

  var saveBtn = createButton("Save");
  saveBtn.onclick = function(){
    if(backupDirInput.value != ""){
      userSettings.backupDirectory = convertFilepath(backupDirInput.value);
    }
    userSettings.autoBackup = autoBackupCheck.checked;
    userSettings.backupsToKeep = backupLimitInput.value;
    userSettings.autosaveIntMinutes = autosaveIntervalInput.value;
    userSettings.darkMode = document.querySelector('input[type=radio][name=dark-mode]:checked').value;
    userSettings.defaultAuthor = defAuthIn.value;
    userSettings.addressInfo = addressIn.value;
    if(process.platform == 'linux'){
      if(userSettings.showBattery && batteryDisplayCheck.checked == false){
        userSettings.showBattery = batteryDisplayCheck.checked;
        removeBattery();
      }
      else if(userSettings.showBattery == false && batteryDisplayCheck.checked == true){
        userSettings.showBattery = batteryDisplayCheck.checked;
        showBattery();
      }
    }

    userSettings.save();
    autosaver.updateAutosave(userSettings.autosaveIntMinutes, saveProject);
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

  defAuthIn.focus();
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

module.exports = showSettings;