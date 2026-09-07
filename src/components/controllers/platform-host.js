//The main-process half of the preload bridge. index.js registers one ipcMain.handle per declared
//command against this; the renderer half is platform-ipc.js.
//
//It exists as its own file rather than inline in index.js for two reasons:
//
//  1. index.js cannot be required outside Electron, so anything living in it is untestable. This
//     file requires only ./platform - no electron, no fs - so the suite exercises the real
//     serialization boundary rather than a copy of it written for the test.
//  2. The error envelope below is the one piece of the boundary that has to agree exactly with
//     platform-ipc.js's unwrapping, in both directions. Two copies of it is how a `code` silently
//     becomes undefined on one path and not the other.
//
//Electron does not forward a thrown error's custom properties across ipcMain.handle - only
//.message survives, and the reconstituted object is a plain Error with no `code` at all. Every
//documented error path in platform.js branches on `code`, so a rejection is *resolved* as a
//{ __platformError: true, code, message, details } envelope instead, and platform-ipc.js turns it
//back into a real PlatformError on the far side. That is rule 5 ("failure is loud") surviving a
//boundary that would otherwise flatten it into a generic failure.

const { COMMANDS, CODES, PlatformError } = require('./platform');

//Set by PlatformError itself rather than by a caller's `details`, so they are reconstituted from
//the envelope's own fields instead of being copied twice.
var ENVELOPE_RESERVED = ['name', 'code', 'isPlatformError'];

function createCommandHost(platform){
  if(platform == null)
    throw PlatformError(CODES.INVALID_ARGUMENT, 'createCommandHost needs a platform.');

  //A name the renderer invented rather than one this contract declares. Refused here as well as in
  //preload.js: preload is the guard the renderer cannot get past, this is the guard that holds if a
  //future bridge (Tauri, a test harness) forgets to write one.
  function invoke(name, args){
    if(!Object.prototype.hasOwnProperty.call(COMMANDS, name))
      return Promise.resolve(errorEnvelope(PlatformError(CODES.INVALID_ARGUMENT,
        'Unknown platform command "' + name + '".', { command: name })));

    return Promise.resolve()
      .then(function(){
        return platform[name](args == null ? {} : args);
      })
      .catch(errorEnvelope);
  }

  return { invoke: invoke };
}

//Everything PlatformError put on the error, flattened into a plain object that survives structured
//clone. The details matter: saveChapterAtomic's `rolledBack` is the difference between "your
//chapter is still on disk" and "it is not", and a caller that cannot see it keeps no unsaved-changes
//flag for work that never landed.
function errorEnvelope(err){
  var details = {};

  if(err != null)
    Object.keys(err).forEach(function(key){
      if(ENVELOPE_RESERVED.indexOf(key) === -1)
        details[key] = err[key];
    });

  return {
    __platformError: true,
    code: (err != null && err.code) || CODES.IO_ERROR,
    message: (err != null && err.message) || 'Unknown platform failure.',
    details: details
  };
}

function isErrorEnvelope(value){
  return value != null && typeof value === 'object' && value.__platformError === true;
}

module.exports = {
  createCommandHost: createCommandHost,
  errorEnvelope: errorEnvelope,
  isErrorEnvelope: isErrorEnvelope
};
