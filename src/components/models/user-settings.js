const { logError } = require('../controllers/error-log');

//Set once by render.js's loadPlatformState(), the same node-backed instance error-log.js uses -
//loadUserSettings()/saveUserSettings() are plain fs, reachable directly through nodeIntegration
//like groups B, C and D's error-log slice, so there is nothing to swap here until Phase 9.
let platform = null;

function setPlatform(p){
  platform = p;
}

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

  //Async now that writing goes through the platform facade, but stays fire-and-forget like
  //logError - nearly every call site (togglePanelDisplay, increaseFontSizeSetting, and the rest)
  //calls this and moves on without awaiting. The promise is returned anyway, purely so a test can
  //await a specific call, and it is always caught here first so a failed write can never surface as
  //an unhandled rejection.
  function save(){
    if(platform == null)
      return Promise.resolve();

    return platform.saveUserSettings({ settings: settings }).catch(function(err){
      logError(err);
    });
  }

  //Catches internally and always resolves to `settings` - a corrupt or missing file falls back to
  //the current (default) values exactly as the old synchronous try/catch did, rather than rejecting.
  function load(){
    if(platform == null)
      return Promise.resolve(settings);

    return platform.loadUserSettings().then(function(settingsFile){
      if(settingsFile != null)
        applySettings(settingsFile);
      return settings;
    }).catch(function(err){
      logError(err);
      return settings;
    });
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
module.exports.setPlatform = setPlatform;