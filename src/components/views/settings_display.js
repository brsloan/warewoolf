const { closePopups, createButton, removeElementsByClass, convertFilepath, generateRow, describeDialog } = require('../controllers/utils');
const { showBattery, removeBattery } = require('./battery_display');
const showFileDialog = require('./file-dialog_display');
const { getAutocorrectDefs, resolveAutocorrect, diffFromDefaults } = require('../models/autocorrect');
const { getFontDefs, resolveFontStack, sanitizeFontId } = require('../models/fonts');

function showSettings(userSettings, autosaver, sysDirectories, autosaveProject, callback, platformInfo){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var settingsHeader = document.createElement('h1');
  settingsHeader.innerText = "Settings";
  popup.appendChild(settingsHeader);
  describeDialog(popup, settingsHeader);

  var settingsForm = document.createElement('form');

  var infoSet = document.createElement('fieldset');
  var infoLegend = document.createElement('legend');
  infoLegend.innerText = 'Author Info';
  infoSet.appendChild(infoLegend);

  var defAuthLab = document.createElement('label');
  defAuthLab.innerText = 'Default Author: ';
  defAuthLab.htmlFor = 'default-author-input';
  infoSet.appendChild(defAuthLab);

  var defAuthIn = document.createElement('input');
  defAuthIn.type = 'text';
  defAuthIn.id = 'default-author-input';
  defAuthIn.value = userSettings.defaultAuthor;
  infoSet.appendChild(defAuthIn);

  infoSet.appendChild(document.createElement('br'));

  var addressLab = document.createElement('label');
  addressLab.innerText = 'Address Info (for cover page export): ';
  addressLab.htmlFor = 'address-info-input';
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
  backupDirLabel.htmlFor = 'backup-dir-input';
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
  autoBackupLabel.htmlFor = 'auto-backup-check';

  var autoBackupCheck = document.createElement('input');
  autoBackupCheck.type = 'checkbox';
  autoBackupCheck.id = 'auto-backup-check';
  autoBackupCheck.checked = userSettings.autoBackup;

  backupTbl.appendChild(generateRow(autoBackupLabel, autoBackupCheck));

  var backupsLimitLabel = document.createElement('label');
  backupsLimitLabel.innerText = 'Latest backups to keep (0=infinite): ';
  backupsLimitLabel.htmlFor = 'backups-to-keep-input';

  var backupLimitInput = document.createElement('input');
  backupLimitInput.id = 'backups-to-keep-input';
  backupLimitInput.type = 'number';
  backupLimitInput.min = 0;
  backupLimitInput.value = userSettings.backupsToKeep;
  backupLimitInput.classList.add('number-ticker');

  backupTbl.appendChild(generateRow(backupsLimitLabel, backupLimitInput));

  var autosaveLabel = document.createElement('label');
  autosaveLabel.innerText = 'Autosave every X minutes (0=never): ';
  autosaveLabel.htmlFor = 'autosave-interval-input';

  var autosaveIntervalInput = document.createElement('input');
  autosaveIntervalInput.id = 'autosave-interval-input';
  autosaveIntervalInput.type = 'number';
  autosaveIntervalInput.min = 0;
  autosaveIntervalInput.value = userSettings.autosaveIntMinutes;
  autosaveIntervalInput.classList.add('number-ticker');

  backupTbl.appendChild(generateRow(autosaveLabel, autosaveIntervalInput));

  saveSet.appendChild(backupTbl);
  settingsForm.appendChild(saveSet);

  var substitutionSet = document.createElement('fieldset');
  var substitutionLeg = document.createElement('legend');
  substitutionLeg.innerText = 'Automatic Substitutions';
  substitutionSet.appendChild(substitutionLeg);

  var substitutionTbl = document.createElement('table');

  var autocorrectLabel = document.createElement('label');
  autocorrectLabel.innerText = 'Substitute As I Type: ';
  autocorrectLabel.htmlFor = 'autocorrect-check';

  var autocorrectCheck = document.createElement('input');
  autocorrectCheck.type = 'checkbox';
  autocorrectCheck.id = 'autocorrect-check';
  autocorrectCheck.checked = userSettings.autocorrectEnabled;

  substitutionTbl.appendChild(generateRow(autocorrectLabel, autocorrectCheck));

  //Shown as what is in force - the defaults with the writer's saved changes over them - rather
  //than as the stored overrides, which are only the handful that differ.
  var rules = resolveAutocorrect(userSettings.autocorrect);
  var ruleChecks = {};

  getAutocorrectDefs().forEach(function(def){
    var ruleLabel = document.createElement('label');
    ruleLabel.innerText = def.label + ' (' + def.example + '): ';
    ruleLabel.htmlFor = 'autocorrect-' + def.id;

    var ruleCheck = document.createElement('input');
    ruleCheck.type = 'checkbox';
    ruleCheck.id = 'autocorrect-' + def.id;
    ruleCheck.checked = rules[def.id];

    ruleChecks[def.id] = ruleCheck;
    substitutionTbl.appendChild(generateRow(ruleLabel, ruleCheck));
  });

  //A rule means nothing while the master switch is off, so the list greys out rather than sitting
  //there looking as though it still decides something. Disabled, not cleared: a writer who turns
  //substitutions back on gets the rules they had chosen, since Save reads .checked either way.
  autocorrectCheck.onchange = updateRuleAvailability;
  updateRuleAvailability();

  substitutionSet.appendChild(substitutionTbl);
  settingsForm.appendChild(substitutionSet);

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
  if(userSettings.darkMode == 'system' || (userSettings.darkMode != 'dark' && userSettings.darkMode != 'light'))
    darkModeSys.checked = true;
  appearanceSet.appendChild(darkModeSys);

  var darkModeSysLabel = document.createElement('label');
  darkModeSysLabel.innerText = "System Default";
  darkModeSysLabel.htmlFor = 'dark-mode-sys';
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
  darkModeDarkLabel.htmlFor = 'dark-mode-dark';
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
  darkModeLightLabel.htmlFor = 'dark-mode-light';
  appearanceSet.appendChild(darkModeLightLabel);

  appearanceSet.appendChild(document.createElement('hr'));

  var fontTbl = document.createElement('table');

  //Two pickers rather than one, because the two columns are read differently: the manuscript is
  //read the way the finished book will be, and the sidebars are scanned for a chapter title. A
  //writer who wants one face everywhere still only has to set the same thing twice, once.
  var editorFontSelect = addFontPicker(fontTbl, 'editor-font', 'Manuscript Font: ', userSettings.editorFont);
  var sidebarFontSelect = addFontPicker(fontTbl, 'sidebar-font', 'Sidebar Font (chapter list and notes): ', userSettings.sidebarFont);

  appearanceSet.appendChild(fontTbl);

  settingsForm.appendChild(appearanceSet);

  var batterySet = document.createElement('fieldset');
  var battLegend = document.createElement('legend');
  battLegend.innerText = 'Battery';
  batterySet.appendChild(battLegend);

  var batteryDisplayLabel = document.createElement('label');
  batteryDisplayLabel.innerText = 'Display Battery Charge ';
  batteryDisplayLabel.htmlFor = 'battery-display-check';
  batterySet.appendChild(batteryDisplayLabel);

  var batteryDisplayCheck = document.createElement('input');
  batteryDisplayCheck.type = 'checkbox';
  batteryDisplayCheck.id = 'battery-display-check';
  batteryDisplayCheck.name = 'battery-display-check';
  batteryDisplayCheck.checked = userSettings.showBattery;
  batterySet.appendChild(batteryDisplayCheck);

  if(platformInfo.platform == 'linux'){
    settingsForm.appendChild(batterySet);
  }

  popup.appendChild(settingsForm);

  var saveBtn = createButton("Save");
  saveBtn.onclick = function(){
    if(backupDirInput.value != ""){
      userSettings.backupDirectory = convertFilepath(backupDirInput.value);
    }
    userSettings.autoBackup = autoBackupCheck.checked;
    userSettings.backupsToKeep = Number(backupLimitInput.value) || 0;
    userSettings.autosaveIntMinutes = Number(autosaveIntervalInput.value) || 0;
    userSettings.darkMode = document.querySelector('input[type=radio][name=dark-mode]:checked').value;
    //Through sanitizeFontId on the way out as well as on the way in: the value of a <select> is a
    //string from the DOM, and this is the one field whose value goes straight into a css
    //font-family declaration.
    userSettings.editorFont = sanitizeFontId(editorFontSelect.value);
    userSettings.sidebarFont = sanitizeFontId(sidebarFontSelect.value);
    userSettings.defaultAuthor = defAuthIn.value;
    userSettings.addressInfo = addressIn.value;
    userSettings.autocorrectEnabled = autocorrectCheck.checked;
    //Stored as only what differs from the defaults - see diffFromDefaults in models/autocorrect.js.
    userSettings.autocorrect = diffFromDefaults(checkedRules());
    if(platformInfo.platform == 'linux'){
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
    autosaver.updateAutosave(userSettings.autosaveIntMinutes, autosaveProject);
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

  function updateRuleAvailability(){
    Object.keys(ruleChecks).forEach(function(id){
      ruleChecks[id].disabled = !autocorrectCheck.checked;
    });
  }

  //One setting: a labelled dropdown of every face fonts.js knows, and directly beneath it a line of
  //sample text in whichever is chosen. Two rows rather than one, the sample spanning both columns,
  //so a sample sits under the picker it belongs to instead of the pair of them collecting at the
  //bottom where neither says which is which. Returns the select, which is what Save reads.
  function addFontPicker(table, idPrefix, labelText, selected){
    var select = buildFontSelect(idPrefix + '-select', selected);
    var label = document.createElement('label');
    label.innerText = labelText;
    label.htmlFor = select.id;
    table.appendChild(generateRow(label, select));

    var sampleRow = document.createElement('tr');
    var sampleCell = document.createElement('td');
    sampleCell.colSpan = 2;
    sampleCell.appendChild(buildFontSample(idPrefix + '-sample', select));
    sampleRow.appendChild(sampleCell);
    table.appendChild(sampleRow);

    return select;
  }

  //A dropdown of every face in fonts.js, with each option drawn in the face it names so the list
  //itself is the specimen sheet. `selected` is whatever is in user settings, run through
  //sanitizeFontId so an id this version does not know lands on the default rather than leaving the
  //select showing its first option while the app is drawn in something else.
  function buildFontSelect(id, selected){
    var select = document.createElement('select');
    select.id = id;

    getFontDefs().forEach(function(def){
      var option = document.createElement('option');
      option.value = def.id;
      option.innerText = def.label;
      option.style.fontFamily = def.stack;
      select.appendChild(option);
    });

    select.value = sanitizeFontId(selected);

    return select;
  }

  //WareWoolf ships no font files, so a face is only ever the best one of its stack a writer happens
  //to have installed, and there is no honest way to say which that is in the dropdown. The sample
  //answers it by showing the result: whatever is drawn here is what the panel will be drawn in.
  //
  //A pangram, because what is being shown is the shape of the letters and a pangram is the shortest
  //way to show all of them. Marked aria-hidden: it is the same information the selected option
  //already carries by name, and read aloud it is a sentence about a fox.
  function buildFontSample(id, select){
    var sample = document.createElement('p');
    sample.id = id;
    sample.classList.add('font-sample');
    sample.innerText = 'The quick brown fox jumps over the lazy dog.';
    sample.setAttribute('aria-hidden', 'true');

    select.addEventListener('change', updateSample);
    updateSample();

    return sample;

    function updateSample(){
      sample.style.fontFamily = resolveFontStack(select.value);
    }
  }

  function checkedRules(){
    var checked = {};

    Object.keys(ruleChecks).forEach(function(id){
      checked[id] = ruleChecks[id].checked;
    });

    return checked;
  }
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