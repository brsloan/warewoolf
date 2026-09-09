const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { createPlatform, COMMANDS, CODES, PlatformError } = require('../src/components/controllers/platform');
const { createCommandHost, errorEnvelope, isErrorEnvelope } = require('../src/components/controllers/platform-host');

//The main-process half of the bridge, tested here rather than through index.js because index.js
//cannot be required outside Electron. Everything below is the real thing; only the ipcMain.handle
//registration around it lives in the file the suite cannot load.
function hostOver(impl){
  return createCommandHost(createPlatform(Object.assign({ on: function(){}, off: function(){} }, impl)));
}

test('a resolved command resolves with its value, not an envelope', async function(){
  const host = hostOver({ readTextFile: function(args){ return 'contents of ' + args.path; } });
  const result = await host.invoke('readTextFile', { path: '/a' });

  assert.strictEqual(result, 'contents of /a');
  assert.strictEqual(isErrorEnvelope(result), false);
});

test('a command with no arguments is handed an empty object rather than undefined', async function(){
  const seen = [];
  const host = hostOver({ getPlatform: function(args){ seen.push(args); return {}; } });

  await host.invoke('getPlatform', undefined);
  await host.invoke('getPlatform', null);

  assert.deepStrictEqual(seen, [{}, {}]);
});

//The whole reason this file exists. Electron reconstitutes a thrown error as a plain Error carrying
//.message and nothing else - so a rejection is resolved as a plain object instead, and
//platform-ipc.js rebuilds the PlatformError on the far side. Without this every documented failure
//in the contract arrives as an undefined `code`, which is rule 5 going silent for all 65 commands.
test('a rejected command resolves with an envelope carrying the code', async function(){
  const host = hostOver({
    openProject: function(){ throw PlatformError(CODES.NOT_FOUND, 'no such project'); }
  });

  const result = await host.invoke('openProject', { path: '/gone.woolf' });

  assert.strictEqual(isErrorEnvelope(result), true);
  assert.strictEqual(result.code, CODES.NOT_FOUND);
  assert.strictEqual(result.message, 'no such project');
});

test('an errno failure arrives as the mapped contract code, not IO_ERROR', async function(){
  const host = hostOver({
    loadChapter: function(){
      const err = new Error('EACCES: permission denied');
      err.code = 'EACCES';
      throw err;
    }
  });

  const result = await host.invoke('loadChapter', {});

  assert.strictEqual(result.code, CODES.PERMISSION_DENIED);
});

//saveChapterAtomic's `rolledBack` is the difference between "the chapter is still on disk under its
//old name" and "it is not, so keep hasUnsavedChanges set". Dropping it loses a manuscript quietly,
//which is why the envelope carries details at all rather than just code and message.
test('details set on the error survive into the envelope', async function(){
  const host = hostOver({
    saveChapterAtomic: function(){
      throw PlatformError(CODES.IO_ERROR, 'write failed', { rolledBack: false, stashedAs: 'old_v_temp_ch.txt' });
    }
  });

  const result = await host.invoke('saveChapterAtomic', {});

  assert.deepStrictEqual(result.details, { rolledBack: false, stashedAs: 'old_v_temp_ch.txt' });
});

test('the envelope carries only clonable fields - no Error, no stack, no prototype', function(){
  const envelope = errorEnvelope(PlatformError(CODES.LOCKED, 'locked', { service: 'email' }));

  assert.strictEqual(envelope instanceof Error, false);
  assert.deepStrictEqual(Object.keys(envelope).sort(), ['__platformError', 'code', 'details', 'message']);
  assert.deepStrictEqual(structuredClone(envelope), envelope);
});

test('a thrown non-Error still produces a usable envelope', function(){
  assert.deepStrictEqual(errorEnvelope(null),
    { __platformError: true, code: CODES.IO_ERROR, message: 'Unknown platform failure.', details: {} });
});

//preload.js already refuses an undeclared name, so this is the second of the two guards. It exists
//because preload is the one a future bridge (Tauri, a test harness) could forget to write, and
//"the renderer cannot ask for anything outside the table" should not rest on a single file.
test('an undeclared command name is refused rather than reaching the platform', async function(){
  const reached = [];
  const host = createCommandHost(new Proxy({}, {
    get: function(target, name){
      reached.push(name);
      return function(){ return Promise.resolve('reached'); };
    }
  }));

  const result = await host.invoke('readAnyFile', { path: '/etc/passwd' });

  assert.strictEqual(result.code, CODES.INVALID_ARGUMENT);
  assert.deepStrictEqual(reached, []);
});

test('createCommandHost refuses to wrap nothing', function(){
  assert.throws(function(){ createCommandHost(null); }, function(err){
    return err.code === CODES.INVALID_ARGUMENT;
  });
});

//---------------------------------------------------------------------------------------------
// index.js, read as text
//---------------------------------------------------------------------------------------------
//index.js requires 'electron' at its first line, so the suite cannot load it. It is also where a
//missing command handler would live, and a command with no handler on the main side is not a build
//error or a crash - it is an invoke() that hangs forever, in the app only. So the registration is
//written as a loop over the contract table itself, and this is what says so.
test('the main process registers a handler for every declared command, from the table itself', function(){
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

  assert.match(main, /Object\.keys\(COMMANDS\)\.forEach\(function\(name\)\{\s*ipcMain\.handle\(name,/,
    'index.js should register ipcMain.handle from Object.keys(COMMANDS), not one call per command');

  //And nothing hand-registers a command name alongside it, which is how the two lists drift apart.
  const handled = Array.from(main.matchAll(/ipcMain\.handle\(['"]([^'"]+)['"]/g), function(m){ return m[1]; });
  assert.deepStrictEqual(handled, [], 'no command should get its own hand-written ipcMain.handle');

  assert.strictEqual(Object.keys(COMMANDS).length, 72);
});

//The window has to be told where the bridge is, and the bundle is what ships - pointing at
//src/preload.js instead would work in development and load nothing in a package.
test('the window loads the built preload bundle', function(){
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

  assert.match(main, /preload:\s*path\.join\(__dirname,\s*'preload\.bundle\.js'\)/);
});


//index.js requires 'electron' at its first line, so nothing in this suite can load it - which means
//nothing in this suite notices if it does not parse. Every other file in src/ is either required by
//a test or pulled into the renderer bundle, where esbuild would fail the build; index.js is the one
//file with neither guard, and a syntax error in it is not a failing test, it is a native "A
//JavaScript error occurred in the main process" dialog and an app that never opens a window.
//
//Compiling it is as far as this can go without Electron - it does not run a line of it - but that
//is exactly the failure that has no other net. Phase 9a shipped a broken escape into this file and
//found it only by packaging the app and reading the crash dialog.
function compiles(relativePath){
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  new vm.Script(source, { filename: relativePath });
}

test('index.js parses', function(){
  assert.doesNotThrow(function(){ compiles('src/index.js'); });
});

test('preload.js parses', function(){
  assert.doesNotThrow(function(){ compiles('src/preload.js'); });
});
