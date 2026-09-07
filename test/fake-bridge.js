//A stand-in for the preload bridge, used to run the contract suite (and every other test that
//drives a module through the platform facade) across a real serialization boundary instead of a
//direct function call.
//
//Not a mock of the boundary - a real one. Both halves are the shipped code: platform-host.js on the
//main side, platform-ipc.js on the renderer side, with structuredClone (the same algorithm Electron
//uses for ipcRenderer.invoke) standing in for the process hop. The only thing faked is that both
//ends are in this process.
//
//It exists because a suite that only ever calls createPlatform(createNodeBacking(...)) directly
//proves the node backing works and nothing about whether the same calls survive being sent
//somewhere. The failures it is here to catch cannot be seen any other way:
//
//  - PlatformError does not cross as an Error. `code` arrives undefined, and every documented
//    failure path in platform.js branches on `code` - so rule 5 ("failure is loud") quietly becomes
//    a generic IO_ERROR for all 65 commands at once. platform-host.js's envelope is what prevents
//    that, and this is what tests it.
//  - Buffers arrive as Uint8Array, Dates as Dates, undefined stays undefined - and anything
//    holding a function, a class instance or a cycle does not arrive at all.
//  - SAVED_SECRET is a string with NUL bytes at both ends. Phase 7 established that it survives a
//    Chromium password input; that says nothing about structured clone.
//
//This file is deliberately not named *.test.js: `npm test` globs test/*.test.js, so it is a helper
//and not a suite.
const { createCommandHost } = require('../src/components/controllers/platform-host');
const { createPlatform, EVENTS } = require('../src/components/controllers/platform');
const { createNodeBacking } = require('../src/components/controllers/platform-node');

//Where Electron would serialize. A value that cannot cross throws a DOMException here exactly as it
//would there, and the failure names the command rather than surfacing as an opaque DataCloneError
//several frames away from whatever built the argument.
function crossBoundary(value, what, name){
  try{
    return structuredClone(value);
  }
  catch(err){
    var failure = new Error('The ' + what + ' of "' + name + '" cannot cross the bridge: ' + err.message);
    failure.code = 'NOT_CLONEABLE';
    throw failure;
  }
}

//`platform` is the main side's own createPlatform(createNodeBacking(...)) - the same object
//index.js hands to createCommandHost.
function createFakeBridge(platform){
  var host = createCommandHost(platform);
  var listeners = {};

  return {
    invoke: function(name, args){
      return Promise.resolve()
        .then(function(){
          return host.invoke(name, crossBoundary(args, 'arguments', name));
        })
        .then(function(result){
          return crossBoundary(result, 'result', name);
        });
    },

    //Handlers are called with the event's payload arguments only. preload.js drops the
    //IpcRendererEvent rather than forwarding it, so this does too - a test that saw one here would
    //be testing a shape the app never gets.
    on: function(event, handler){
      if(listeners[event] == null)
        listeners[event] = [];
      listeners[event].push(handler);
    },

    //Removes exactly one registration, the way preload.js's own off() does - not every matching
    //one - so a test cannot pass here and leave a live listener behind in the app.
    off: function(event, handler){
      var index = (listeners[event] || []).indexOf(handler);
      if(index > -1)
        listeners[event].splice(index, 1);
    },

    //Stands in for index.js's webContents.send(). Payloads cross the same way a command's arguments
    //do, so an event that ships something unserializable fails here rather than in the app.
    emit: function(event){
      if(EVENTS.indexOf(event) === -1)
        throw new Error('Nothing in the app sends "' + event + '".');

      var payload = Array.prototype.slice.call(arguments, 1).map(function(arg){
        return crossBoundary(arg, 'payload', event);
      });

      return (listeners[event] || []).slice().map(function(handler){
        return handler.apply(null, payload);
      });
    },

    listenerCount: function(event){
      return (listeners[event] || []).length;
    }
  };
}

//What a module that holds its own standing createPlatform(createIpcBacking()) instance needs from a
//test: something at globalThis.warewoolf for that backing to find. `deps` go to the node backing on
//the far side, so a test injects paths/spawnProcess/httpsGet exactly as it did when it built the
//backing itself.
//
//Order matters for the tests that mock child_process/https on the real module object rather than
//injecting: createNodeBacking() resolves .spawn/.request/.get once, at construction, so install the
//bridge *after* the mock and *before* re-requiring the module under test. The existing freshXxx()
//helpers in updates/wifi-manager/battery-monitor already sequence it that way for the same reason.
function installBridge(deps){
  globalThis.warewoolf = createFakeBridge(createPlatform(createNodeBacking(deps || {})));
  return globalThis.warewoolf;
}

function uninstallBridge(){
  delete globalThis.warewoolf;
}

module.exports = {
  createFakeBridge: createFakeBridge,
  installBridge: installBridge,
  uninstallBridge: uninstallBridge
};
