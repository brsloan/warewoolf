//The renderer half of the preload bridge: every declared command, sent across as one invoke() call
//by name. It talks to `window.warewoolf` - the object preload.js publishes through contextBridge -
//and to nothing else. No electron, no ipcRenderer, no fs; after Phase 9b this file and platform.js
//are the only two the renderer needs to reach the machine at all.
//
//Why a bridge object rather than ipcRenderer directly: under contextIsolation the renderer cannot
//see ipcRenderer, and handing it one through contextBridge would expose every channel in the app
//(and `sendSync`, and `sendTo`) to anything running in the page. preload.js exposes exactly
//invoke/on/off, and validates the name against COMMANDS/EVENTS before either one crosses.
//
//Errors do not survive ipcMain.handle as Error objects - only .message does, and the `code` every
//documented failure path branches on arrives undefined. So the main side resolves a failure as a
//{ __platformError, code, message, details } envelope (platform-host.js), and this is the one place
//that turns it back into a real PlatformError. createPlatform's own wrapper (platform.js) passes an
//already-a-PlatformError straight through, so the code the command threw survives the round trip.

const { COMMANDS, PlatformError, CODES } = require('./platform');
const { isErrorEnvelope } = require('./platform-host');

//Every declared command, not a hand-maintained subset. Through Phase 8 this was an IMPLEMENTED list
//that each group appended to, because the main process only handled group A; Phase 9a registers a
//handler for all 65 at once, so a subset here would just be a second place to forget one.
var IMPLEMENTED = Object.keys(COMMANDS);

function createIpcBacking(deps){
  var options = deps || {};

  //Resolved at call time, not at module load. This file is required once and cached; a test that
  //installs a fake bridge per test would otherwise be frozen to whichever one happened to be first.
  //The same reason the pre-Phase-9 version of this file resolved ipcRenderer per call.
  function bridge(){
    var found = options.bridge || globalThis.warewoolf;

    if(found == null)
      throw PlatformError(CODES.UNAVAILABLE,
        'No platform bridge is available. preload.js publishes window.warewoolf; a test must inject one.');

    return found;
  }

  var backing = {};

  IMPLEMENTED.forEach(function(name){
    backing[name] = function(args){
      return bridge().invoke(name, args).then(function(result){
        if(isErrorEnvelope(result))
          throw PlatformError(result.code, result.message, result.details);
        return result;
      });
    };
  });

  //Handlers receive the event's payload arguments only - never an IpcRendererEvent, which carries
  //`sender` and would hand the page back the very object contextIsolation exists to keep from it.
  //preload.js strips it; this side just forwards.
  backing.on = function(event, handler){
    bridge().on(event, handler);
  };
  backing.off = function(event, handler){
    bridge().off(event, handler);
  };

  return backing;
}

module.exports = {
  createIpcBacking: createIpcBacking,
  IMPLEMENTED: IMPLEMENTED
};
