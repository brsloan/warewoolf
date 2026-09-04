const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const getCredentialStore = require('../src/components/models/credential-store');
const { seal, generateKey } = require('../src/components/controllers/crypto');

test('with no system keystore, the password is sealed under a key file', function(){
  const dir = tempDir();
  const store = getCredentialStore(dir, keystore(false));

  assert.strictEqual(store.describe().backend, 'keyfile');
  assert.ok(store.savePassword('hunter2'));
  assert.strictEqual(store.getPassword(), 'hunter2');

  const written = fs.readFileSync(path.join(dir, 'credentials.json'), 'utf8');
  assert.strictEqual(JSON.parse(written).backend, 'keyfile');
  assert.ok(!written.includes('hunter2'));
  assert.ok(fs.existsSync(path.join(dir, '.warewoolf-key')));
});

//The point of the key file tier: it doesn't hide the password from someone reading the writer's own
//files, but a credentials.json that travelled without its key file is inert.
test('a credentials file copied without its key file cannot be read', function(){
  const source = tempDir();
  const elsewhere = tempDir();
  getCredentialStore(source, keystore(false)).savePassword('hunter2');

  fs.copyFileSync(path.join(source, 'credentials.json'), path.join(elsewhere, 'credentials.json'));

  assert.strictEqual(getCredentialStore(elsewhere, keystore(false)).getPassword(), null);
});

test('with a system keystore, the password goes to the keystore instead', function(){
  const dir = tempDir();
  const store = getCredentialStore(dir, keystore(true));

  assert.strictEqual(store.describe().backend, 'safeStorage');
  assert.ok(store.savePassword('hunter2'));
  assert.strictEqual(store.getPassword(), 'hunter2');

  const written = JSON.parse(fs.readFileSync(path.join(dir, 'credentials.json'), 'utf8'));
  assert.strictEqual(written.backend, 'safeStorage');
  assert.ok(!fs.existsSync(path.join(dir, '.warewoolf-key')));
});

//A Keychain can lock, a keyring daemon can die. Losing the password over that would be worse than
//dropping to the weaker tier, so the store falls back rather than failing the save.
test('a keystore that refuses at the last moment falls back to a key file', function(){
  const dir = tempDir();
  const flaky = keystore(true);
  flaky.encrypt = function(){ return null; };
  const store = getCredentialStore(dir, flaky);

  assert.ok(store.savePassword('hunter2'));
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'credentials.json'), 'utf8')).backend, 'keyfile');
  assert.strictEqual(store.getPassword(), 'hunter2');
});

test('a passphrase protected password is unreadable until it is unlocked', function(){
  const dir = tempDir();
  getCredentialStore(dir, keystore(false)).savePassword('hunter2', { passphrase: 'correct horse' });

  //A new store stands in for a fresh window, where nothing has been unlocked yet.
  const reopened = getCredentialStore(dir, keystore(false));
  assert.deepStrictEqual(reopened.describe(), {
    hasPassword: true, backend: 'passphrase', locked: true, secureStorageAvailable: false
  });
  assert.strictEqual(reopened.getPassword(), null);

  assert.strictEqual(reopened.unlock('wrong passphrase'), false);
  assert.strictEqual(reopened.getPassword(), null);

  assert.strictEqual(reopened.unlock('correct horse'), true);
  assert.strictEqual(reopened.getPassword(), 'hunter2');
  assert.strictEqual(reopened.describe().locked, false);
});

test('a passphrase is preferred even when a keystore is available', function(){
  const dir = tempDir();
  const store = getCredentialStore(dir, keystore(true));
  store.savePassword('hunter2', { passphrase: 'correct horse' });

  assert.strictEqual(store.describe().backend, 'passphrase');
  //Saving counts as unlocking, so the writer isn't asked for what they just typed.
  assert.strictEqual(store.getPassword(), 'hunter2');
});

test('an empty passphrase is treated as no passphrase, not as a passphrase of ""', function(){
  const dir = tempDir();
  const store = getCredentialStore(dir, keystore(false));
  store.savePassword('hunter2', { passphrase: '' });

  assert.strictEqual(store.describe().backend, 'keyfile');
});

test('clearing forgets the password and relocks the session', function(){
  const dir = tempDir();
  const store = getCredentialStore(dir, keystore(false));
  store.savePassword('hunter2', { passphrase: 'correct horse' });

  assert.ok(store.clear());
  assert.strictEqual(store.getPassword(), null);
  assert.strictEqual(store.describe().hasPassword, false);
  assert.ok(!fs.existsSync(path.join(dir, 'credentials.json')));
  //Clearing twice is what happens when the writer unticks "remember" twice; it must not throw.
  assert.ok(store.clear());
});

test('a password saved by an older version moves out of the settings file', function(){
  const dir = tempDir();
  const settings = legacySettings('old-password');
  const store = getCredentialStore(dir, keystore(false));

  assert.strictEqual(store.migrateLegacyPassword(settings), true);
  assert.strictEqual(settings.senderPass, null);
  assert.strictEqual(settings.saveCount, 1);
  assert.strictEqual(store.getPassword(), 'old-password');
});

test('migration runs once and leaves an already migrated settings file alone', function(){
  const dir = tempDir();
  const settings = legacySettings('old-password');
  const store = getCredentialStore(dir, keystore(false));
  store.migrateLegacyPassword(settings);

  assert.strictEqual(store.migrateLegacyPassword(settings), false);
  assert.strictEqual(settings.saveCount, 1);
  assert.strictEqual(store.getPassword(), 'old-password');
});

//Migration must never mistake a current blob for a legacy one and try to read it with the old key.
test('migration ignores a settings file holding a current blob', function(){
  const dir = tempDir();
  const settings = { senderPass: seal('hunter2', generateKey()), saveCount: 0, save: countSave };

  assert.strictEqual(getCredentialStore(dir, keystore(false)).migrateLegacyPassword(settings), false);
  assert.notStrictEqual(settings.senderPass, null);
  assert.strictEqual(settings.saveCount, 0);
});

test('nothing to migrate when no password was ever saved', function(){
  const dir = tempDir();
  const settings = { senderPass: null, saveCount: 0, save: countSave };

  assert.strictEqual(getCredentialStore(dir, keystore(false)).migrateLegacyPassword(settings), false);
  assert.strictEqual(settings.saveCount, 0);
});

//Stands in for Electron's safeStorage over IPC. The "ciphertext" only has to be opaque to the
//store, which never inspects it.
function keystore(available){
  return {
    isAvailable: function(){ return available; },
    encrypt: function(text){
      return available ? 'keystore:' + Buffer.from(text, 'utf8').toString('base64') : null;
    },
    decrypt: function(content){
      return content.startsWith('keystore:')
        ? Buffer.from(content.slice('keystore:'.length), 'base64').toString('utf8')
        : null;
    }
  };
}

//The shape user-settings.json had up to 2.2.1: an aes-256-ctr blob under the key that shipped in
//the source.
function legacySettings(password){
  const crypto = require('node:crypto');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-ctr', 'o2V6h1BYiyMWiSFNNoKf6rp7maAr6Lb7', iv);
  const encrypted = Buffer.concat([cipher.update(password), cipher.final()]);

  return {
    senderPass: { iv: iv.toString('hex'), content: encrypted.toString('hex') },
    saveCount: 0,
    save: countSave
  };
}

function countSave(){
  this.saveCount++;
}

function tempDir(){
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-credentials-'));
}
