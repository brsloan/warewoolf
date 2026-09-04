const fs = require('fs');
const { logError } = require('../controllers/error-log');

//Each field's expected type, keyed by name. A hand-edited or corrupted user-settings.json is only
//ever merged through this schema on load: a value of the wrong type is skipped (the previous/default
//value survives), and a key that isn't listed here - including save/load/getSettingsFilepath - can
//never be copied onto the live object. senderPass holds an {iv, content} blob before migration (see
//credential-store.js migrateLegacyPassword) and is null afterward, hence the 'object' type.
const SETTINGS_SCHEMA = {
  editorWidth: { type: 'number' },
  fontSize: { type: 'number' },
  typewriterMode: { type: 'boolean' },
  displayChapList: { type: 'boolean' },
  displayEditor: { type: 'boolean' },
  displayNotes: { type: 'boolean' },
  lastProject: { type: 'string', nullable: true },
  defaultAuthor: { type: 'string' },
  addressInfo: { type: 'string' },
  senderEmail: { type: 'string', nullable: true },
  senderPass: { type: 'object', nullable: true },
  receiverEmail: { type: 'string', nullable: true },
  emailType: { type: 'string' },
  compileType: { type: 'string' },
  compileChapMark: { type: 'string' },
  compileInsertHeaders: { type: 'boolean' },
  compileGenTitlePage: { type: 'boolean' },
  backupDirectory: { type: 'string', nullable: true },
  autoBackup: { type: 'boolean' },
  backupsToKeep: { type: 'number' },
  autosaveIntMinutes: { type: 'number' },
  darkMode: { type: 'string' },
  showBattery: { type: 'boolean' },
  displayChapNotes: { type: 'boolean' }
};

function getUserSettings(userSettingsFilepath){
  var settings = {
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

  return settings;

  function save(){
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
        applySettings(settingsFile);
      }
    }
    catch(err){
      logError(err);
    }
    return settings;
  }

  function applySettings(settingsFile){
    if(settingsFile == null || typeof settingsFile !== 'object')
      return;

    Object.keys(SETTINGS_SCHEMA).forEach(function(key){
      if(!(key in settingsFile))
        return;

      var value = settingsFile[key];
      var schema = SETTINGS_SCHEMA[key];

      if(schema.nullable && value === null){
        settings[key] = null;
        return;
      }

      if(typeof value === schema.type)
        settings[key] = value;
    });
  }

  function getSettingsFilepath(){
    return userSettingsFilepath;
  }

}

module.exports = getUserSettings;