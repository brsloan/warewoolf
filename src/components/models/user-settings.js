const fs = require('fs');
const { logError } = require('../controllers/error-log');

function getUserSettings(userSettingsFilepath){
  return {
    editorWidth: 50,
    fontSize: 12,
    typewriterMode: false,
    displayChapList: true,
    displayEditor: true,
    displayNotes: true,
    lastProject: null,
    defaultAuthor: '',
    addressInfo: '',
    senderEmail: null,
    senderPass: null,
    receiverEmail: null,
    emailType: 'project',
    compileType: '.docx',
    compileChapMark: '',
    compileInsertHeaders: false,
    compileGenTitlePage: true,
    backupDirectory: null,
    autoBackup: true,
    backupsToKeep: 10,
    autosaveIntMinutes: 0,
    darkMode: 'system',
    showBattery: false,
    displayChapNotes: true,
    save: save,
    load: load,
    getSettingsFilepath: getSettingsFilepath
  };

  function save(){
    var settings = this;

    var fileString = JSON.stringify(settings, null, '\t');

    try{
      fs.writeFileSync(userSettingsFilepath, fileString, 'utf8');
    }
    catch(err){
      logError(err);
    }
  }

  function load(){

    try{
      if(fs.existsSync(userSettingsFilepath)){
        var settingsFile = JSON.parse(fs.readFileSync(userSettingsFilepath, "utf8"));
        Object.assign(this, settingsFile);
      }
    }
    catch(err){
      logError(err);
    }
    return this;
  }

  function getSettingsFilepath(){
    return userSettingsFilepath;
  }

}

module.exports = getUserSettings;