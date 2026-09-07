//The bridge. This is the only thing that runs in the renderer with Node reachable, and the only
//thing the page can see of the main process.
//
//It publishes exactly three functions on window.warewoolf - invoke, on, off - and nothing else.
//Handing the page `ipcRenderer` through contextBridge would have been one line and would have given
//up the whole exercise: every channel in the app, plus sendSync, plus sendTo, reachable from any
//script that ends up running here (a dependency parsing an imported .docx, say). What crosses
//instead is a command name checked against COMMANDS and an event name checked against EVENTS, both
//from platform.js - the same table the renderer and the main process are written against, so there
//is one list and not three.
//
//Two things are deliberately dropped on the way through:
//
//  1. The IpcRendererEvent. ipcRenderer.on hands a handler an event object carrying `sender`, which
//     is a live handle back into the ipc machinery. Forwarding it would put back exactly what
//     exposing ipcRenderer would have. Handlers get the payload arguments only.
//  2. Anything not named in COMMANDS/EVENTS. An unknown command rejects here rather than reaching
//     ipcMain, and an unknown event throws at subscribe time rather than becoming a listener on a
//     channel nothing sends - the failure mode platform.js's EVENTS list exists to prevent.
//
//This file is bundled (esbuild, src/preload.bundle.js) rather than loaded as source. A preload
//script only keeps arbitrary require() while `sandbox` is false, which is true today only because
//nodeIntegration is on; bundling means the one require left is 'electron', which a sandboxed
//preload still provides.

const { contextBridge, ipcRenderer } = require('electron');
const { COMMANDS, EVENTS } = require('./components/controllers/platform');

//ipcRenderer.on never sees the handler the caller gave us - it gets the wrapper below instead - so
//unsubscribing needs the mapping back. One record per registration, and off() removes exactly one,
//so a dialog that subscribes and unsubscribes over and over leaves nothing behind.
const registrations = [];

const bridge = {
  invoke: function(name, args){
    if(!Object.prototype.hasOwnProperty.call(COMMANDS, name))
      return Promise.reject(new Error('Unknown platform command "' + name + '".'));

    return ipcRenderer.invoke(name, args);
  },

  on: function(event, handler){
    if(EVENTS.indexOf(event) === -1)
      throw new Error('Unknown platform event "' + event + '".');

    const wrapped = function(){
      //Drop the IpcRendererEvent; hand over the payload only.
      return handler.apply(null, Array.prototype.slice.call(arguments, 1));
    };

    registrations.push({ event: event, handler: handler, wrapped: wrapped });
    ipcRenderer.on(event, wrapped);
  },

  off: function(event, handler){
    if(EVENTS.indexOf(event) === -1)
      throw new Error('Unknown platform event "' + event + '".');

    const index = registrations.findIndex(function(registration){
      return registration.event === event && registration.handler === handler;
    });
    if(index === -1)
      return;

    ipcRenderer.removeListener(event, registrations[index].wrapped);
    registrations.splice(index, 1);
  }
};

//contextIsolation is still false through Phase 9a - the bridge and the flag are shipped separately
//on purpose, so a failure is attributable to one or the other rather than to both at once. With it
//off there is no isolated world to expose into, so the object goes on the global directly; with it
//on, contextBridge does the copying. Either way the renderer reaches the same three functions under
//the same name, which is what lets 9b be a flag change and not a rewiring.
if(process.contextIsolated)
  contextBridge.exposeInMainWorld('warewoolf', bridge);
else
  globalThis.warewoolf = bridge;
