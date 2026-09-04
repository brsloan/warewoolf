const fs = require('fs');
const {
  seal, open, deriveKey, generateKey, generateSalt, decryptLegacy, isLegacyBlob, KDF_PARAMS
} = require('../controllers/crypto');
const { logError } = require('../controllers/error-log');

const STORE_VERSION = 2;

//Where a saved email password can live, best first:
//
//  safeStorage - the OS keystore (DPAPI on Windows, Keychain on macOS, libsecret/kwallet on a
//                Linux desktop). Tied to the user's login account.
//  passphrase  - AES-256-GCM under a scrypt key from a passphrase the writer types once a session.
//                The only option that is genuinely secret on a machine with no keystore.
//  keyfile     - AES-256-GCM under 32 random bytes kept in a 0600 file beside the store. This does
//                not hide the password from anyone who can read the writer's own files, and it is
//                not meant to: it means a copied credentials.json, a synced backup or a settings
//                file pasted into a bug report is useless on its own.
const BACKENDS = { secureStorage: 'safeStorage', passphrase: 'passphrase', keyFile: 'keyfile' };

function getCredentialStore(userDataDir, secureStorage){
  const storeFilepath = userDataDir + '/credentials.json';
  const keyFilepath = userDataDir + '/.warewoolf-key';

  //A passphrase key is held for the life of the window only, so the writer types it once rather
  //than for every send. It never reaches disk.
  var sessionKey = null;

  return {
    describe: describe,
    getPassword: getPassword,
    savePassword: savePassword,
    unlock: unlock,
    clear: clear,
    migrateLegacyPassword: migrateLegacyPassword,
    getStoreFilepath: getStoreFilepath
  };

  //Everything a dialog needs to decide what to draw: whether a password is saved, whether it is
  //readable right now, and which backend is protecting it (or would protect a new one).
  function describe(){
    var stored = loadStore();
    var hasPassword = stored != null && stored.secret != null;

    return {
      hasPassword: hasPassword,
      backend: hasPassword ? stored.backend : defaultBackend(),
      locked: hasPassword && stored.backend === BACKENDS.passphrase && sessionKey == null,
      secureStorageAvailable: isSecureStorageAvailable()
    };
  }

  function getPassword(){
    var stored = loadStore();

    if(stored == null || stored.secret == null)
      return null;

    if(stored.backend === BACKENDS.secureStorage)
      return isSecureStorageAvailable() ? secureStorage.decrypt(stored.secret.content) : null;

    if(stored.backend === BACKENDS.passphrase)
      return sessionKey == null ? null : open(stored.secret, sessionKey);

    var key = readKeyFile();

    return key == null ? null : open(stored.secret, key);
  }

  //Passing a passphrase switches the saved password to passphrase protection; leaving it out uses
  //the best unattended backend the machine offers.
  function savePassword(password, options){
    var passphrase = options == null ? null : options.passphrase;

    try{
      if(passphrase != null && passphrase !== '')
        return saveUnderPassphrase(password, passphrase);
      if(isSecureStorageAvailable())
        return saveUnderSecureStorage(password);

      return saveUnderKeyFile(password);
    }
    catch(err){
      logError(err);
      return false;
    }
  }

  function saveUnderSecureStorage(password){
    var content = secureStorage.encrypt(password);

    //The keystore can vanish between the availability check and the write - a locked Keychain, a
    //keyring daemon that died. Rather than lose the password, fall back to the key file.
    if(content == null)
      return saveUnderKeyFile(password);

    sessionKey = null;

    return writeStore({ backend: BACKENDS.secureStorage, secret: { content: content } });
  }

  function saveUnderKeyFile(password){
    var key = readKeyFile() || createKeyFile();

    if(key == null)
      return false;

    sessionKey = null;

    return writeStore({ backend: BACKENDS.keyFile, secret: seal(password, key) });
  }

  function saveUnderPassphrase(password, passphrase){
    var salt = generateSalt();
    var kdf = { salt: salt.toString('hex'), N: KDF_PARAMS.N, r: KDF_PARAMS.r, p: KDF_PARAMS.p };
    var key = deriveKey(passphrase, salt, KDF_PARAMS);

    if(!writeStore({ backend: BACKENDS.passphrase, kdf: kdf, secret: seal(password, key) }))
      return false;

    //Saving counts as unlocking, so the writer isn't asked for the passphrase they just chose.
    sessionKey = key;

    return true;
  }

  //Returns false on a wrong passphrase, which the authentication tag detects for us.
  function unlock(passphrase){
    var stored = loadStore();

    if(stored == null || stored.backend !== BACKENDS.passphrase || stored.kdf == null)
      return false;

    try{
      var key = deriveKey(passphrase, Buffer.from(stored.kdf.salt, 'hex'), stored.kdf);

      if(open(stored.secret, key) == null)
        return false;

      sessionKey = key;

      return true;
    }
    catch(err){
      logError(err);
      return false;
    }
  }

  function clear(){
    sessionKey = null;

    try{
      if(fs.existsSync(storeFilepath))
        fs.unlinkSync(storeFilepath);

      return true;
    }
    catch(err){
      logError(err);
      return false;
    }
  }

  //Versions up to 2.2.1 kept the password in user-settings.json, encrypted with a key that shipped
  //in the source. Read it once with that key, re-save it properly, and take it out of the settings
  //file. Returns true when something was moved.
  function migrateLegacyPassword(userSettings){
    if(!isLegacyBlob(userSettings.senderPass))
      return false;

    var password = decryptLegacy(userSettings.senderPass);

    if(password != null && password !== '')
      savePassword(password);

    userSettings.senderPass = null;
    userSettings.save();

    return true;
  }

  function getStoreFilepath(){
    return storeFilepath;
  }

  function isSecureStorageAvailable(){
    try{
      return secureStorage != null && secureStorage.isAvailable();
    }
    catch(err){
      logError(err);
      return false;
    }
  }

  function defaultBackend(){
    return isSecureStorageAvailable() ? BACKENDS.secureStorage : BACKENDS.keyFile;
  }

  function loadStore(){
    try{
      if(!fs.existsSync(storeFilepath))
        return null;

      var stored = JSON.parse(fs.readFileSync(storeFilepath, 'utf8'));

      return stored != null && stored.version === STORE_VERSION ? stored : null;
    }
    catch(err){
      logError(err);
      return null;
    }
  }

  function writeStore(store){
    try{
      store.version = STORE_VERSION;
      fs.writeFileSync(storeFilepath, JSON.stringify(store, null, '\t'), { encoding: 'utf8', mode: 0o600 });
      restrictToOwner(storeFilepath);

      return true;
    }
    catch(err){
      logError(err);
      return false;
    }
  }

  function readKeyFile(){
    try{
      if(!fs.existsSync(keyFilepath))
        return null;

      var hex = fs.readFileSync(keyFilepath, 'utf8').trim();

      return hex.length === 64 ? Buffer.from(hex, 'hex') : null;
    }
    catch(err){
      logError(err);
      return null;
    }
  }

  function createKeyFile(){
    try{
      var key = generateKey();
      fs.writeFileSync(keyFilepath, key.toString('hex'), { encoding: 'utf8', mode: 0o600 });
      restrictToOwner(keyFilepath);

      return key;
    }
    catch(err){
      logError(err);
      return null;
    }
  }

  //The mode passed to writeFileSync only applies when the file is created, and is ignored outright
  //on Windows - where the user profile's own permissions, and DPAPI above, are what protect it.
  function restrictToOwner(filepath){
    try{
      fs.chmodSync(filepath, 0o600);
    }
    catch(err){
      //Not fatal: a filesystem that can't express this still stores the file.
    }
  }
}

module.exports = getCredentialStore;
