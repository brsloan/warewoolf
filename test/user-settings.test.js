const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const errorLog = require('../src/components/controllers/error-log');
const { createPlatform } = require('../src/components/controllers/platform');
const { createNodeBacking } = require('../src/components/controllers/platform-node');
const getUserSettings = require('../src/components/models/user-settings');
const { createFakeBridge } = require('./fake-bridge');
const { createIpcBacking } = require('../src/components/controllers/platform-ipc');
const { DEFAULT_FONT_ID, DEFAULT_SIDEBAR_FONT_ID } = require('../src/components/models/fonts');
const { DEFAULT_LINE_HEIGHT_ID } = require('../src/components/models/line-heights');

//loadUserSettings()/saveUserSettings() are parameterless on the contract - the backing decides
//where the file lives, from paths.userData - so each test configures a node-backed platform
//pointed at its own temp directory rather than passing a path into getUserSettings() the way the
//old fs-direct version did. The filepath argument to getUserSettings() survives only as what
//getSettingsFilepath() echoes back for display; it plays no part in where the file actually lands.
function configurePlatform(t){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'user-settings-test-'));
  t.after(function(){
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const platform = createPlatform(createNodeBacking({ paths: { userData: dir } }));
  getUserSettings.setPlatform(platform);
  errorLog.setPlatform(platform);

  return dir;
}

function settingsPath(dir){
  return path.join(dir, 'user-settings.json');
}

test('a fresh settings object has the documented defaults', function(t){
  const dir = configurePlatform(t);
  const settings = getUserSettings(settingsPath(dir));

  assert.strictEqual(settings.editorWidth, 50);
  assert.strictEqual(settings.fontSize, 12);
  assert.strictEqual(settings.darkMode, 'system');
  assert.strictEqual(settings.lastProject, null);
});

test('save then load round-trips every field, including a changed value', async function(t){
  const dir = configurePlatform(t);
  const settings = getUserSettings(settingsPath(dir));

  settings.fontSize = 18;
  settings.lastProject = 'C:/books/novel.woolf';
  settings.autoBackup = false;
  await settings.save();

  const reloaded = await getUserSettings(settingsPath(dir)).load();

  assert.strictEqual(reloaded.fontSize, 18);
  assert.strictEqual(reloaded.lastProject, 'C:/books/novel.woolf');
  assert.strictEqual(reloaded.autoBackup, false);
});

test('load() on a file that does not exist yet leaves the defaults untouched', async function(t){
  const dir = configurePlatform(t);
  const settings = await getUserSettings(settingsPath(dir)).load();

  assert.strictEqual(settings.fontSize, 12);
  assert.strictEqual(typeof settings.save, 'function');
});

test('save() never writes its own methods into the file', async function(t){
  const dir = configurePlatform(t);
  await getUserSettings(settingsPath(dir)).save();

  const written = JSON.parse(fs.readFileSync(settingsPath(dir), 'utf8'));
  assert.strictEqual(written.save, undefined);
  assert.strictEqual(written.load, undefined);
  assert.strictEqual(written.getSettingsFilepath, undefined);
});

//A hand-edited (or otherwise corrupted) settings file containing a "save"/"load" key must not be
//able to replace those methods on the live object - previously Object.assign(this, settingsFile)
//copied every key unconditionally, so loading a file like this made every later settings.save()
//throw "settings.save is not a function".
test('a settings file with a save/load key cannot clobber the real methods', async function(t){
  const dir = configurePlatform(t);
  fs.writeFileSync(settingsPath(dir), JSON.stringify({
    fontSize: 20,
    save: false,
    load: 'nope',
    getSettingsFilepath: 42
  }), 'utf8');

  const settings = await getUserSettings(settingsPath(dir)).load();

  assert.strictEqual(settings.fontSize, 20);
  assert.strictEqual(typeof settings.save, 'function');
  assert.strictEqual(typeof settings.load, 'function');
  assert.strictEqual(typeof settings.getSettingsFilepath, 'function');

  //Must not throw.
  await settings.save();
  assert.strictEqual(settings.getSettingsFilepath(), settingsPath(dir));
});

test('a value of the wrong type in the file is skipped, keeping the default', async function(t){
  const dir = configurePlatform(t);
  fs.writeFileSync(settingsPath(dir), JSON.stringify({
    fontSize: 'huge',
    editorWidth: 50,
    autoBackup: 'yes',
    darkMode: 'dark'
  }), 'utf8');

  const settings = await getUserSettings(settingsPath(dir)).load();

  assert.strictEqual(settings.fontSize, 12);
  assert.strictEqual(settings.editorWidth, 50);
  assert.strictEqual(settings.autoBackup, true);
  assert.strictEqual(settings.darkMode, 'dark');
});

test('an unrecognized key in the file is ignored rather than added to the object', async function(t){
  const dir = configurePlatform(t);
  fs.writeFileSync(settingsPath(dir), JSON.stringify({ someFutureField: 'x', fontSize: 16 }), 'utf8');

  const settings = await getUserSettings(settingsPath(dir)).load();

  assert.strictEqual(settings.fontSize, 16);
  assert.strictEqual(settings.someFutureField, undefined);
});

test('nullable fields accept an explicit null from the file', async function(t){
  const dir = configurePlatform(t);
  fs.writeFileSync(settingsPath(dir), JSON.stringify({
    lastProject: 'C:/books/novel.woolf'
  }), 'utf8');
  const settings = await getUserSettings(settingsPath(dir)).load();
  assert.strictEqual(settings.lastProject, 'C:/books/novel.woolf');

  fs.writeFileSync(settingsPath(dir), JSON.stringify({ lastProject: null }), 'utf8');
  await settings.load();
  assert.strictEqual(settings.lastProject, null);
});

//senderPass holds an {iv, content} object before credential-store.js migrates it out - the schema
//must accept that shape rather than treating it as a type mismatch and silently dropping it.
test('a legacy senderPass blob survives load() so migration can still find it', async function(t){
  const dir = configurePlatform(t);
  const blob = { iv: 'abcd', content: 'ef01' };
  fs.writeFileSync(settingsPath(dir), JSON.stringify({ senderPass: blob }), 'utf8');

  const settings = await getUserSettings(settingsPath(dir)).load();

  assert.deepStrictEqual(settings.senderPass, blob);
});

test('a file that is not valid JSON is logged and falls back to defaults', async function(t){
  const dir = configurePlatform(t);
  fs.writeFileSync(settingsPath(dir), '{ not json', 'utf8');

  const settings = await getUserSettings(settingsPath(dir)).load();

  assert.strictEqual(settings.fontSize, 12);
});

test('a top-level JSON array in the file is ignored rather than merged', async function(t){
  const dir = configurePlatform(t);
  fs.writeFileSync(settingsPath(dir), JSON.stringify([1, 2, 3]), 'utf8');

  const settings = await getUserSettings(settingsPath(dir)).load();

  assert.strictEqual(settings.fontSize, 12);
  assert.strictEqual(typeof settings.save, 'function');
});

test('save() failing (e.g. an unwritable directory) is caught rather than thrown', async function(t){
  const dir = configurePlatform(t);
  const platform = createPlatform(createNodeBacking({ paths: { userData: path.join(dir, 'does-not-exist') } }));
  getUserSettings.setPlatform(platform);

  const settings = getUserSettings(settingsPath(dir));

  await assert.doesNotReject(function(){ return settings.save(); });
});

//---------------------------------------------------------------------------
// keyboard shortcuts
//---------------------------------------------------------------------------

//Only the shortcuts a writer changed are stored (see shortcuts.js diffFromDefaults), so an empty
//map is the everything-on-its-defaults state a new install starts in.
test('keyboard shortcut overrides start empty and round-trip through the file', async function(t){
  const dir = configurePlatform(t);
  const settings = getUserSettings(settingsPath(dir));

  assert.deepStrictEqual(settings.keyboardShortcuts, {});

  settings.keyboardShortcuts = { formatBold: { key: 'W', mod: true, alt: false, shift: true } };
  await settings.save();

  const reloaded = await getUserSettings(settingsPath(dir)).load();

  assert.deepStrictEqual(reloaded.keyboardShortcuts, {
    formatBold: { key: 'W', mod: true, alt: false, shift: true }
  });
});

//An action deliberately left unbound is stored as null, which has to survive the trip - it is not
//the same as an action with no override, which falls back to its default.
test('a shortcut cleared to nothing round-trips as null', async function(t){
  const dir = configurePlatform(t);
  const settings = getUserSettings(settingsPath(dir));

  settings.keyboardShortcuts = { formatBold: null };
  await settings.save();

  const reloaded = await getUserSettings(settingsPath(dir)).load();

  assert.strictEqual(reloaded.keyboardShortcuts.formatBold, null);
  assert.ok('formatBold' in reloaded.keyboardShortcuts);
});

//A plain `type: 'object'` check would have waved all of this through, which is why the field
//carries a sanitizer instead: an unknown action or an unusable binding is dropped, leaving that
//shortcut on its default rather than bound to something that could never fire.
test('shortcut overrides are sanitized entry by entry on load', async function(t){
  const dir = configurePlatform(t);
  fs.writeFileSync(settingsPath(dir), JSON.stringify({
    keyboardShortcuts: {
      formatBold: { key: 'w', mod: 1, alt: false, shift: false },
      madeUpAction: { key: 'W', mod: true },
      formatItalics: { key: 'Unidentified', mod: true }
    }
  }), 'utf8');

  const settings = await getUserSettings(settingsPath(dir)).load();

  assert.deepStrictEqual(settings.keyboardShortcuts, {
    formatBold: { key: 'W', mod: true, alt: false, shift: false }
  });
});

test('a shortcuts field that is not a map of overrides falls back to no overrides', async function(t){
  const dir = configurePlatform(t);

  for(const value of ['ctrl+b', 42, [], null]){
    fs.writeFileSync(settingsPath(dir), JSON.stringify({ keyboardShortcuts: value }), 'utf8');
    const settings = await getUserSettings(settingsPath(dir)).load();
    assert.deepStrictEqual(settings.keyboardShortcuts, {}, JSON.stringify(value));
  }
});

//The automatic substitutions carry the same shape as the shortcuts above: a master switch that is
//on out of the box, and a map holding only the individual rules a writer has changed.
test('automatic substitutions start on with no rules overridden', function(t){
  const dir = configurePlatform(t);
  const settings = getUserSettings(settingsPath(dir));

  assert.strictEqual(settings.autocorrectEnabled, true);
  assert.deepStrictEqual(settings.autocorrect, {});
});

test('the substitution settings round-trip through the file', async function(t){
  const dir = configurePlatform(t);
  const settings = getUserSettings(settingsPath(dir));

  settings.autocorrectEnabled = false;
  settings.autocorrect = { emDash: false };
  await settings.save();

  const reloaded = await getUserSettings(settingsPath(dir)).load();

  assert.strictEqual(reloaded.autocorrectEnabled, false);
  assert.deepStrictEqual(reloaded.autocorrect, { emDash: false });
});

//A plain `type: 'object'` check would have waved all of this through, which is why this field
//carries a sanitizer too: an unknown rule or a value that is not a boolean is dropped, leaving
//that rule on its default.
test('substitution overrides are sanitized entry by entry on load', async function(t){
  const dir = configurePlatform(t);
  fs.writeFileSync(settingsPath(dir), JSON.stringify({
    autocorrect: {
      emDash: false,
      madeUpRule: true,
      ellipsis: 'no'
    }
  }), 'utf8');

  const settings = await getUserSettings(settingsPath(dir)).load();

  assert.deepStrictEqual(settings.autocorrect, { emDash: false });
});

test('a substitutions field that is not a map of overrides falls back to no overrides', async function(t){
  const dir = configurePlatform(t);

  for(const value of ['on', 42, [], null]){
    fs.writeFileSync(settingsPath(dir), JSON.stringify({ autocorrect: value }), 'utf8');
    const settings = await getUserSettings(settingsPath(dir)).load();
    assert.deepStrictEqual(settings.autocorrect, {}, JSON.stringify(value));
  }
});

//Empty means "whatever the app ships as default" (see loadDictionaries' own fallback, platform.js
//group I) - a fresh install, or a writer who never opens the Dictionaries dialog, has to keep
//spellchecking rather than starting from a selection nothing describes.
test('spellcheckDictionaries starts empty', function(t){
  const dir = configurePlatform(t);
  const settings = getUserSettings(settingsPath(dir));

  assert.deepStrictEqual(settings.spellcheckDictionaries, []);
});

test('the dictionary selection round-trips through the file', async function(t){
  const dir = configurePlatform(t);
  const settings = getUserSettings(settingsPath(dir));

  settings.spellcheckDictionaries = ['en_US-large', 'fr_FR'];
  await settings.save();

  const reloaded = await getUserSettings(settingsPath(dir)).load();

  assert.deepStrictEqual(reloaded.spellcheckDictionaries, ['en_US-large', 'fr_FR']);
});

//A plain `type: 'object'` check would wave through anything - the sanitizer is what enforces "an
//array of non-empty strings" entry by entry.
test('a dictionary selection that is not an array of non-empty strings is sanitized on load', async function(t){
  const dir = configurePlatform(t);
  fs.writeFileSync(settingsPath(dir),
    JSON.stringify({ spellcheckDictionaries: ['en_US-large', '', 42, null, 'fr_FR'] }), 'utf8');

  const settings = await getUserSettings(settingsPath(dir)).load();

  assert.deepStrictEqual(settings.spellcheckDictionaries, ['en_US-large', 'fr_FR']);
});

test('a spellcheckDictionaries field that is not an array falls back to an empty selection', async function(t){
  const dir = configurePlatform(t);

  for(const value of ['en_US-large', 42, {}, null]){
    fs.writeFileSync(settingsPath(dir), JSON.stringify({ spellcheckDictionaries: value }), 'utf8');
    const settings = await getUserSettings(settingsPath(dir)).load();
    assert.deepStrictEqual(settings.spellcheckDictionaries, [], JSON.stringify(value));
  }
});

test('getSettingsFilepath returns the path the settings were constructed with', function(t){
  const dir = configurePlatform(t);
  const settings = getUserSettings(settingsPath(dir));

  assert.strictEqual(settings.getSettingsFilepath(), settingsPath(dir));
});


//---------------------------------------------------------------------------
// crossing the bridge
//---------------------------------------------------------------------------

//The live settings object carries save/load/getSettingsFilepath alongside the settings themselves.
//That was harmless while the write was a JSON.stringify in this same process - stringify drops
//functions without complaint - and it stopped being harmless the moment the write moved to the main
//process: structured clone throws on a function outright, so every save rejected. Nothing in the
//suite could see it, because nothing ran a save across a boundary. This is that test.
function bridgedPlatform(t){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'user-settings-bridge-'));
  t.after(function(){
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const platform = createPlatform(createIpcBacking({
    bridge: createFakeBridge(createPlatform(createNodeBacking({ paths: { userData: dir } })))
  }));
  getUserSettings.setPlatform(platform);
  errorLog.setPlatform(platform);

  return dir;
}

test('save works across a serialization boundary, not only in-process', async function(t){
  const dir = bridgedPlatform(t);
  const settings = getUserSettings(settingsPath(dir));

  settings.fontSize = 19;
  settings.lastProject = '/somewhere/book.woolf';
  await settings.save();

  const written = JSON.parse(fs.readFileSync(settingsPath(dir), 'utf8'));
  assert.strictEqual(written.fontSize, 19);
  assert.strictEqual(written.lastProject, '/somewhere/book.woolf');
});

//What actually crosses is data, not a live model object - so the three functions hanging off it
//stay on this side, and so would anything else bolted onto it that the schema does not name.
test('only the schema fields cross, never the object own methods', async function(t){
  const dir = bridgedPlatform(t);
  const settings = getUserSettings(settingsPath(dir));

  await settings.save();

  const written = JSON.parse(fs.readFileSync(settingsPath(dir), 'utf8'));
  assert.strictEqual(written.save, undefined);
  assert.strictEqual(written.load, undefined);
  assert.strictEqual(written.getSettingsFilepath, undefined);
  assert.strictEqual(Object.keys(written).length, Object.keys(settings).length - 3);
});

//Same failure as the two tests above, reached through a different door: keyboardShortcuts is the
//one field holding a map rather than a scalar, so it is the one a caller could leave something
//unclonable inside. Structured clone throws on the whole payload, not on the offending key, so
//without the sanitizer on the way out this would take every other setting's save down with it.
test('an unclonable value inside the shortcuts map does not sink the whole save', async function(t){
  const dir = bridgedPlatform(t);
  const settings = getUserSettings(settingsPath(dir));

  settings.fontSize = 21;
  settings.keyboardShortcuts = {
    formatBold: { key: 'W', mod: true },
    formatItalics: function(){}
  };

  await settings.save();

  const written = JSON.parse(fs.readFileSync(settingsPath(dir), 'utf8'));
  assert.strictEqual(written.fontSize, 21);
  assert.deepStrictEqual(written.keyboardShortcuts, {
    formatBold: { key: 'W', mod: true, alt: false, shift: false }
  });
});

//300 is the standard double-spaced manuscript page, and the Word Count dialog divides by this to
//estimate pages - a fresh install has to open on something usable rather than on 0 (no estimate).
test('wordsPerPage starts at 300', function(t){
  const dir = configurePlatform(t);
  const settings = getUserSettings(settingsPath(dir));

  assert.strictEqual(settings.wordsPerPage, 300);
});

test('the words-per-page value round-trips through the file', async function(t){
  const dir = configurePlatform(t);
  const settings = getUserSettings(settingsPath(dir));

  settings.wordsPerPage = 250;
  await settings.save();

  const reloaded = await getUserSettings(settingsPath(dir)).load();

  assert.strictEqual(reloaded.wordsPerPage, 250);
});

//---------------------------------------------------------------------------
// editor and sidebar fonts
//---------------------------------------------------------------------------

//The manuscript keeps the face WareWoolf drew everything in before either setting existed, so the
//page a writer is actually reading looks exactly as it did; the sidebars start on their own default
//instead, which is the sans face a chapter list is scanned fastest in.
test('each panel starts on its own default face', function(t){
  const dir = configurePlatform(t);
  const settings = getUserSettings(settingsPath(dir));

  assert.strictEqual(settings.editorFont, DEFAULT_FONT_ID);
  assert.strictEqual(settings.sidebarFont, DEFAULT_SIDEBAR_FONT_ID);
});

test('a chosen font for each panel round-trips independently', async function(t){
  const dir = configurePlatform(t);
  const settings = getUserSettings(settingsPath(dir));

  settings.editorFont = 'typewriter';
  settings.sidebarFont = 'sans';
  await settings.save();

  const reloaded = await getUserSettings(settingsPath(dir)).load();

  assert.strictEqual(reloaded.editorFont, 'typewriter');
  assert.strictEqual(reloaded.sidebarFont, 'sans');
});

//A font id is the one setting whose value ends up inside a css font-family declaration, so a
//`type: 'string'` check is not enough: it has to name a font fonts.js actually has a stack for.
test('a font id that names no font WareWoolf has falls back to the default on load', async function(t){
  const dir = configurePlatform(t);

  for(const value of ['no-such-font', '', 42, null, [], { id: 'sans' }, 'constructor']){
    fs.writeFileSync(settingsPath(dir), JSON.stringify({ editorFont: value, sidebarFont: value }), 'utf8');
    const settings = await getUserSettings(settingsPath(dir)).load();
    assert.strictEqual(settings.editorFont, DEFAULT_FONT_ID, JSON.stringify(value));
    //Each to its own panel's default, not both to the manuscript's.
    assert.strictEqual(settings.sidebarFont, DEFAULT_SIDEBAR_FONT_ID, JSON.stringify(value));
  }
});

//Sanitized on the way out as well as in, so a bad value set on the live object never reaches disk
//to be loaded back by a version whose sanitizer might read it differently.
test('an unusable font left on the live object is written out as the default', async function(t){
  const dir = configurePlatform(t);
  const settings = getUserSettings(settingsPath(dir));

  settings.editorFont = 'nonsense; color: red';
  settings.sidebarFont = 'nonsense; color: red';
  await settings.save();

  const written = JSON.parse(fs.readFileSync(settingsPath(dir), 'utf8'));

  assert.strictEqual(written.editorFont, DEFAULT_FONT_ID);
  assert.strictEqual(written.sidebarFont, DEFAULT_SIDEBAR_FONT_ID);
});


//---------------------------------------------------------------------------
// manuscript line spacing
//---------------------------------------------------------------------------

//The spacing the editor was already drawn at, so an existing writer who never opens the dropdown
//sees exactly the manuscript they had.
test('the manuscript line spacing starts on the default', function(t){
  const dir = configurePlatform(t);
  const settings = getUserSettings(settingsPath(dir));

  assert.strictEqual(settings.editorLineHeight, DEFAULT_LINE_HEIGHT_ID);
});

test('a chosen line spacing round-trips', async function(t){
  const dir = configurePlatform(t);
  const settings = getUserSettings(settingsPath(dir));

  settings.editorLineHeight = 'single';
  await settings.save();

  const reloaded = await getUserSettings(settingsPath(dir)).load();

  assert.strictEqual(reloaded.editorLineHeight, 'single');
});

//Like a font id, this ends up inside a css declaration, so a `type: 'string'` check is not enough:
//it has to name a spacing line-heights.js actually has a multiplier for. `2` and `'2'` are in the
//list because a spacing is a number everywhere else it is written down, so they are what a hand
//edit is likeliest to put there - and neither is an id.
test('a line spacing that names nothing WareWoolf has falls back to the default on load', async function(t){
  const dir = configurePlatform(t);

  for(const value of ['no-such-spacing', '', 2, '2', null, [], { id: 'single' }, 'constructor']){
    fs.writeFileSync(settingsPath(dir), JSON.stringify({ editorLineHeight: value }), 'utf8');
    const settings = await getUserSettings(settingsPath(dir)).load();
    assert.strictEqual(settings.editorLineHeight, DEFAULT_LINE_HEIGHT_ID, JSON.stringify(value));
  }
});

//Sanitized on the way out as well as in, so a bad value set on the live object never reaches disk.
test('an unusable line spacing left on the live object is written out as the default', async function(t){
  const dir = configurePlatform(t);
  const settings = getUserSettings(settingsPath(dir));

  settings.editorLineHeight = 'nonsense; color: red';
  await settings.save();

  const written = JSON.parse(fs.readFileSync(settingsPath(dir), 'utf8'));

  assert.strictEqual(written.editorLineHeight, DEFAULT_LINE_HEIGHT_ID);
});
