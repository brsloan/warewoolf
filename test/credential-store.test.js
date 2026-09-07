const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const getCredentialStore = require('../src/components/models/credential-store');

//migrateLegacyPassword() used to live on this store and its four tests used to live here. Phase 7
//split it: the decrypt-and-reseal is platform-node.js's migrateLegacyCredential (covered in
//platform.test.js, including the legacy-format fixture and the recognized/migrated distinction),
//and clearing userSettings.senderPass is render.js's (covered in render.test.js, driven through a
//real boot). Nothing about the old behaviour went untested; it is tested where it now runs.

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

function tempDir(){
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-credentials-'));
}
