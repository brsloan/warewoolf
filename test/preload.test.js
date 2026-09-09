const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { EVENTS, COMMANDS } = require('../src/components/controllers/platform');

const preloadPath = require.resolve('../src/preload');
const electronPath = require.resolve('electron');

//preload.js is the only file in the app that runs with Node reachable inside the renderer, so it is
//the one file where getting the exposed surface wrong hands the page back everything
//contextIsolation is meant to take away. Outside Electron `require('electron')` resolves to a path
//string, so it is faked in require.cache the same way render.test.js/keybindings.test.js already do.
//
//process.contextIsolated is undefined in plain Node, so the script takes its else branch and
//assigns globalThis.warewoolf directly - which is exactly what it does in the app today, with
//contextIsolation still false through Phase 9a.
function loadPreload(){
  var ipc = {
    listeners: [],
    invoked: [],
    invokeResult: undefined,
    invoke: function(name, args){
      ipc.invoked.push([name, args]);
      return Promise.resolve(ipc.invokeResult);
    },
    on: function(channel, handler){
      ipc.listeners.push({ channel: channel, handler: handler });
    },
    removeListener: function(channel, handler){
      ipc.listeners = ipc.listeners.filter(function(entry){
        return !(entry.channel === channel && entry.handler === handler);
      });
    }
  };
  var exposed = [];

  delete require.cache[preloadPath];
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      ipcRenderer: ipc,
      contextBridge: {
        exposeInMainWorld: function(key, api){ exposed.push([key, api]); }
      }
    }
  };

  delete globalThis.warewoolf;
  require(preloadPath);
  var bridge = globalThis.warewoolf;
  delete globalThis.warewoolf;
  delete require.cache[electronPath];
  delete require.cache[preloadPath];

  return { bridge: bridge, ipc: ipc, exposed: exposed };
}

test('the bridge exposes exactly invoke, on and off', function(){
  const loaded = loadPreload();

  assert.deepStrictEqual(Object.keys(loaded.bridge).sort(), ['invoke', 'off', 'on']);
});

//The one-line version of this file would have been contextBridge.exposeInMainWorld('ipc',
//ipcRenderer), and it would have handed the page every channel in the app plus sendSync and
//sendTo. Nothing the renderer can reach may be an ipcRenderer, however it got there.
test('nothing on the bridge is a way back to ipcRenderer', function(){
  const loaded = loadPreload();

  Object.keys(loaded.bridge).forEach(function(key){
    assert.strictEqual(typeof loaded.bridge[key], 'function', key + ' should be a plain function');
  });
  assert.strictEqual(loaded.bridge.send, undefined);
  assert.strictEqual(loaded.bridge.sendSync, undefined);
  assert.strictEqual(loaded.bridge.ipcRenderer, undefined);
});

test('a declared command reaches ipcRenderer.invoke under its own name', async function(){
  const loaded = loadPreload();
  loaded.ipc.invokeResult = 'result';

  const result = await loaded.bridge.invoke('loadChapter', { projectDir: '/p', filename: 'c.txt' });

  assert.strictEqual(result, 'result');
  assert.deepStrictEqual(loaded.ipc.invoked, [['loadChapter', { projectDir: '/p', filename: 'c.txt' }]]);
});

//The renderer names a command; the bridge is what decides whether that name means anything. A name
//the contract does not declare must not become an ipcMain channel probe.
test('an undeclared command never reaches ipcRenderer', async function(){
  const loaded = loadPreload();

  await assert.rejects(loaded.bridge.invoke('readAnyFile', { path: '/etc/passwd' }), /Unknown platform command/);
  assert.deepStrictEqual(loaded.ipc.invoked, []);
});

//The failure this list exists to prevent: a channel nothing sends, subscribed to silently, showing
//up as a menu item that does nothing at all.
test('an undeclared event throws at subscribe time rather than becoming a dead listener', function(){
  const loaded = loadPreload();

  assert.throws(function(){
    loaded.bridge.on('save-clicked-typo', function(){});
  }, /Unknown platform event/);
  assert.deepStrictEqual(loaded.ipc.listeners, []);

  assert.throws(function(){
    loaded.bridge.off('save-clicked-typo', function(){});
  }, /Unknown platform event/);
});

//ipcRenderer hands a handler an IpcRendererEvent whose `sender` is a live handle back into the ipc
//machinery. Forwarding it would put back exactly what not exposing ipcRenderer took away.
test('a handler receives the payload only, never the IpcRendererEvent', function(){
  const loaded = loadPreload();
  const seen = [];

  loaded.bridge.on('about-clicked', function(){
    seen.push(Array.prototype.slice.call(arguments));
  });

  assert.strictEqual(loaded.ipc.listeners.length, 1);

  //What Electron actually calls the wrapper with.
  loaded.ipc.listeners[0].handler({ sender: 'the whole ipc surface' }, '2.4.0');

  assert.deepStrictEqual(seen, [['2.4.0']]);
});

test('off removes the wrapper the handler was registered under', function(){
  const loaded = loadPreload();
  const handler = function(){};

  loaded.bridge.on('save-clicked', handler);
  assert.strictEqual(loaded.ipc.listeners.length, 1);

  loaded.bridge.off('save-clicked', handler);
  assert.deepStrictEqual(loaded.ipc.listeners, []);

  //Unsubscribing something that was never subscribed is a no-op, not a throw - platform.js hands
  //back an unsubscribe function that a caller may run twice.
  loaded.bridge.off('save-clicked', handler);
  assert.deepStrictEqual(loaded.ipc.listeners, []);
});

test('off removes one registration, leaving a second subscription of the same handler alive', function(){
  const loaded = loadPreload();
  const handler = function(){};

  loaded.bridge.on('save-clicked', handler);
  loaded.bridge.on('save-clicked', handler);
  loaded.bridge.off('save-clicked', handler);

  assert.strictEqual(loaded.ipc.listeners.length, 1);
});

//With contextIsolation on there is no shared global to assign to, so the bridge has to go through
//contextBridge instead. The branch is taken on process.contextIsolated, which plain Node leaves
//undefined - this drives the other side of it.
test('with contextIsolation on, the bridge is published through contextBridge instead', function(){
  const original = Object.getOwnPropertyDescriptor(process, 'contextIsolated');
  Object.defineProperty(process, 'contextIsolated', { value: true, configurable: true });

  try{
    const loaded = loadPreload();

    assert.strictEqual(loaded.bridge, undefined, 'nothing should be assigned to the global');
    assert.strictEqual(loaded.exposed.length, 1);
    assert.strictEqual(loaded.exposed[0][0], 'warewoolf');
    assert.deepStrictEqual(Object.keys(loaded.exposed[0][1]).sort(), ['invoke', 'off', 'on']);
  }
  finally{
    if(original)
      Object.defineProperty(process, 'contextIsolated', original);
    else
      delete process.contextIsolated;
  }
});

//The bundle is what the app actually loads (index.js points webPreferences.preload at
//preload.bundle.js), and it is generated rather than committed - so a build that never ran, or an
//esbuild resolution failure, would ship a window with no bridge in it and every command failing
//UNAVAILABLE. render-bundle.test.js exists for the same reason on the renderer side.
test('the built preload bundle publishes the same three functions', function(){
  const bundlePath = path.join(__dirname, '..', 'src', 'preload.bundle.js');

  delete require.cache[bundlePath];
  require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: {
      ipcRenderer: { invoke: function(){ return Promise.resolve(); }, on: function(){}, removeListener: function(){} },
      contextBridge: { exposeInMainWorld: function(){} }
    }
  };
  delete globalThis.warewoolf;
  require(bundlePath);
  const bridge = globalThis.warewoolf;
  delete globalThis.warewoolf;
  delete require.cache[electronPath];
  delete require.cache[bundlePath];

  assert.deepStrictEqual(Object.keys(bridge).sort(), ['invoke', 'off', 'on']);
  //The bundle carries its own copy of the contract table, so a stale bundle would validate against
  //a stale command list.
  assert.strictEqual(EVENTS.length, 40);
  assert.strictEqual(Object.keys(COMMANDS).length, 72);
});
