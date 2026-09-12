const { logError } = require('../controllers/error-log');
const { sanitizeOverrides } = require('./shortcuts');
const { sanitizeAutocorrect } = require('./autocorrect');
const { sanitizeFontId, DEFAULT_FONT_ID, DEFAULT_SIDEBAR_FONT_ID } = require('./fonts');
const { sanitizeLineHeightId, DEFAULT_LINE_HEIGHT_ID } = require('./line-heights');

//Unlike sanitizeOverrides/sanitizeAutocorrect, there is no fixed id list to check entries against -
//a valid id is whatever listDictionaries() (group I) finds on disk, which this module has no way to
//ask. So this only enforces the shape (an array of non-empty strings) and leaves an id that no
//longer exists to loadDictionaries' own skip-and-fall-back behavior rather than trying to catch it
//here.
function sanitizeDictionaryIds(raw){
  if(!Array.isArray(raw))
    return [];

  return raw.filter(function(id){ return typeof id === 'string' && id !== ''; });
}

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
//
//A field may also carry a `sanitize` function, for the cases a type name cannot describe:
//keyboardShortcuts and autocorrect are maps whose every entry has to be checked in its own right,
//since `object` would wave through an array, or a map of bindings no key could ever produce. Where
//one is given it replaces the type check entirely and its return value is what lands on the object,
//so it must be total - shortcuts.js's sanitizeOverrides and autocorrect.js's sanitizeAutocorrect
//both answer with {} (meaning "all defaults") for anything they cannot make sense of, rather than
//throwing or handing back a partial map.
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
  markSceneBreaks: { type: 'boolean' },
  backupDirectory: { type: 'string', nullable: true },
  autoBackup: { type: 'boolean' },
  backupsToKeep: { type: 'number' },
  autosaveIntMinutes: { type: 'number' },
  darkMode: { type: 'string' },
  showBattery: { type: 'boolean' },
  displayChapNotes: { type: 'boolean' },
  keyboardShortcuts: { type: 'object', sanitize: sanitizeOverrides },
  autocorrectEnabled: { type: 'boolean' },
  autocorrect: { type: 'object', sanitize: sanitizeAutocorrect },
  spellcheckDictionaries: { type: 'object', sanitize: sanitizeDictionaryIds },
  wordsPerPage: { type: 'number' },
  editorFont: { type: 'string', sanitize: sanitizeFontId },
  //Its own sanitizer rather than sanitizeFontId itself, because the sidebars' default is not the
  //manuscript's: an unreadable id here has to land on Sans, the face a fresh install's sidebars are
  //drawn in, not on the serif the manuscript falls back to.
  sidebarFont: { type: 'string', sanitize: function(raw){ return sanitizeFontId(raw, DEFAULT_SIDEBAR_FONT_ID); } },
  editorLineHeight: { type: 'string', sanitize: sanitizeLineHeightId }
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
    //Shared by Compile and Export rather than named after either, since it is the same manuscript
    //convention whichever way the book leaves WareWoolf - a writer who marks their scene breaks
    //wants them marked in both. Off by default: a hash on a blank line is a change to the text.
    markSceneBreaks: false,
    backupDirectory: null,
    autoBackup: true,
    backupsToKeep: 10,
    autosaveIntMinutes: 0,
    darkMode: 'system',
    showBattery: false,
    displayChapNotes: true,
    //Only the shortcuts a writer has actually changed, keyed by the action ids in shortcuts.js -
    //never the whole map. An action missing from here is on its default, which is what lets a
    //default changed in a later version reach a writer who never touched that shortcut.
    keyboardShortcuts: {},
    //The master switch for the editors' automatic substitutions - smart quotes, em dashes and the
    //rest. On by default: a writer who wants none of it turns this off once rather than clearing
    //every rule.
    autocorrectEnabled: true,
    //And, exactly like keyboardShortcuts above, only the individual rules a writer has actually
    //changed, keyed by the ids in autocorrect.js. A rule missing from here is on its default.
    autocorrect: {},
    //Ids of the dictionaries a writer ticked in the Dictionaries dialog. Empty means "whatever the
    //app ships as default" - see loadDictionaries' own fallback (platform.js, group I) - so a writer
    //who never opens that dialog keeps working after an update that changes the bundled default.
    spellcheckDictionaries: [],
    //The divisor behind the Word Count dialog's page estimates. A writer's own manuscript format
    //decides this - 300 is the standard double-spaced manuscript page - so it lives here rather
    //than on the project, and follows the writer from one book to the next.
    wordsPerPage: 300,
    //Which of fonts.js's typefaces the manuscript and the sidebars are drawn in, by id. The
    //manuscript starts on DEFAULT_FONT_ID, the face WareWoolf drew everything in before either of
    //these existed, so the page a writer is actually reading looks exactly as it did. The sidebars
    //start on Sans instead - see DEFAULT_SIDEBAR_FONT_ID in fonts.js - since a chapter list is
    //glanced down rather than read. Both are stored as an id rather than a font-family string so
    //that user-settings.json can never put arbitrary css into a declaration, and so that a later
    //version may improve a stack's fallbacks for everyone.
    editorFont: DEFAULT_FONT_ID,
    sidebarFont: DEFAULT_SIDEBAR_FONT_ID,
    //How far apart the manuscript's lines are set, by id - see models/line-heights.js. Only the
    //manuscript: the chapter list and the notes are columns to glance down rather than prose to
    //read, and they stay on the spacing index.css gives them. Starts on DEFAULT_LINE_HEIGHT_ID,
    //which is the double spacing the editor was already drawn at, and is stored as an id for the
    //same reasons the two font settings above are.
    editorLineHeight: DEFAULT_LINE_HEIGHT_ID,
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
  //A sanitized field is sanitized on the way out as well as in. Not defensiveness for its own
  //sake: this payload has to survive a structured clone, and one unexpected value in
  //keyboardShortcuts (a function, most obviously) would reject the save of every OTHER setting
  //alongside it. The sanitizer only ever returns plain data, so running it here means that
  //cannot happen whatever a caller has left on the live object.
  function persistableSettings(){
    var persistable = {};

    Object.keys(SETTINGS_SCHEMA).forEach(function(key){
      var schema = SETTINGS_SCHEMA[key];

      persistable[key] = schema.sanitize ? schema.sanitize(settings[key]) : settings[key];
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

      //A field with its own sanitizer is checked entry by entry rather than by type, and takes
      //whatever that returns - including for a value the type check would have rejected outright,
      //since the sanitizer's answer for those (an empty map) is the meaningful one.
      if(schema.sanitize){
        settings[key] = schema.sanitize(value);
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
module.exports.sanitizeDictionaryIds = sanitizeDictionaryIds;