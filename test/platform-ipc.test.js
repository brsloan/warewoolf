const test = require('node:test');
const assert = require('node:assert');

const { createPlatform, COMMANDS, CODES, EVENTS } = require('../src/components/controllers/platform');
const { createIpcBacking, IMPLEMENTED } = require('../src/components/controllers/platform-ipc');

//A stand-in for what preload.js publishes as window.warewoolf. Deliberately not ipcRenderer-shaped:
//this backing must not be able to reach anything but invoke/on/off, so a test that handed it a
//richer object would be testing a surface the app does not have.
function fakeBridge(invokeImpl){
  var listeners = {};
  return {
    invoke: invokeImpl,
    on: function(event, handler){
      (listeners[event] = listeners[event] || []).push(handler);
    },
    off: function(event, handler){
      var index = (listeners[event] || []).indexOf(handler);
      if(index > -1)
        listeners[event].splice(index, 1);
    },
    _listeners: listeners
  };
}

function platformOver(invokeImpl){
  const bridge = fakeBridge(invokeImpl);
  return { bridge: bridge, platform: createPlatform(createIpcBacking({ bridge: bridge })) };
}

//The subset list this file used to carry is gone: through Phase 8 the main process only handled
//group A, so the backing declared what it had reached so far. Phase 9a registers a handler for all
//69 at once, and a hand-maintained list here would only be a second place to forget one.
test('the backing implements every command the contract declares', function(){
  assert.deepStrictEqual(IMPLEMENTED.slice().sort(), Object.keys(COMMANDS).sort());
  assert.strictEqual(IMPLEMENTED.length, 69);
});

test('every command invokes the bridge under its own name, with the args passed through', async function(){
  const calls = [];
  const over = platformOver(function(name, args){
    calls.push([name, args]);
    return Promise.resolve(undefined);
  });

  //Every one of them, not a sampled few - a name that drifts is a command that silently does
  //nothing, and there is no other test that would notice.
  for(const name of Object.keys(COMMANDS))
    await over.platform[name]({ probe: name });

  assert.deepStrictEqual(calls, Object.keys(COMMANDS).map(function(name){
    return [name, { probe: name }];
  }));
});

test('a resolved value passes straight through', async function(){
  const over = platformOver(function(){
    return Promise.resolve({ userData: '/u', home: '/h', temp: '/t', docs: '/d', app: '/a', downloads: '/dl' });
  });

  assert.deepStrictEqual(await over.platform.getAppPaths(),
    { userData: '/u', home: '/h', temp: '/t', docs: '/d', app: '/a', downloads: '/dl' });
});

//Electron does not forward a thrown error's custom properties across ipcMain.handle - only
//.message survives, and `code` arrives undefined. platform-host.js resolves with this envelope
//instead of rejecting, and this is the one place that has to turn it back into a real
//PlatformError. Without it every documented failure path in the contract collapses into one
//generic IO_ERROR, which is rule 5 going quiet for all 65 commands at once.
test('a { __platformError } envelope becomes a real PlatformError with the same code', async function(){
  const over = platformOver(function(){
    return Promise.resolve({ __platformError: true, code: CODES.PERMISSION_DENIED, message: 'nope' });
  });

  await assert.rejects(over.platform.getAppPaths(), function(err){
    return err.isPlatformError === true && err.code === CODES.PERMISSION_DENIED && err.message === 'nope';
  });
});

//`rolledBack` is the difference between "your chapter is still on disk under its old name" and "it
//is not, keep hasUnsavedChanges set". A caller that cannot see it drops work with no warning.
test('the envelope\'s details are restored onto the error', async function(){
  const over = platformOver(function(){
    return Promise.resolve({
      __platformError: true,
      code: CODES.PERMISSION_DENIED,
      message: 'write failed',
      details: { rolledBack: false, stashedAs: 'old_v_temp_ch.txt' }
    });
  });

  await assert.rejects(over.platform.saveChapterAtomic({}), function(err){
    return err.rolledBack === false && err.stashedAs === 'old_v_temp_ch.txt';
  });
});

//A rejected invoke() is the transport failing, not a handled command failure - createPlatform's own
//wrapper does the mapping, so this backing just has to not swallow it.
test('a rejected invoke() still surfaces as a PlatformError', async function(){
  const over = platformOver(function(){
    return Promise.reject(new Error('the main process is gone'));
  });

  await assert.rejects(over.platform.getPlatform(), function(err){
    return err.isPlatformError === true && err.code === CODES.IO_ERROR;
  });
});

//The renderer with no preload at all: a page loaded outside Electron, a preload that threw before
//it published. UNAVAILABLE says which of the two ends is missing; a bare "cannot read invoke of
//undefined" says nothing and arrives from three frames deeper.
test('a missing bridge is UNAVAILABLE rather than a TypeError', async function(){
  const platform = createPlatform(createIpcBacking({}));

  await assert.rejects(platform.getAppPaths(), function(err){
    return err.code === CODES.UNAVAILABLE && /preload/.test(err.message);
  });
});

//This file is required once and cached, so a bridge captured at module load would freeze to
//whichever one a test happened to install first - the same reason the pre-Phase-9 version resolved
//ipcRenderer per call rather than at the top of the file.
test('the bridge is resolved per call, not captured once', async function(){
  const backing = createIpcBacking();
  const platform = createPlatform(backing);
  const seen = [];

  try{
    globalThis.warewoolf = fakeBridge(function(name){ seen.push('first:' + name); return Promise.resolve(); });
    await platform.getPlatform();
    globalThis.warewoolf = fakeBridge(function(name){ seen.push('second:' + name); return Promise.resolve(); });
    await platform.getPlatform();
  }
  finally{
    delete globalThis.warewoolf;
  }

  assert.deepStrictEqual(seen, ['first:getPlatform', 'second:getPlatform']);
});

test('on/off subscribe and unsubscribe through the bridge', function(){
  const over = platformOver(function(){ return Promise.resolve(undefined); });
  const handler = function(){};

  const unsubscribe = over.platform.on('save-clicked', handler);
  assert.deepStrictEqual(over.bridge._listeners['save-clicked'], [handler]);

  unsubscribe();
  assert.deepStrictEqual(over.bridge._listeners['save-clicked'], []);
});

test('an event name outside the contract never reaches the bridge', function(){
  const over = platformOver(function(){ return Promise.resolve(undefined); });

  assert.throws(function(){
    over.platform.on('save-clicked-typo', function(){});
  }, function(err){
    return err.code === CODES.INVALID_ARGUMENT;
  });
  assert.strictEqual(Object.keys(over.bridge._listeners).length, 0);
  assert.strictEqual(EVENTS.length, 37);
});
