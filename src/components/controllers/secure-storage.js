const { ipcRenderer } = require('electron');

//Electron's safeStorage lives in the main process, so the renderer reaches it over IPC. The calls
//are synchronous to match the rest of the settings code, which saves and loads without callbacks;
//each one is a single fast keystore operation.
function getSecureStorage(){
  return {
    isAvailable: isAvailable,
    encrypt: encrypt,
    decrypt: decrypt
  };

  function isAvailable(){
    return ipcRenderer.sendSync('secure-storage-available') === true;
  }

  //Returns base64 ciphertext, or null if the OS keystore refused or is not really there.
  function encrypt(text){
    return ipcRenderer.sendSync('secure-storage-encrypt', text);
  }

  function decrypt(content){
    return ipcRenderer.sendSync('secure-storage-decrypt', content);
  }
}

module.exports = getSecureStorage;
