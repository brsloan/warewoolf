const { logError } = require('../controllers/error-log');

//Set once by render.js's loadPlatformState(), the same instance error-log.js uses. As of Phase 9a
//that is the ipc-backed one: loadUserSettings()/saveUserSettings() were plain fs reachable straight
//through nodeIntegration, and are now a round trip to the main process like everything else.
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

    return platform.saveUserSettings({ settings: persistableSettings() }).catch(function(err){
      logError(err);
    });
  }

  //The live object carries save/load/getSettingsFilepath alongside the settings themselves, and a
  //function does not survive being sent anywhere: structured clone throws on one outright, so
  //passing `settings` whole rejects every save the moment the write is on the far side of a bridge.
  //It went unnoticed while the write was a JSON.stringify in this same process - stringify drops
  //functions silently, so the file on disk was always right.
  //
  //The schema is already the list of what may be persisted (see the note on it above: a key not
  //named there can never be copied back onto the live object on load), so this sends exactly that
  //and nothing else - which is also what makes the payload data rather than a live model object.
  function persistableSettings(){
    var persistable = {};

    Object.keys(SETTINGS_SCHEMA).forEach(function(key){
      persistable[key] = settings[key];
    });

    return persistable;
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