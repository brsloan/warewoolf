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
