//The ipc backing for the platform contract: ipcRenderer.invoke against the main process, reached
//directly (no contextBridge yet - nodeIntegration stays on through Phase 9). This is what render.js
//actually runs against for every command in this file's IMPLEMENTED list.
//
//Group A is why this file exists before Phase 9 rather than at it. None of app.getPath, nativeTheme,
//the application menu, or app.quit is reachable from the renderer even with nodeIntegration on - so
//unlike groups C and J (plain fs/crypto, already directly reachable and backed by platform-node.js
//inside the running app today), group A was never a candidate for a node-backed implementation in
//the shipped app. It has always crossed via IPC, under whatever name; this file is that IPC given
//the contract's shape instead of the old sendSync/send channel names.
//
//Electron does not forward a thrown error's custom properties across ipcMain.handle - only
//.message survives serialization. So a handler that fails resolves with a plain
//{ __platformError: true, code, message, details } envelope instead of rejecting, and this is the
//one place that unwraps it back into a real PlatformError, on this side of the boundary the code
//was thrown on. createPlatform's own wrapper (platform.js) passes an already-a-PlatformError
//straight through, so the command's real code survives the round trip intact.

const { PlatformError } = require('./platform');

//Commands this backing actually implements. Everything else in COMMANDS stays absent here and
//rejects with NOT_IMPLEMENTED via createPlatform, exactly like platform-node.js - later phases grow
//this list one group at a time rather than writing 61 near-identical invoke() wrappers up front.
var IMPLEMENTED = [
  'getAppPaths',
  'getPlatform',
  'getFileRequestedOnOpen',
  'setTheme',
  'showAppMenu',
  'confirmExit',
  'notifyRendererReady'
];

function createIpcBacking(deps){
  //Resolved at call time, not at module load: this file is required once and cached, but tests
  //re-require render.js (and swap the fake 'electron' module in require.cache) per test. Capturing
  //ipcRenderer in a module-scope const here would freeze it to whichever fake happened to be first.
  var ipcRenderer = (deps || {}).ipcRenderer || require('electron').ipcRenderer;

  var backing = {};

  IMPLEMENTED.forEach(function(name){
    backing[name] = function(args){
      return ipcRenderer.invoke(name, args).then(function(result){
        if(isPlatformErrorEnvelope(result))
          throw PlatformError(result.code, result.message, result.details);
        return result;
      });
    };
  });

  //Nothing in render.js drives an event through the facade yet - the 36 menu channels stay on raw
  //ipcRenderer.on() until Phase 9 forces the issue - but createPlatform expects backing.on/off to
  //exist, and implementing them now costs nothing.
  backing.on = function(event, handler){
    ipcRenderer.on(event, handler);
  };
  backing.off = function(event, handler){
    ipcRenderer.removeListener(event, handler);
  };

  return backing;
}

function isPlatformErrorEnvelope(result){
  return result != null && typeof result === 'object' && result.__platformError === true;
}

module.exports = {
  createIpcBacking: createIpcBacking,
  IMPLEMENTED: IMPLEMENTED
};
