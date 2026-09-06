const test = require('node:test');
const assert = require('node:assert');

const { createPlatform, CODES } = require('../src/components/controllers/platform');
const { createIpcBacking, IMPLEMENTED } = require('../src/components/controllers/platform-ipc');

//A minimal stand-in for Electron's ipcRenderer - real enough to prove createIpcBacking() calls
//invoke() with the command name and args, and turns what comes back into what the contract expects.
function fakeIpcRenderer(invokeImpl){
  var listeners = {};
  return {
    invoke: invokeImpl,
    on: function(event, handler){
      (listeners[event] = listeners[event] || []).push(handler);
    },
    removeListener: function(event, handler){
      if(listeners[event] != null)
        listeners[event] = listeners[event].filter(function(h){ return h !== handler; });
    },
    _listeners: listeners
  };
}

test('every implemented command invokes the channel named after it, with the args passed through', async function(){
  const calls = [];
  const ipcRenderer = fakeIpcRenderer(function(channel, args){
    calls.push([channel, args]);
    return Promise.resolve(undefined);
  });
  const platform = createPlatform(createIpcBacking({ ipcRenderer: ipcRenderer }));

  await platform.setTheme({ mode: 'dark' });

  assert.deepStrictEqual(calls, [['setTheme', { mode: 'dark' }]]);
});

test('a resolved value passes straight through', async function(){
  const ipcRenderer = fakeIpcRenderer(function(){
    return Promise.resolve({ userData: '/u', home: '/h', temp: '/t', docs: '/d', app: '/a', downloads: '/dl' });
  });
  const platform = createPlatform(createIpcBacking({ ipcRenderer: ipcRenderer }));

  assert.deepStrictEqual(await platform.getAppPaths(),
    { userData: '/u', home: '/h', temp: '/t', docs: '/d', app: '/a', downloads: '/dl' });
});

//Electron does not forward a thrown error's custom properties across ipcMain.handle - only
//.message survives. index.js resolves with this envelope instead of rejecting, and this is the one
//place that has to turn it back into a real PlatformError, code intact.
test('a { __platformError } envelope becomes a real PlatformError with the same code', async function(){
  const ipcRenderer = fakeIpcRenderer(function(){
    return Promise.resolve({ __platformError: true, code: CODES.PERMISSION_DENIED, message: 'nope' });
  });
  const platform = createPlatform(createIpcBacking({ ipcRenderer: ipcRenderer }));

  await assert.rejects(platform.getAppPaths(), function(err){
    return err.isPlatformError === true && err.code === CODES.PERMISSION_DENIED && err.message === 'nope';
  });
});

//A rejected invoke() (the transport itself failing, not a handled command failure) still has to
//come back as a PlatformError - createPlatform's own wrapper does that mapping, so this backing
//just has to not swallow the rejection.
test('a rejected invoke() still surfaces as a PlatformError', async function(){
  const ipcRenderer = fakeIpcRenderer(function(){
    return Promise.reject(new Error('the main process is gone'));
  });
  const platform = createPlatform(createIpcBacking({ ipcRenderer: ipcRenderer }));

  await assert.rejects(platform.getPlatform(), function(err){
    return err.isPlatformError === true && err.code === CODES.IO_ERROR;
  });
});

test('commands outside this file\'s IMPLEMENTED list still reject with NOT_IMPLEMENTED', async function(){
  const ipcRenderer = fakeIpcRenderer(function(){ return Promise.resolve(undefined); });
  const platform = createPlatform(createIpcBacking({ ipcRenderer: ipcRenderer }));

  assert.ok(IMPLEMENTED.indexOf('buildEpub') === -1, 'buildEpub is group G, not part of this phase');

  await assert.rejects(platform.buildEpub({ filepath: 'x', htmlChapters: [], meta: {} }), function(err){
    return err.code === CODES.NOT_IMPLEMENTED;
  });
});

test('on/off subscribe and unsubscribe through the same ipcRenderer', function(){
  const ipcRenderer = fakeIpcRenderer(function(){ return Promise.resolve(undefined); });
  const platform = createPlatform(createIpcBacking({ ipcRenderer: ipcRenderer }));
  const handler = function(){};

  const unsubscribe = platform.on('save-clicked', handler);
  assert.deepStrictEqual(ipcRenderer._listeners['save-clicked'], [handler]);

  unsubscribe();
  assert.deepStrictEqual(ipcRenderer._listeners['save-clicked'], []);
});
