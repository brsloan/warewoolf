const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const errorLog = require('../src/components/controllers/error-log');
const getUserSettings = require('../src/components/models/user-settings');

test.before(function(){
  errorLog.setLogDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-user-settings-log-')));
});

function tempDir(t){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'user-settings-test-'));
  t.after(function(){
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function settingsPath(t){
  return path.join(tempDir(t), 'user-settings.json');
}

test('a fresh settings object has the documented defaults', function(t){
  const settings = getUserSettings(settingsPath(t));

  assert.strictEqual(settings.editorWidth, 50);
  assert.strictEqual(settings.fontSize, 12);
  assert.strictEqual(settings.darkMode, 'system');
  assert.strictEqual(settings.lastProject, null);
});

test('save then load round-trips every field, including a changed value', function(t){
  const filepath = settingsPath(t);
  const settings = getUserSettings(filepath);

  settings.fontSize = 18;
  settings.lastProject = 'C:/books/novel.woolf';
  settings.autoBackup = false;
  settings.save();

  const reloaded = getUserSettings(filepath).load();

  assert.strictEqual(reloaded.fontSize, 18);
  assert.strictEqual(reloaded.lastProject, 'C:/books/novel.woolf');
  assert.strictEqual(reloaded.autoBackup, false);
});

test('load() on a file that does not exist yet leaves the defaults untouched', function(t){
  const settings = getUserSettings(settingsPath(t)).load();

  assert.strictEqual(settings.fontSize, 12);
  assert.strictEqual(typeof settings.save, 'function');
});

test('save() never writes its own methods into the file', function(t){
  const filepath = settingsPath(t);
  getUserSettings(filepath).save();

  const written = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  assert.strictEqual(written.save, undefined);
  assert.strictEqual(written.load, undefined);
  assert.strictEqual(written.getSettingsFilepath, undefined);
});

//A hand-edited (or otherwise corrupted) settings file containing a "save"/"load" key must not be
//able to replace those methods on the live object - previously Object.assign(this, settingsFile)
//copied every key unconditionally, so loading a file like this made every later settings.save()
//throw "settings.save is not a function".
test('a settings file with a save/load key cannot clobber the real methods', function(t){
  const filepath = settingsPath(t);
  fs.writeFileSync(filepath, JSON.stringify({
    fontSize: 20,
    save: false,
    load: 'nope',
    getSettingsFilepath: 42
  }), 'utf8');

  const settings = getUserSettings(filepath).load();

  assert.strictEqual(settings.fontSize, 20);
  assert.strictEqual(typeof settings.save, 'function');
  assert.strictEqual(typeof settings.load, 'function');
  assert.strictEqual(typeof settings.getSettingsFilepath, 'function');

  //Must not throw.
  settings.save();
  assert.strictEqual(settings.getSettingsFilepath(), filepath);
});

test('a value of the wrong type in the file is skipped, keeping the default', function(t){
  const filepath = settingsPath(t);
  fs.writeFileSync(filepath, JSON.stringify({
    fontSize: 'huge',
    editorWidth: 50,
    autoBackup: 'yes',
    darkMode: 'dark'
  }), 'utf8');

  const settings = getUserSettings(filepath).load();

  assert.strictEqual(settings.fontSize, 12);
  assert.strictEqual(settings.editorWidth, 50);
  assert.strictEqual(settings.autoBackup, true);
  assert.strictEqual(settings.darkMode, 'dark');
});

test('an unrecognized key in the file is ignored rather than added to the object', function(t){
  const filepath = settingsPath(t);
  fs.writeFileSync(filepath, JSON.stringify({ someFutureField: 'x', fontSize: 16 }), 'utf8');

  const settings = getUserSettings(filepath).load();

  assert.strictEqual(settings.fontSize, 16);
  assert.strictEqual(settings.someFutureField, undefined);
});

test('nullable fields accept an explicit null from the file', function(t){
  const filepath = settingsPath(t);
  fs.writeFileSync(filepath, JSON.stringify({
    lastProject: 'C:/books/novel.woolf'
  }), 'utf8');
  const settings = getUserSettings(filepath).load();
  assert.strictEqual(settings.lastProject, 'C:/books/novel.woolf');

  fs.writeFileSync(filepath, JSON.stringify({ lastProject: null }), 'utf8');
  settings.load();
  assert.strictEqual(settings.lastProject, null);
});

//senderPass holds an {iv, content} object before credential-store.js migrates it out - the schema
//must accept that shape rather than treating it as a type mismatch and silently dropping it.
test('a legacy senderPass blob survives load() so migration can still find it', function(t){
  const filepath = settingsPath(t);
  const blob = { iv: 'abcd', content: 'ef01' };
  fs.writeFileSync(filepath, JSON.stringify({ senderPass: blob }), 'utf8');

  const settings = getUserSettings(filepath).load();

  assert.deepStrictEqual(settings.senderPass, blob);
});

test('a file that is not valid JSON is logged and falls back to defaults', function(t){
  const filepath = settingsPath(t);
  fs.writeFileSync(filepath, '{ not json', 'utf8');

  const settings = getUserSettings(filepath).load();

  assert.strictEqual(settings.fontSize, 12);
});

test('a top-level JSON array in the file is ignored rather than merged', function(t){
  const filepath = settingsPath(t);
  fs.writeFileSync(filepath, JSON.stringify([1, 2, 3]), 'utf8');

  const settings = getUserSettings(filepath).load();

  assert.strictEqual(settings.fontSize, 12);
  assert.strictEqual(typeof settings.save, 'function');
});

test('save() failing (e.g. an unwritable directory) is caught rather than thrown', function(t){
  const missingDir = path.join(tempDir(t), 'does-not-exist', 'user-settings.json');
  const settings = getUserSettings(missingDir);

  assert.doesNotThrow(function(){ settings.save(); });
});

test('getSettingsFilepath returns the path the settings were constructed with', function(t){
  const filepath = settingsPath(t);
  const settings = getUserSettings(filepath);

  assert.strictEqual(settings.getSettingsFilepath(), filepath);
});
