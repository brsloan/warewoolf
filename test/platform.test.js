const nodeTest = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('node:os');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const archiver = require('archiver');
const unzipper = require('unzipper');
const { Writable, Readable } = require('node:stream');
const { EventEmitter } = require('node:events');

const {
  createPlatform, COMMANDS, EVENTS, CODES, PlatformError, SAVED_SECRET
} = require('../src/components/controllers/platform');
const { createNodeBacking, NOTES_PREPEND, OLD_VERSION_FLAG } = require('../src/components/controllers/platform-node');
const { createIpcBacking } = require('../src/components/controllers/platform-ipc');
const { createFakeBridge } = require('./fake-bridge');

//Real temp directories, like every other test here - the facade exists so the suite can keep doing
//this rather than growing a filesystem mock.
function tempDir(t){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-platform-')) + path.sep;
  t.after(function(){
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function keystore(available){
  const vault = {};
  return {
    isAvailable: function(){ return available; },
    encrypt: function(text){
      const handle = 'handle-' + Object.keys(vault).length;
      vault[handle] = text;
      return handle;
    },
    decrypt: function(handle){ return vault[handle] == null ? null : vault[handle]; }
  };
}

function backingIn(t, options){
  const dir = tempDir(t);
  const opts = options || {};
  return {
    dir: dir,
    backing: createNodeBacking({
      paths: { userData: dir },
      secureStorage: opts.secureStorage === undefined ? keystore(false) : opts.secureStorage
    })
  };
}

//---------------------------------------------------------------------------------------------
// The two transports every test below runs against.
//---------------------------------------------------------------------------------------------
//
//`direct` is what this file has always done: createPlatform over the node backing, one function
//call, no serialization anywhere.
//
//`bridge` is the same suite with a real structured-clone boundary in the middle - platform-ipc.js
//on the near side, platform-host.js on the far side, exactly the two halves the app runs. Until
//Phase 9a there was no way to run any of these against the ipc backing at all, which meant nothing
//in the suite said the two backings behave alike. That was the stated purpose of the Phase 5
//backfill and it could not be fulfilled as written.
//
//Duplicating 119 tests would have been the other way to get here, and would have tested the copies
//rather than the boundary. What this catches instead is the class of failure the boundary itself
//introduces and nothing else can see: a PlatformError arriving as a plain Error with `code`
//undefined (which turns all 65 commands' documented failures into one generic IO_ERROR and takes
//rule 5 with them), a Buffer arriving as a Uint8Array, a Date, an undefined-vs-null, a value that
//does not survive the clone at all - and SAVED_SECRET, which is a string with NUL bytes in it.
//
//A handful of tests below assert on the contract table, the source files, or createPlatform itself
//rather than on a command's behavior; those use testOnce() and are defined for the first transport
//only, since running them through a bridge asserts nothing new.
const TRANSPORTS = [
  {
    label: 'direct',
    suffix: '',
    wrap: function(backing){ return createPlatform(backing); }
  },
  {
    label: 'bridge',
    suffix: ' [through the bridge]',
    wrap: function(backing){
      return createPlatform(createIpcBacking({ bridge: createFakeBridge(createPlatform(backing)) }));
    }
  }
];

TRANSPORTS.forEach(function(transport, transportIndex){

//Shadows node:test's own `test` so every declaration below gets the transport's name appended
//without 179 call sites having to say so.
function test(name, fn){
  nodeTest(name + transport.suffix, fn);
}

function testOnce(name, fn){
  if(transportIndex === 0)
    nodeTest(name, fn);
}

function wrap(backing){
  return transport.wrap(backing);
}

function platformIn(t, options){
  const built = backingIn(t, options);
  return { dir: built.dir, backing: built.backing, platform: wrap(built.backing) };
}

//A write stream whose 'finish' and 'close' are decoupled, for proving buildEpub/archiveProject
//resolve on 'close' and not on 'finish'. 'finish' fires for real, off real data flowing through it
//(archiver still writes real chunks and calls .end() when done) - only 'close' is held back, until
//the test calls triggerClose() itself. autoDestroy: false is what decouples them: a plain Writable
//otherwise calls destroy() right after 'finish', which emits 'close' a tick later on its own.
//
//This exists because the property it tests is not observable through a real fs.createWriteStream
//on this codebase's fixtures - 'finish' and 'close' land close enough together on a fast local
//filesystem that no same-process read-back detects the gap (see the Phase 6 write-up in
//upgrade-and-isolation-plan.md: swapping 'close' for 'finish' in the implementation left every
//existing test, including the ones reading the result back as a valid zip, green).
function controllableWriteStream(){
  const stream = new Writable({
    autoDestroy: false,
    write: function(chunk, enc, cb){ cb(); }
  });
  stream.triggerClose = function(){ stream.emit('close'); };
  return stream;
}

//Restores whatever it replaced when the test ends, so a patched fs cannot leak into the next one.
function patch(t, object, key, replacement){
  const original = object[key];
  object[key] = replacement;
  t.after(function(){
    object[key] = original;
  });
  return original;
}

//---------------------------------------------------------------------------------------------
// Group K fakes - checkForUpdate/downloadUpdate use https.request/https.get shaped functions,
// installUpdate/wifi*/getBatteryCapacity use spawn-shaped ones, and sendEmail uses a
// createTransport-shaped one. All four are injected straight into createNodeBacking() (the same
// seam createWriteStream already is), so - unlike updates.js's/wifi-manager.js's own standing
// instances, which resolve these once at module load - every test here builds its own instance
// with the fake baked in from construction, with no "mock before you construct" ordering to get
// right.
//---------------------------------------------------------------------------------------------

function fakeHttpsRequest(spec){
  return function(options, callback){
    const req = new EventEmitter();
    req.destroy = function(err){ req.emit('error', err); };
    req.end = function(){
      if(spec.triggerError){
        setImmediate(function(){ req.emit('error', spec.triggerError); });
        return;
      }
      setImmediate(function(){
        const res = new EventEmitter();
        res.statusCode = spec.statusCode || 200;
        callback(res);
        setImmediate(function(){
          res.emit('data', Buffer.from(spec.body));
          res.emit('end');
        });
      });
    };
    return req;
  };
}

//Sequential https.get responses, for following one redirect - each call consumes the next entry.
function fakeHttpsGet(responses){
  const calls = [];
  const fn = function(url, callback){
    calls.push(url);
    const spec = responses[calls.length - 1];
    const req = new EventEmitter();
    req.end = function(){};

    if(spec.triggerError){
      setImmediate(function(){ req.emit('error', spec.triggerError); });
      return req;
    }

    setImmediate(function(){
      const res = spec.body != null
        ? Readable.from([Buffer.from(spec.body)])
        : new Readable({ read: function(){ this.push(null); } });
      res.statusCode = spec.statusCode;
      res.headers = spec.headers || {};
      callback(res);
    });

    return req;
  };
  fn.calls = calls;
  return fn;
}

function fakeChildProcess(){
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdinChunks = [];
  child.stdin = {
    write: function(chunk){ child.stdinChunks.push(chunk); },
    end: function(){}
  };
  return child;
}

//Sequential spawn calls, in order - each response can supply stdout/stderr chunks, a close code,
//or a spawn-level error. 'close' fires on both the child and child.stdout so it works regardless
//of which one the code under test listens on, matching wifi-manager.test.js's/
//battery-monitor.test.js's own helper.
function fakeSpawn(responses){
  const calls = [];
  const fn = function(command, args, options){
    calls.push({ command: command, args: args, options: options });
    const child = fakeChildProcess();
    const spec = responses[calls.length - 1] || {};
    setImmediate(function(){
      if(spec.error){
        child.emit('error', spec.error);
        return;
      }
      (spec.stderrChunks || []).forEach(function(chunk){ child.stderr.emit('data', Buffer.from(chunk)); });
      (spec.chunks || []).forEach(function(chunk){ child.stdout.emit('data', Buffer.from(chunk)); });
      const code = spec.code != null ? spec.code : 0;
      child.emit('close', code);
      child.stdout.emit('close', code);
    });
    return child;
  };
  fn.calls = calls;
  return fn;
}

function fakeMailTransport(sendMailImpl){
  return function(config){
    return { config: config, sendMail: sendMailImpl };
  };
}

async function rejection(promise){
  try{
    await promise;
  }
  catch(err){
    return err;
  }

  throw new Error('Expected the command to reject, and it resolved.');
}

// ---------------------------------------------------------------------------------------------
// The contract itself
// ---------------------------------------------------------------------------------------------

test('the facade exposes exactly the declared commands and nothing else', function(t){
  const platform = platformIn(t).platform;
  const exposed = Object.keys(platform).sort();
  const expected = Object.keys(COMMANDS).concat(['on', 'off', 'SAVED_SECRET']).sort();

  assert.deepStrictEqual(exposed, expected);
});

//The point of a boundary is that it is enumerable. A backing method that is not in COMMANDS is
//unreachable no matter what it is called, which is what lets "the renderer cannot read a stored
//secret" be a checkable claim rather than a convention.
test('a backing method that is not a declared command is unreachable', function(t){
  const built = platformIn(t);

  assert.strictEqual(typeof built.backing.resolveSecret, 'function');
  assert.strictEqual(built.platform.resolveSecret, undefined);
  assert.strictEqual(built.platform.getCredential, undefined);
  assert.strictEqual(COMMANDS.getCredential, undefined);
  assert.strictEqual(COMMANDS.resolveSecret, undefined);
});

test('a live platform cannot be extended with an undeclared command', function(t){
  const platform = platformIn(t).platform;

  assert.throws(function(){
    'use strict';
    platform.readAnyFile = function(){};
  });
  assert.strictEqual(platform.readAnyFile, undefined);
});

//Every group is implemented in the node backing as of Phase 8, so this can no longer point at a
//real gap in createNodeBacking the way it did through Phase 7 (checkForUpdate, back when group K
//was still outstanding). A bare-bones fake backing missing one method proves the same createPlatform-
//level property - NOT_IMPLEMENTED, not a bare "not a function" TypeError, for anything COMMANDS
//declares but a backing does not supply - independent of which group happens to be finished.
testOnce('a declared command the backing does not implement rejects with NOT_IMPLEMENTED', async function(t){
  const platform = createPlatform({ on: function(){}, off: function(){} });
  const err = await rejection(platform.checkForUpdate({}));

  assert.strictEqual(err.code, CODES.NOT_IMPLEMENTED);
  assert.strictEqual(err.command, 'checkForUpdate');
  assert.match(err.message, /group K/);
});

//A caller must never have to both try/catch and .catch() the same command, so a backing that fails
//before it ever returns a promise still comes back as a rejection.
testOnce('a backing that throws synchronously still rejects', async function(){
  const platform = createPlatform({
    logError: function(){ throw new Error('boom'); },
    on: function(){}, off: function(){}
  });

  const err = await rejection(platform.logError({ text: 'x' }));

  assert.strictEqual(err.isPlatformError, true);
  assert.strictEqual(err.code, CODES.IO_ERROR);
  assert.strictEqual(err.command, 'logError');
});

testOnce('errno codes become stable contract codes', async function(){
  const cases = [
    ['ENOENT', CODES.NOT_FOUND],
    ['EACCES', CODES.PERMISSION_DENIED],
    ['EROFS', CODES.PERMISSION_DENIED],
    ['EEXIST', CODES.ALREADY_EXISTS],
    ['ENOTDIR', CODES.INVALID_ARGUMENT],
    ['EBUSY', CODES.IO_ERROR]
  ];

  for(const [errno, expected] of cases){
    const platform = createPlatform({
      readTextFile: function(){
        const err = new Error(errno + ' happened');
        err.code = errno;
        throw err;
      },
      on: function(){}, off: function(){}
    });

    const err = await rejection(platform.readTextFile({ path: '/x' }));
    assert.strictEqual(err.code, expected, errno + ' should map to ' + expected);
  }
});

//A backing that already speaks the contract - the ipc and tauri ones will, having reconstituted a
//code from the wire - must not have its code rewritten to IO_ERROR on the way out.
testOnce('an error that is already a PlatformError passes through unchanged', async function(){
  const platform = createPlatform({
    pathExists: function(){ throw PlatformError(CODES.LOCKED, 'already ours'); },
    on: function(){}, off: function(){}
  });

  const err = await rejection(platform.pathExists({ path: '/x' }));

  assert.strictEqual(err.code, CODES.LOCKED);
  assert.strictEqual(err.message, 'already ours');
});

test('every command is documented and takes a single object argument', function(t){
  const platform = platformIn(t).platform;

  Object.keys(COMMANDS).forEach(function(name){
    const command = COMMANDS[name];

    assert.match(command.group, /^[A-K]$/, name + ' needs an inventory group');
    assert.ok(Array.isArray(command.params), name + ' needs a params list');
    assert.strictEqual(typeof command.returns, 'string', name + ' needs a documented return shape');
    //Tauri's invoke() takes named arguments; positional ones do not exist in its IPC. Every command
    //therefore has exactly one parameter, and it is an object.
    assert.strictEqual(platform[name].length, 1, name + ' should take one object argument');

    (command.optional || []).forEach(function(key){
      assert.ok(command.params.indexOf(key) === -1,
        name + ': "' + key + '" is listed as both required and optional');
    });
  });
});

testOnce('every group in the inventory is represented', function(){
  const groups = {};
  Object.keys(COMMANDS).forEach(function(name){
    groups[COMMANDS[name].group] = true;
  });

  assert.deepStrictEqual(Object.keys(groups).sort(),
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']);
});

//All 37 main -> renderer channels, not just the file-open one the inventory names. A typo has to
//fail here rather than becoming a menu item that quietly does nothing.
test('events are validated by name and unsubscribe cleanly', function(t){
  const built = platformIn(t);
  const seen = [];
  const handler = function(){ seen.push(1); };

  assert.strictEqual(EVENTS.length, 38);
  assert.ok(EVENTS.indexOf('save-clicked') > -1);

  const unsubscribe = built.platform.on('save-clicked', handler);
  assert.strictEqual(typeof unsubscribe, 'function');
  unsubscribe();

  assert.throws(function(){
    built.platform.on('save-clicked-typo', handler);
  }, function(err){
    return err.code === CODES.INVALID_ARGUMENT;
  });
});

//The property that makes the contract survive Phase 9: platform.js requires nothing at all, so it
//still builds once esbuild switches to --platform=browser and Node builtins stop resolving.
//platform-node.js is the file that has to be gone by then, and this is what says so out loud.
//The one guard standing between Phase 9 and a menu that silently stops working. EVENTS holds the
//literal channel names index.js sends on - the ipc backing passes them straight to
//ipcRenderer.on() - so a name that drifts from the main process subscribes to a channel nothing
//sends, with no error anywhere. Phase 1 shipped exactly that mistake in one of the 36 entries.
testOnce('every event name matches a channel the main process actually sends', function(){
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
  const sent = new Set(Array.from(main.matchAll(/webContents\.send\(['"]([^'"]+)['"]/g),
    function(match){ return match[1]; }));

  assert.deepStrictEqual(EVENTS.filter(function(event){ return !sent.has(event); }), [],
    'declared events the main process never sends');
  assert.deepStrictEqual(Array.from(sent).filter(function(channel){ return EVENTS.indexOf(channel) === -1; }), [],
    'channels the main process sends that EVENTS does not declare');
});

testOnce('the contract file itself reaches for nothing native', function(){
  const contract = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'controllers', 'platform.js'), 'utf8');

  assert.strictEqual(contract.indexOf('require('), -1);
});

testOnce('createPlatform refuses to wrap nothing', function(){
  assert.throws(function(){
    createPlatform(null);
  }, function(err){
    return err.code === CODES.INVALID_ARGUMENT;
  });
});

// ---------------------------------------------------------------------------------------------
// Group A - environment and shell
// ---------------------------------------------------------------------------------------------
// The node backing's implementation of this group is exercised only here - the shipped app uses
// platform-ipc.js for it instead (see that file's own header comment for why), so this is the one
// place these five deps (appPaths via `paths`, fileRequestedOnOpen, and the four action hooks) are
// under test at all.

test('getAppPaths returns exactly the six documented fields, field by field', async function(){
  const platform = wrap(createNodeBacking({
    paths: { userData: '/u', home: '/h', temp: '/t', docs: '/d', app: '/a', downloads: '/dl',
      somethingElseEntirely: 'should not leak' }
  }));

  const paths = await platform.getAppPaths();

  assert.deepStrictEqual(paths, {
    userData: '/u', home: '/h', temp: '/t', docs: '/d', app: '/a', downloads: '/dl'
  });
});

test('getPlatform reports this process\'s own platform and arch', async function(){
  const platform = wrap(createNodeBacking({}));

  assert.deepStrictEqual(await platform.getPlatform(), {
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron || null
  });
});

//The suite runs on plain node, where there is no process.versions.electron at all. That has to
//arrive as null rather than a missing key: updates.js reads it across the ipc backing, and a key
//whose value is undefined is not guaranteed to survive that trip, so the shape the renderer sees
//would quietly differ from the shape this backing returns in-process.
test('getPlatform reports a null electron version off Electron rather than omitting the field', async function(){
  const platform = wrap(createNodeBacking({}));
  const info = await platform.getPlatform();

  assert.ok('electron' in info, 'electron must always be present as a key');
  assert.strictEqual(info.electron, process.versions.electron || null);
});

test('getFileRequestedOnOpen returns whatever the backing was constructed with, or null', async function(){
  const withOne = wrap(createNodeBacking({ fileRequestedOnOpen: '/opened/via/argv.woolf' }));
  const withNone = wrap(createNodeBacking({}));

  assert.strictEqual(await withOne.getFileRequestedOnOpen(), '/opened/via/argv.woolf');
  assert.strictEqual(await withNone.getFileRequestedOnOpen(), null);
});

//setTheme/showAppMenu/confirmExit/notifyRendererReady have no return value - what a backing does
//with them is entirely the injected hook's business, which is exactly what these assert.
test('setTheme, showAppMenu, confirmExit, and notifyRendererReady call their injected hooks', async function(){
  const seen = { mode: undefined, menu: 0, exit: 0, ready: 0 };
  const platform = wrap(createNodeBacking({
    onSetTheme: function(mode){ seen.mode = mode; },
    onShowAppMenu: function(){ seen.menu++; },
    onConfirmExit: function(){ seen.exit++; },
    onNotifyRendererReady: function(){ seen.ready++; }
  }));

  await platform.setTheme({ mode: 'dark' });
  await platform.showAppMenu({});
  await platform.confirmExit({});
  await platform.notifyRendererReady({});

  assert.deepStrictEqual(seen, { mode: 'dark', menu: 1, exit: 1, ready: 1 });
});

test('setTheme, showAppMenu, confirmExit, and notifyRendererReady are no-ops without injected hooks', async function(){
  const platform = wrap(createNodeBacking({}));

  await assert.doesNotReject(platform.setTheme({ mode: 'light' }));
  await assert.doesNotReject(platform.showAppMenu({}));
  await assert.doesNotReject(platform.confirmExit({}));
  await assert.doesNotReject(platform.notifyRendererReady({}));
});

// ---------------------------------------------------------------------------------------------
// saveChapterAtomic - the transactional command the contract is shaped around
// ---------------------------------------------------------------------------------------------

test('a chapter with no file yet is written under a name the command allocates', async function(t){
  const built = platformIn(t);

  const saved = await built.platform.saveChapterAtomic({
    projectDir: built.dir, chapsDir: '', oldFilename: null, title: 'Chapter One', mdfc: 'first draft'
  });

  assert.strictEqual(saved.filename, 'Chapter One.txt');
  assert.strictEqual(fs.readFileSync(built.dir + saved.filename, 'utf8'), 'first draft');
});

//The property that fails if the name is allocated before the old file is stashed: the allocator
//would find the chapter's own file under the name it wants and hand back "Chapter One_2.txt",
//renaming the file on every single save and leaving the previous one behind.
test('saving an unchanged title reuses the same filename and leaves nothing behind', async function(t){
  const built = platformIn(t);
  const location = { projectDir: built.dir, chapsDir: '', title: 'Chapter One' };

  const first = await built.platform.saveChapterAtomic(Object.assign({ oldFilename: null, mdfc: 'v1' }, location));
  const second = await built.platform.saveChapterAtomic(Object.assign({ oldFilename: first.filename, mdfc: 'v2' }, location));

  assert.strictEqual(second.filename, first.filename);
  assert.strictEqual(fs.readFileSync(built.dir + second.filename, 'utf8'), 'v2');
  assert.deepStrictEqual(fs.readdirSync(built.dir), ['Chapter One.txt']);
});

test('a renamed chapter moves to a new file and its notes follow', async function(t){
  const built = platformIn(t);

  const first = await built.platform.saveChapterAtomic({
    projectDir: built.dir, chapsDir: '', oldFilename: null, title: 'Draft', mdfc: 'v1', notesMdfc: 'note one'
  });
  assert.strictEqual(first.notesFilename, NOTES_PREPEND + 'Draft.txt');

  const renamed = await built.platform.saveChapterAtomic({
    projectDir: built.dir, chapsDir: '', oldFilename: first.filename, title: 'The Arrival', mdfc: 'v2'
  });

  assert.strictEqual(renamed.filename, 'The Arrival.txt');
  assert.strictEqual(renamed.notesFilename, NOTES_PREPEND + 'The Arrival.txt');
  assert.strictEqual(fs.existsSync(built.dir + 'Draft.txt'), false);
  assert.strictEqual(fs.existsSync(built.dir + NOTES_PREPEND + 'Draft.txt'), false);
  //The notes moved with the chapter rather than being rewritten, so their contents are untouched.
  assert.strictEqual(fs.readFileSync(built.dir + renamed.notesFilename, 'utf8'), 'note one');
});

//Rule 3 of the contract: the command returns what the renderer must not compute. Two chapters
//titled the same cannot both be "Untitled.txt", and only the side doing the write can know that.
test('identical titles get distinct files, chosen by the command', async function(t){
  const built = platformIn(t);

  const one = await built.platform.saveChapterAtomic({
    projectDir: built.dir, chapsDir: '', oldFilename: null, title: 'Interlude', mdfc: 'a'
  });
  const two = await built.platform.saveChapterAtomic({
    projectDir: built.dir, chapsDir: '', oldFilename: null, title: 'Interlude', mdfc: 'b'
  });

  assert.strictEqual(one.filename, 'Interlude.txt');
  assert.strictEqual(two.filename, 'Interlude_2.txt');
  assert.strictEqual(fs.readFileSync(built.dir + one.filename, 'utf8'), 'a');
  assert.strictEqual(fs.readFileSync(built.dir + two.filename, 'utf8'), 'b');
});

test('a failed write is rolled back and the old contents survive', async function(t){
  const built = platformIn(t);

  const first = await built.platform.saveChapterAtomic({
    projectDir: built.dir, chapsDir: '', oldFilename: null, title: 'Chapter One', mdfc: 'the good version'
  });

  patch(t, fs, 'writeFileSync', function(){
    const err = new Error('EACCES: permission denied');
    err.code = 'EACCES';
    throw err;
  });

  const err = await rejection(built.platform.saveChapterAtomic({
    projectDir: built.dir, chapsDir: '', oldFilename: first.filename, title: 'Chapter One', mdfc: 'the lost version'
  }));

  assert.strictEqual(err.code, CODES.PERMISSION_DENIED);
  assert.strictEqual(err.rolledBack, true);
  assert.strictEqual(fs.readFileSync(built.dir + first.filename, 'utf8'), 'the good version');
  assert.deepStrictEqual(fs.readdirSync(built.dir), ['Chapter One.txt']);
});

//The outcome the renderer has to be able to tell apart: the write failed AND the old version could
//not be put back, so the chapter has no file on disk at all and hasUnsavedChanges must stay set.
//Two outcomes would collapse this into the one above, which is why the command rejects with a flag
//rather than returning a boolean.
test('a failed rollback is reported as a different outcome from a successful one', async function(t){
  const built = platformIn(t);

  const first = await built.platform.saveChapterAtomic({
    projectDir: built.dir, chapsDir: '', oldFilename: null, title: 'Chapter One', mdfc: 'v1'
  });

  patch(t, fs, 'writeFileSync', function(){
    const err = new Error('EACCES: permission denied');
    err.code = 'EACCES';
    throw err;
  });
  const realRename = patch(t, fs, 'renameSync', function(from, to){
    //Let the stash succeed and only the restore fail, which is the sequence that strands the file.
    if(String(from).indexOf(OLD_VERSION_FLAG) > -1)
      throw new Error('EIO: rename failed');
    return realRename(from, to);
  });

  const err = await rejection(built.platform.saveChapterAtomic({
    projectDir: built.dir, chapsDir: '', oldFilename: first.filename, title: 'Chapter One', mdfc: 'v2'
  }));

  assert.strictEqual(err.rolledBack, false);
  //Says where the previous contents actually are, so a recovery path has something to work with.
  assert.strictEqual(err.stashedAs, OLD_VERSION_FLAG + 'Chapter One.txt');
  assert.strictEqual(fs.existsSync(built.dir + err.stashedAs), true);
});

//A chapter flagged by verifyProjectFiles: the project still names a file that is no longer on disk.
//Saving it has to work, not fail on the missing old version.
test('a chapter whose file is missing from disk still saves', async function(t){
  const built = platformIn(t);

  const saved = await built.platform.saveChapterAtomic({
    projectDir: built.dir, chapsDir: '', oldFilename: 'vanished.txt', title: 'Chapter One', mdfc: 'recovered'
  });

  assert.strictEqual(saved.filename, 'Chapter One.txt');
  assert.strictEqual(fs.readFileSync(built.dir + saved.filename, 'utf8'), 'recovered');
});

test('notes are written under the new name in the same call', async function(t){
  const built = platformIn(t);

  const saved = await built.platform.saveChapterAtomic({
    projectDir: built.dir, chapsDir: '', oldFilename: null, title: 'Chapter One',
    mdfc: 'body', notesMdfc: 'remember the lighthouse'
  });

  assert.strictEqual(saved.notesError, null);
  assert.strictEqual(fs.readFileSync(built.dir + saved.notesFilename, 'utf8'), 'remember the lighthouse');
});

//The chapter's own file is the transaction; notes are not. Losing a note is bad, losing the chapter
//that was already written successfully would be worse - so this is reported, not thrown, and not
//swallowed either.
test('a notes failure is reported without failing the chapter save', async function(t){
  const built = platformIn(t);
  const realWrite = patch(t, fs, 'writeFileSync', function(target, contents, encoding){
    if(String(target).indexOf(NOTES_PREPEND) > -1){
      const err = new Error('ENOSPC: no space left on device');
      err.code = 'ENOSPC';
      throw err;
    }
    return realWrite(target, contents, encoding);
  });

  const saved = await built.platform.saveChapterAtomic({
    projectDir: built.dir, chapsDir: '', oldFilename: null, title: 'Chapter One',
    mdfc: 'body', notesMdfc: 'lost note'
  });

  assert.strictEqual(saved.filename, 'Chapter One.txt');
  assert.strictEqual(fs.readFileSync(built.dir + saved.filename, 'utf8'), 'body');
  assert.strictEqual(saved.notesError.code, CODES.IO_ERROR);
  assert.match(saved.notesError.message, /ENOSPC/);
});

test('a chapter command refuses arguments it cannot act on', async function(t){
  const built = platformIn(t);

  const noDir = await rejection(built.platform.saveChapterAtomic({ title: 'x', mdfc: 'y' }));
  assert.strictEqual(noDir.code, CODES.INVALID_ARGUMENT);

  const noText = await rejection(built.platform.saveChapterAtomic({
    projectDir: built.dir, chapsDir: '', title: 'x', mdfc: null
  }));
  assert.strictEqual(noText.code, CODES.INVALID_ARGUMENT);
});

test('Save Copy allocates a fresh name and leaves the original alone', async function(t){
  const built = platformIn(t);

  await built.platform.saveChapterAtomic({
    projectDir: built.dir, chapsDir: '', oldFilename: null, title: 'Chapter One', mdfc: 'original'
  });
  const copy = await built.platform.saveChapter({
    projectDir: built.dir, chapsDir: '', title: 'Chapter One', mdfc: 'copy'
  });

  assert.strictEqual(copy.filename, 'Chapter One_2.txt');
  assert.strictEqual(fs.readFileSync(built.dir + 'Chapter One.txt', 'utf8'), 'original');
});

// ---------------------------------------------------------------------------------------------
// The rest of group C - chapter reads, notes, deletion
// ---------------------------------------------------------------------------------------------

//loadChapter hands back text, not a parsed chapter: which format that text is in is decided from
//the filename by the caller, because parsing either format is pure string work with no OS in it.
test('loadChapter returns the file\'s text verbatim, whatever format it is in', async function(t){
  const built = platformIn(t);
  fs.writeFileSync(built.dir + 'legacy.pup', '{"ops":[{"insert":"json chapter"}]}', 'utf8');
  fs.writeFileSync(built.dir + 'modern.txt', 'markdownfic chapter', 'utf8');

  assert.strictEqual(await built.platform.loadChapter({ projectDir: built.dir, chapsDir: '', filename: 'modern.txt' }),
    'markdownfic chapter');
  assert.strictEqual(await built.platform.loadChapter({ projectDir: built.dir, chapsDir: '', filename: 'legacy.pup' }),
    '{"ops":[{"insert":"json chapter"}]}');
});

test('loadChapter rejects NOT_FOUND for a chapter file that is not there', async function(t){
  const built = platformIn(t);

  const err = await rejection(built.platform.loadChapter({
    projectDir: built.dir, chapsDir: '', filename: 'gone.txt'
  }));

  assert.strictEqual(err.code, CODES.NOT_FOUND);
});

//A chapter and its notes are one document to the reader, so an orphaned notes file left behind by
//a deletion is not a state anything in the UI can show or clean up.
test('deleteChapterFiles takes the notes file with the chapter', async function(t){
  const built = platformIn(t);
  fs.writeFileSync(built.dir + 'chap.txt', 'body', 'utf8');
  fs.writeFileSync(built.dir + NOTES_PREPEND + 'chap.txt', 'notes', 'utf8');

  await built.platform.deleteChapterFiles({ projectDir: built.dir, chapsDir: '', filename: 'chap.txt' });

  assert.ok(!fs.existsSync(built.dir + 'chap.txt'));
  assert.ok(!fs.existsSync(built.dir + NOTES_PREPEND + 'chap.txt'));
});

test('deleteChapterFiles is content with a chapter that has no notes, or no file at all', async function(t){
  const built = platformIn(t);
  fs.writeFileSync(built.dir + 'chap.txt', 'body', 'utf8');

  await built.platform.deleteChapterFiles({ projectDir: built.dir, chapsDir: '', filename: 'chap.txt' });
  await built.platform.deleteChapterFiles({ projectDir: built.dir, chapsDir: '', filename: 'never-existed.txt' });

  assert.ok(!fs.existsSync(built.dir + 'chap.txt'));
});

//Most chapters have no notes, which is an ordinary state and not a failure - so it is null rather
//than a NOT_FOUND the caller would have to catch on the common path.
test('loadChapterNotes returns null for a chapter that has none', async function(t){
  const built = platformIn(t);
  fs.writeFileSync(built.dir + 'chap.txt', 'body', 'utf8');

  assert.strictEqual(await built.platform.loadChapterNotes({
    projectDir: built.dir, chapsDir: '', filename: 'chap.txt'
  }), null);
});

test('saveChapterNotes and loadChapterNotes round-trip under the derived notes filename', async function(t){
  const built = platformIn(t);

  await built.platform.saveChapterNotes({
    projectDir: built.dir, chapsDir: '', filename: 'chap.txt', mdfc: 'some notes'
  });

  assert.ok(fs.existsSync(built.dir + NOTES_PREPEND + 'chap.txt'),
    'the notes filename is derived natively, so the renderer never composes it');
  assert.strictEqual(await built.platform.loadChapterNotes({
    projectDir: built.dir, chapsDir: '', filename: 'chap.txt'
  }), 'some notes');
});

// ---------------------------------------------------------------------------------------------
// Group B - project lifecycle
// ---------------------------------------------------------------------------------------------

//The renderer stops splitting paths: openProject hands back the pieces already separated, which is
//what closes project.js's own backslash-normalize + split('/') dance.
test('openProject parses the file and hands back the path already split', async function(t){
  const built = platformIn(t);
  fs.writeFileSync(built.dir + 'book.woolf', JSON.stringify({ title: 'A Book', chapters: [] }), 'utf8');

  const opened = await built.platform.openProject({ path: built.dir + 'book.woolf' });

  assert.strictEqual(opened.project.title, 'A Book');
  assert.strictEqual(opened.filename, 'book.woolf');
  assert.strictEqual(opened.directory, built.dir.replaceAll('\\', '/'));
});

test('openProject normalizes a windows path so what comes back can be concatenated safely', async function(t){
  const built = platformIn(t);
  fs.writeFileSync(built.dir + 'book.woolf', '{"title":"A Book"}', 'utf8');

  const opened = await built.platform.openProject({
    path: (built.dir + 'book.woolf').replaceAll('/', '\\')
  });

  assert.ok(!opened.directory.includes('\\'));
  assert.strictEqual(opened.filename, 'book.woolf');
});

//A .woolf truncated by a power loss mid-save is the case this has to survive - loudly, with
//something the caller can put in front of the reader.
test('openProject rejects a damaged project file rather than returning half of one', async function(t){
  const built = platformIn(t);
  fs.writeFileSync(built.dir + 'damaged.woolf', '{"title": "Half a proj', 'utf8');

  const err = await rejection(built.platform.openProject({ path: built.dir + 'damaged.woolf' }));

  assert.ok(err.isPlatformError);
  assert.ok(err.message.length > 0);
});

test('openProject rejects NOT_FOUND for a file that is not there', async function(t){
  const built = platformIn(t);

  assert.strictEqual((await rejection(built.platform.openProject({
    path: built.dir + 'nothing.woolf'
  }))).code, CODES.NOT_FOUND);
});

test('saveProject writes the project file where it is told', async function(t){
  const built = platformIn(t);

  await built.platform.saveProject({ directory: built.dir, filename: 'p.woolf', contents: '{"title":"P"}' });

  assert.strictEqual(fs.readFileSync(built.dir + 'p.woolf', 'utf8'), '{"title":"P"}');
});

test('saveProjectAs makes both directories and copies every chapter across', async function(t){
  const built = platformIn(t);
  const target = tempDir(t).replaceAll('\\', '/');
  fs.writeFileSync(built.dir + 'one.txt', 'chapter one', 'utf8');
  fs.writeFileSync(built.dir + 'two.txt', 'chapter two', 'utf8');

  const saved = await built.platform.saveProjectAs({
    fromDirectory: built.dir, fromChapsDir: '',
    targetPath: target + 'MyBook.woolf',
    chapterFilenames: ['one.txt', 'two.txt']
  });

  assert.strictEqual(saved.filename, 'MyBook.woolf');
  assert.strictEqual(saved.chapsDirectory, 'MyBook_chapters/');
  assert.deepStrictEqual(saved.chapterFilenames, ['one.txt', 'two.txt']);
  assert.deepStrictEqual(saved.failed, []);
  assert.strictEqual(fs.readFileSync(target + 'MyBook_chapters/two.txt', 'utf8'), 'chapter two');
});

//The extension is forced on after the subdirectory has already been named, so a target the reader
//typed without one still gets a matching pair.
test('saveProjectAs adds the .woolf extension without it reaching the chapters directory name', async function(t){
  const built = platformIn(t);
  const target = tempDir(t).replaceAll('\\', '/');

  const saved = await built.platform.saveProjectAs({
    fromDirectory: built.dir, fromChapsDir: '', targetPath: target + 'MyBook', chapterFilenames: []
  });

  assert.strictEqual(saved.filename, 'MyBook.woolf');
  assert.strictEqual(saved.chapsDirectory, 'MyBook_chapters/');
  assert.ok(fs.existsSync(target + 'MyBook_chapters/'));
});

//The subdirectory is named by the target's *last* dot, not its first: a project title containing a
//period used to lose everything after the first one.
test('saveProjectAs keeps a title containing a period whole in the chapters directory', async function(t){
  const built = platformIn(t);
  const target = tempDir(t).replaceAll('\\', '/');

  const saved = await built.platform.saveProjectAs({
    fromDirectory: built.dir, fromChapsDir: '', targetPath: target + 'My.Book.woolf', chapterFilenames: []
  });

  assert.strictEqual(saved.chapsDirectory, 'My.Book_chapters/');
  assert.ok(fs.existsSync(target + 'My.Book_chapters/'));
  assert.ok(!fs.existsSync(target + 'My_chapters/'));
});

//`failed` is the whole reason this returns a report rather than throwing on the first bad copy: one
//chapter whose file has gone missing must not cost the reader the other forty.
test('saveProjectAs reports a chapter it could not copy and carries on with the rest', async function(t){
  const built = platformIn(t);
  const target = tempDir(t).replaceAll('\\', '/');
  fs.writeFileSync(built.dir + 'good.txt', 'good contents', 'utf8');

  const saved = await built.platform.saveProjectAs({
    fromDirectory: built.dir, fromChapsDir: '',
    targetPath: target + 'p.woolf',
    chapterFilenames: ['missing.txt', 'good.txt']
  });

  assert.deepStrictEqual(saved.chapterFilenames, [null, 'good.txt'],
    'the null holds the slot so the caller can line results up against the chapters it sent');
  assert.strictEqual(saved.failed.length, 1);
  assert.strictEqual(saved.failed[0].filename, 'missing.txt');
  assert.strictEqual(saved.failed[0].code, CODES.NOT_FOUND);
  assert.ok(fs.existsSync(target + 'p_chapters/good.txt'));
});

//A chapter added but never saved has no file to copy, and nothing went wrong - so it takes a slot
//but does not appear in `failed`.
test('saveProjectAs passes over a chapter that has no file yet without calling it a failure', async function(t){
  const built = platformIn(t);
  const target = tempDir(t).replaceAll('\\', '/');

  const saved = await built.platform.saveProjectAs({
    fromDirectory: built.dir, fromChapsDir: '', targetPath: target + 'p.woolf',
    chapterFilenames: [null]
  });

  assert.deepStrictEqual(saved.chapterFilenames, [null]);
  assert.deepStrictEqual(saved.failed, []);
});

test('saveProjectAs flattens a chapter filename that carries a path segment', async function(t){
  const built = platformIn(t);
  const target = tempDir(t).replaceAll('\\', '/');
  fs.mkdirSync(built.dir + 'nested');
  fs.writeFileSync(built.dir + 'nested/deep.txt', 'deep', 'utf8');

  const saved = await built.platform.saveProjectAs({
    fromDirectory: built.dir, fromChapsDir: '', targetPath: target + 'p.woolf',
    chapterFilenames: ['nested/deep.txt']
  });

  assert.deepStrictEqual(saved.chapterFilenames, ['deep.txt']);
  assert.ok(fs.existsSync(target + 'p_chapters/deep.txt'));
});

test('verifyProjectFiles names only the chapter files that are not on disk', async function(t){
  const built = platformIn(t);
  fs.writeFileSync(built.dir + 'here.txt', 'x', 'utf8');

  assert.deepStrictEqual(await built.platform.verifyProjectFiles({
    directory: built.dir, chapsDirectory: '',
    chapterFilenames: ['here.txt', 'gone.txt', null]
  }), ['gone.txt']);
});

//The same file can legitimately be named by more than one list - a reference document pointing at
//a chapter's file - and the caller matches its own chapters against this as a set.
test('verifyProjectFiles reports a filename named twice only once', async function(t){
  const built = platformIn(t);

  assert.deepStrictEqual(await built.platform.verifyProjectFiles({
    directory: built.dir, chapsDirectory: '',
    chapterFilenames: ['gone.txt', 'gone.txt']
  }), ['gone.txt']);
});

test('materializeBundledProject copies the bundled project out and reports it writable', async function(t){
  const built = platformIn(t);
  const bundled = tempDir(t).replaceAll('\\', '/') + 'Frankenstein';
  fs.mkdirSync(bundled);
  fs.writeFileSync(bundled + '/Frankenstein.woolf', '{"title":"Frankenstein"}', 'utf8');
  const writable = built.dir.replaceAll('\\', '/') + 'Projects/Frankenstein';

  const result = await built.platform.materializeBundledProject({
    bundledDir: bundled, writableDir: writable, filename: 'Frankenstein.woolf'
  });

  assert.strictEqual(result.writable, true);
  assert.strictEqual(result.error, null);
  assert.strictEqual(result.path, writable + '/Frankenstein.woolf');
  assert.ok(fs.existsSync(result.path));
});

//The open finding this closes: when the copy fails, the caller used to get a read-only path it
//could not tell apart from a writable one, and every later save died with EACCES in silence.
test('materializeBundledProject falls back to the bundled original, flagged and with a reason', async function(t){
  const built = platformIn(t);
  const bundled = tempDir(t).replaceAll('\\', '/') + 'Frankenstein';
  fs.mkdirSync(bundled);
  fs.writeFileSync(bundled + '/Frankenstein.woolf', '{"title":"Frankenstein"}', 'utf8');
  patch(t, fs, 'cpSync', function(){
    const err = new Error('permission denied');
    err.code = 'EACCES';
    throw err;
  });

  const result = await built.platform.materializeBundledProject({
    bundledDir: bundled, writableDir: built.dir + 'Projects', filename: 'Frankenstein.woolf'
  });

  assert.strictEqual(result.writable, false, 'the caller must be able to tell this copy apart from a writable one');
  assert.strictEqual(result.path, bundled + '/Frankenstein.woolf');
  assert.strictEqual(result.error.code, CODES.PERMISSION_DENIED);
  assert.match(result.error.message, /permission denied/);
});

test('the project commands refuse arguments they cannot act on', async function(t){
  const built = platformIn(t);

  assert.strictEqual((await rejection(built.platform.openProject({}))).code, CODES.INVALID_ARGUMENT);
  assert.strictEqual((await rejection(built.platform.saveProject({ directory: built.dir, filename: 'p.woolf' }))).code,
    CODES.INVALID_ARGUMENT);
  assert.strictEqual((await rejection(built.platform.saveProjectAs({ chapterFilenames: [] }))).code,
    CODES.INVALID_ARGUMENT);
  assert.strictEqual((await rejection(built.platform.materializeBundledProject({ bundledDir: '/a' }))).code,
    CODES.INVALID_ARGUMENT);
});

// ---------------------------------------------------------------------------------------------
// Credentials - the group the contract is shaped around at the other end
// ---------------------------------------------------------------------------------------------

//The whole reason getCredential is absent from COMMANDS. Today the saved password is read into the
//renderer and put in an <input type=password>.value; under contextIsolation that would be a
//plaintext credential in the DOM of a webview.
test('a stored secret can be resolved inside the backing and never through the facade', async function(t){
  const built = platformIn(t);

  await built.platform.storeCredential({ service: 'email', secret: 'hunter2' });

  assert.strictEqual(built.backing.resolveSecret({ service: 'email' }), 'hunter2');
  assert.strictEqual(built.platform.resolveSecret, undefined);

  //Nothing any command returns carries it, either.
  const described = await built.platform.describeCredential({ service: 'email' });
  assert.strictEqual(JSON.stringify(described).indexOf('hunter2'), -1);
});

test('describeCredential returns only what a dialog needs to draw', async function(t){
  const built = platformIn(t);

  await built.platform.storeCredential({ service: 'email', secret: 'hunter2' });
  const described = await built.platform.describeCredential({ service: 'email' });

  assert.deepStrictEqual(Object.keys(described).sort(),
    ['backend', 'hasPassword', 'locked', 'secureStorageAvailable']);
  assert.strictEqual(described.hasPassword, true);
  assert.strictEqual(described.backend, 'keyfile');
  assert.strictEqual(described.locked, false);
  assert.strictEqual(described.secureStorageAvailable, false);
});

test('a real keystore is used when the machine has one', async function(t){
  const built = platformIn(t, { secureStorage: keystore(true) });

  assert.strictEqual(await built.platform.isSecureStorageAvailable(), true);
  const stored = await built.platform.storeCredential({ service: 'email', secret: 'hunter2' });

  assert.strictEqual(stored.backend, 'safeStorage');
  assert.strictEqual(built.backing.resolveSecret({ service: 'email' }), 'hunter2');
});

//The other half of why getCredential does not exist. Re-protecting a saved password - ticking or
//unticking "Protect With Passphrase" without retyping it - needs the plaintext, and the dialog
//does not have one. Passing the sentinel says "re-seal what is already there"; the plaintext comes
//out of the store and goes back into it without ever leaving this side.
test('storeCredential re-seals the stored secret when handed the sentinel', async function(t){
  const built = platformIn(t);

  await built.platform.storeCredential({ service: 'email', secret: 'hunter2' });
  assert.strictEqual((await built.platform.describeCredential({ service: 'email' })).backend, 'keyfile');

  const stored = await built.platform.storeCredential({
    service: 'email', secret: SAVED_SECRET, passphrase: 'correct horse'
  });

  assert.strictEqual(stored.backend, 'passphrase');
  //The password itself is untouched - only what protects it changed.
  assert.strictEqual(built.backing.resolveSecret({ service: 'email' }), 'hunter2');

  //And back the other way, which is the case that actually reaches this in the dialog: unticking
  //the box on a password the writer never retyped.
  await built.platform.storeCredential({ service: 'email', secret: SAVED_SECRET });

  assert.strictEqual((await built.platform.describeCredential({ service: 'email' })).backend, 'keyfile');
  assert.strictEqual(built.backing.resolveSecret({ service: 'email' }), 'hunter2');
});

//The failure this closes is silent and total: without it the sentinel is just a string, and a
//dialog that never held a password would store the sentinel *as* the password - overwriting a
//real saved one with 24 characters of nothing, reporting success.
test('storeCredential refuses the sentinel when there is nothing to re-seal', async function(t){
  const built = platformIn(t);

  const err = await rejection(built.platform.storeCredential({ service: 'email', secret: SAVED_SECRET }));

  assert.strictEqual(err.code, CODES.INVALID_ARGUMENT);
  assert.strictEqual((await built.platform.describeCredential({ service: 'email' })).hasPassword, false);
});

test('storeCredential refuses the sentinel while the credential is locked', async function(t){
  const built = platformIn(t);

  await built.platform.storeCredential({ service: 'email', secret: 'hunter2', passphrase: 'correct horse' });
  await built.platform.lockCredential({ service: 'email' });

  const err = await rejection(built.platform.storeCredential({ service: 'email', secret: SAVED_SECRET }));

  assert.strictEqual(err.code, CODES.LOCKED);

  //Still the real password, still passphrase-protected - the refused call changed nothing.
  assert.strictEqual(await built.platform.unlockCredential({ service: 'email', passphrase: 'correct horse' }), true);
  assert.strictEqual(built.backing.resolveSecret({ service: 'email' }), 'hunter2');
});

test('a passphrase-protected credential locks, refuses a wrong passphrase, and unlocks', async function(t){
  const built = platformIn(t);

  await built.platform.storeCredential({ service: 'email', secret: 'hunter2', passphrase: 'correct horse' });
  //Saving counts as unlocking, so the writer is not asked for the passphrase they just chose.
  assert.strictEqual((await built.platform.describeCredential({ service: 'email' })).locked, false);

  await built.platform.lockCredential({ service: 'email' });
  assert.strictEqual((await built.platform.describeCredential({ service: 'email' })).locked, true);

  //A mistyped passphrase is an ordinary outcome, detected by the authentication tag - not an error.
  assert.strictEqual(await built.platform.unlockCredential({ service: 'email', passphrase: 'wrong' }), false);
  assert.strictEqual((await built.platform.describeCredential({ service: 'email' })).locked, true);

  assert.strictEqual(await built.platform.unlockCredential({ service: 'email', passphrase: 'correct horse' }), true);
  assert.strictEqual((await built.platform.describeCredential({ service: 'email' })).locked, false);
  assert.strictEqual(built.backing.resolveSecret({ service: 'email' }), 'hunter2');
});

//The session key lives in the store instance's closure and nowhere else, so a locked credential has
//nothing to resolve with and says so rather than returning null and being mistaken for "not saved".
test('a locked credential refuses to resolve', async function(t){
  const built = platformIn(t);

  await built.platform.storeCredential({ service: 'email', secret: 'hunter2', passphrase: 'correct horse' });
  await built.platform.lockCredential({ service: 'email' });

  assert.throws(function(){
    built.backing.resolveSecret({ service: 'email' });
  }, function(err){
    return err.code === CODES.LOCKED;
  });
});

test('clearing removes the stored credential', async function(t){
  const built = platformIn(t);

  await built.platform.storeCredential({ service: 'email', secret: 'hunter2' });
  await built.platform.clearCredentials({ service: 'email' });

  assert.strictEqual((await built.platform.describeCredential({ service: 'email' })).hasPassword, false);
  assert.strictEqual(built.backing.resolveSecret({ service: 'email' }), null);
});

//The renderer hands over the blob it found in user-settings.json and learns only whether something
//moved. The recovered plaintext is re-sealed on this side and never comes back across.
test('a legacy blob is migrated without the plaintext crossing', async function(t){
  const built = platformIn(t);

  const result = await built.platform.migrateLegacyCredential({
    service: 'email', legacyBlob: encryptTheOldWay('old-saved-password')
  });

  assert.deepStrictEqual(result, { recognized: true, migrated: true });
  assert.strictEqual((await built.platform.describeCredential({ service: 'email' })).backend, 'keyfile');
  assert.strictEqual(built.backing.resolveSecret({ service: 'email' }), 'old-saved-password');

  const onDisk = fs.readFileSync(path.join(built.dir, 'credentials.json'), 'utf8');
  assert.strictEqual(onDisk.indexOf('old-saved-password'), -1);
});

//Against a blob written down rather than generated by the helper below, which is a second
//reimplementation of the old format and would drift alongside crypto.js without complaining. Same
//constant as crypto.test.js's, and the same reason: a broken migration loses a real writer's saved
//password with no error, no log line and nothing left to inspect afterwards.
test('a legacy blob from a real 2.2.1 install migrates', async function(t){
  const built = platformIn(t);

  const result = await built.platform.migrateLegacyCredential({
    service: 'email',
    legacyBlob: { iv: '9f1c4a77e5b30d2168ac5e91b3470ddf',
      content: 'ffcdaeb4e695b8e2c9b13c01aa44988a9d74' }
  });

  assert.deepStrictEqual(result, { recognized: true, migrated: true });
  assert.strictEqual(built.backing.resolveSecret({ service: 'email' }), 'old-saved-password');
});

test('anything that is not a legacy blob is left alone', async function(t){
  const built = platformIn(t);

  for(const blob of [null, undefined, {}, { v: 2, iv: 'aa', tag: 'bb', content: 'cc' }]){
    const result = await built.platform.migrateLegacyCredential({ service: 'email', legacyBlob: blob });
    assert.deepStrictEqual(result, { recognized: false, migrated: false });
  }

  assert.strictEqual((await built.platform.describeCredential({ service: 'email' })).hasPassword, false);
});

//The two flags are not the same question, and this is the case that separates them: a 2.2.1 writer
//who ticked "remember" with an empty password field has a legacy-shaped blob holding nothing. The
//old migrateLegacyPassword cleared userSettings.senderPass for them anyway. Reporting only
//`migrated` would tell render.js to leave the dead blob there, to be re-read and re-decrypted on
//every launch from now on, with nothing ever saying so.
test('a legacy blob that decrypts to nothing is recognized but not migrated', async function(t){
  const built = platformIn(t);

  const result = await built.platform.migrateLegacyCredential({
    service: 'email', legacyBlob: encryptTheOldWay('')
  });

  assert.deepStrictEqual(result, { recognized: true, migrated: false });
  assert.strictEqual((await built.platform.describeCredential({ service: 'email' })).hasPassword, false);
});

//Same shape, from the other direction: a legacy-shaped blob whose hex is unreadable. Recognized
//(it is unmistakably the old format), not migrated (there is nothing in it).
test('a legacy blob that cannot be decrypted at all is recognized but not migrated', async function(t){
  const built = platformIn(t);

  const result = await built.platform.migrateLegacyCredential({
    service: 'email', legacyBlob: { iv: 'not-hex-at-all', content: 'nor-is-this' }
  });

  assert.deepStrictEqual(result, { recognized: true, migrated: false });
  assert.strictEqual((await built.platform.describeCredential({ service: 'email' })).hasPassword, false);
});

//The one place this command deliberately does not preserve migrateLegacyPassword's behaviour. The
//old code ignored a failed re-save and cleared userSettings.senderPass regardless, destroying the
//only copy of the password. Rejecting instead leaves the blob where it is, and render.js's own
//catch leaves the settings field alone, so the next launch tries again.
test('a legacy blob that cannot be re-sealed rejects rather than reporting it moved', async function(t){
  const built = platformIn(t);

  patch(t, fs, 'writeFileSync', function(){
    throw new Error('disk full');
  });

  const err = await rejection(built.platform.migrateLegacyCredential({
    service: 'email', legacyBlob: encryptTheOldWay('old-saved-password')
  }));

  assert.strictEqual(err.code, CODES.IO_ERROR);
});

test('an unknown credential service is refused rather than given a store of its own', async function(t){
  const built = platformIn(t);

  for(const call of [
    built.platform.describeCredential({ service: 'bank' }),
    built.platform.storeCredential({ service: 'bank', secret: 'x' }),
    built.platform.lockCredential({ service: 'bank' }),
    built.platform.clearCredentials({ service: 'bank' })
  ]){
    const err = await rejection(call);
    assert.strictEqual(err.code, CODES.INVALID_ARGUMENT);
  }

  assert.deepStrictEqual(fs.readdirSync(built.dir), []);
});

test('SAVED_SECRET is a sentinel no writer would type', function(){
  assert.strictEqual(typeof SAVED_SECRET, 'string');
  assert.ok(SAVED_SECRET.length > 0);
  assert.strictEqual(createPlatform({ on: function(){}, off: function(){} }).SAVED_SECRET, SAVED_SECRET);
});

//The scheme WareWoolf shipped up to 2.2.1, rebuilt here from the key that sat in the packaged
//source next to the file it encrypted - the same construction crypto.test.js uses.
function encryptTheOldWay(text){
  const iv = nodeCrypto.randomBytes(16);
  const cipher = nodeCrypto.createCipheriv('aes-256-ctr', 'o2V6h1BYiyMWiSFNNoKf6rp7maAr6Lb7', iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);

  return { iv: iv.toString('hex'), content: encrypted.toString('hex') };
}

// ---------------------------------------------------------------------------------------------
// Group D - user settings, corkboard, licenses
// ---------------------------------------------------------------------------------------------

test('loadUserSettings returns null when nothing has been saved yet', async function(t){
  const built = platformIn(t);

  assert.strictEqual(await built.platform.loadUserSettings(), null);
});

test('saveUserSettings and loadUserSettings round-trip an object', async function(t){
  const built = platformIn(t);
  const settings = { theme: 'dark', autosaveMinutes: 5 };

  await built.platform.saveUserSettings({ settings: settings });

  assert.deepStrictEqual(await built.platform.loadUserSettings(), settings);
});

test('user settings commands reject UNAVAILABLE without a userData directory configured', async function(){
  const platform = wrap(createNodeBacking({}));

  assert.strictEqual((await rejection(platform.loadUserSettings({}))).code, CODES.UNAVAILABLE);
  assert.strictEqual((await rejection(platform.saveUserSettings({ settings: {} }))).code, CODES.UNAVAILABLE);
});

test('loadCorkboard returns null when the corkboard file does not exist yet', async function(t){
  const built = platformIn(t);

  assert.strictEqual(await built.platform.loadCorkboard({ chaptersDir: built.dir }), null);
});

//Raw text in, raw text out - corkboard.js does its own parsing, so the backing must not touch the
//marker-escaping content in any way.
test('saveCorkboard and loadCorkboard round-trip the raw corkboard text', async function(t){
  const built = platformIn(t);
  const raw = '# Card one\n[x] Card two\n';

  await built.platform.saveCorkboard({ chaptersDir: built.dir, contents: raw });

  assert.strictEqual(await built.platform.loadCorkboard({ chaptersDir: built.dir }), raw);
});

test('the corkboard commands refuse arguments they cannot act on', async function(t){
  const built = platformIn(t);

  assert.strictEqual((await rejection(built.platform.loadCorkboard({}))).code, CODES.INVALID_ARGUMENT);
  assert.strictEqual((await rejection(built.platform.saveCorkboard({ chaptersDir: built.dir }))).code,
    CODES.INVALID_ARGUMENT);
});

test('readLicenses returns the shipped license text', async function(t){
  const appDir = tempDir(t).replaceAll('\\', '/');
  fs.writeFileSync(appDir + 'licenses.txt', 'MIT License...', 'utf8');
  const platform = wrap(createNodeBacking({ paths: { app: appDir } }));

  assert.strictEqual(await platform.readLicenses(), 'MIT License...');
});

//about_display.js's own try/catch used to swallow exactly this and show an empty license panel -
//so this resolves empty rather than rejecting, whether there is no app directory at all or the file
//just is not there.
test('readLicenses returns an empty string rather than rejecting when there is nothing to read', async function(t){
  const withoutApp = wrap(createNodeBacking({}));
  const emptyAppDir = tempDir(t).replaceAll('\\', '/');
  const withApp = wrap(createNodeBacking({ paths: { app: emptyAppDir } }));

  assert.strictEqual(await withoutApp.readLicenses(), '');
  assert.strictEqual(await withApp.readLicenses(), '');
});

// ---------------------------------------------------------------------------------------------
// Group E - the in-app file browser (the documented generic exception)
// ---------------------------------------------------------------------------------------------

//isDirectory has to cross as a plain boolean, not a dirent's isDirectory() method - a function
//cannot survive IPC/Tauri serialization.
test('listDirectory reports every entry with isDirectory as a plain boolean', async function(t){
  const built = platformIn(t);
  fs.writeFileSync(built.dir + 'chapter.txt', 'x', 'utf8');
  fs.mkdirSync(built.dir + 'subfolder');

  const entries = await built.platform.listDirectory({ path: built.dir });

  assert.deepStrictEqual(entries.sort(function(a, b){ return a.name < b.name ? -1 : 1; }), [
    { name: 'chapter.txt', isDirectory: false },
    { name: 'subfolder', isDirectory: true }
  ]);
});

test('listDirectory rejects NOT_FOUND for a directory that is not there', async function(t){
  const built = platformIn(t);

  const err = await rejection(built.platform.listDirectory({ path: built.dir + 'nowhere' }));
  assert.strictEqual(err.code, CODES.NOT_FOUND);
});

test('pathExists reports true or false without ever rejecting', async function(t){
  const built = platformIn(t);
  fs.writeFileSync(built.dir + 'here.txt', 'x', 'utf8');

  assert.strictEqual(await built.platform.pathExists({ path: built.dir + 'here.txt' }), true);
  assert.strictEqual(await built.platform.pathExists({ path: built.dir + 'nowhere.txt' }), false);
});

test('statEntry describes a file and a directory', async function(t){
  const built = platformIn(t);
  fs.writeFileSync(built.dir + 'here.txt', 'hello', 'utf8');

  const fileStat = await built.platform.statEntry({ path: built.dir + 'here.txt' });
  assert.strictEqual(fileStat.isDirectory, false);
  assert.strictEqual(fileStat.size, 5);
  assert.strictEqual(typeof fileStat.modified, 'string');

  const dirStat = await built.platform.statEntry({ path: built.dir });
  assert.strictEqual(dirStat.isDirectory, true);
});

test('statEntry rejects NOT_FOUND for a path that is not there', async function(t){
  const built = platformIn(t);

  const err = await rejection(built.platform.statEntry({ path: built.dir + 'nowhere' }));
  assert.strictEqual(err.code, CODES.NOT_FOUND);
});

test('createDirectory makes a new directory and reports the path it made', async function(t){
  const built = platformIn(t);
  const parent = built.dir.replaceAll('\\', '/');

  const result = await built.platform.createDirectory({ parent: built.dir, name: 'Chapters' });

  assert.strictEqual(result.path, parent + 'Chapters');
  assert.ok(fs.statSync(result.path).isDirectory());
});

//Matches the fs.existsSync guard createNewDirectory used to apply itself (file-manager.js:106) -
//an existing target is left alone rather than rejected or clobbered.
test('createDirectory is idempotent: an existing target is left alone, not rejected', async function(t){
  const built = platformIn(t);
  const parent = built.dir.replaceAll('\\', '/');
  fs.mkdirSync(built.dir + 'Chapters');
  fs.writeFileSync(built.dir + 'Chapters/keepme.txt', 'do not lose this', 'utf8');

  const result = await built.platform.createDirectory({ parent: built.dir, name: 'Chapters' });

  assert.strictEqual(result.path, parent + 'Chapters');
  assert.strictEqual(fs.readFileSync(built.dir + 'Chapters/keepme.txt', 'utf8'), 'do not lose this');
});

test('moveEntry moves a file to a free destination', async function(t){
  const built = platformIn(t);
  fs.writeFileSync(built.dir + 'source.txt', 'contents', 'utf8');

  await built.platform.moveEntry({ source: built.dir + 'source.txt', destination: built.dir + 'dest.txt' });

  assert.ok(!fs.existsSync(built.dir + 'source.txt'));
  assert.strictEqual(fs.readFileSync(built.dir + 'dest.txt', 'utf8'), 'contents');
});

//The refuse-on-existing-destination guard file-manager.js used to apply itself (:54-56):
//fs.renameSync is silent about clobbering, so this command has to check first and reject rather
//than overwrite. moveFiles' cut-paste auto-uniquify policy is built from pathExists/statEntry on
//the renderer side instead - this command only ever implements the stricter, refusing policy.
test('moveEntry rejects ALREADY_EXISTS rather than overwriting the destination', async function(t){
  const built = platformIn(t);
  fs.writeFileSync(built.dir + 'source.txt', 'new', 'utf8');
  fs.writeFileSync(built.dir + 'dest.txt', 'do not clobber this', 'utf8');

  const err = await rejection(built.platform.moveEntry({
    source: built.dir + 'source.txt', destination: built.dir + 'dest.txt'
  }));

  assert.strictEqual(err.code, CODES.ALREADY_EXISTS);
  assert.strictEqual(fs.readFileSync(built.dir + 'dest.txt', 'utf8'), 'do not clobber this');
  assert.ok(fs.existsSync(built.dir + 'source.txt'));
});

test('moveEntry rejects NOT_FOUND when the source does not exist', async function(t){
  const built = platformIn(t);

  const err = await rejection(built.platform.moveEntry({
    source: built.dir + 'nowhere.txt', destination: built.dir + 'dest.txt'
  }));

  assert.strictEqual(err.code, CODES.NOT_FOUND);
});

test('copyEntry copies a single file, leaving the original in place', async function(t){
  const built = platformIn(t);
  fs.writeFileSync(built.dir + 'source.txt', 'contents', 'utf8');

  await built.platform.copyEntry({ source: built.dir + 'source.txt', destination: built.dir + 'copy.txt' });

  assert.strictEqual(fs.readFileSync(built.dir + 'copy.txt', 'utf8'), 'contents');
  assert.ok(fs.existsSync(built.dir + 'source.txt'));
});

test('copyEntry copies a directory tree when recursive is set', async function(t){
  const built = platformIn(t);
  fs.mkdirSync(built.dir + 'srcdir');
  fs.writeFileSync(built.dir + 'srcdir/inner.txt', 'nested', 'utf8');

  await built.platform.copyEntry({
    source: built.dir + 'srcdir', destination: built.dir + 'destdir', recursive: true
  });

  assert.strictEqual(fs.readFileSync(built.dir + 'destdir/inner.txt', 'utf8'), 'nested');
});

test('copyEntry rejects NOT_FOUND when the source does not exist', async function(t){
  const built = platformIn(t);

  const err = await rejection(built.platform.copyEntry({
    source: built.dir + 'nowhere.txt', destination: built.dir + 'copy.txt'
  }));

  assert.strictEqual(err.code, CODES.NOT_FOUND);
});

test('deleteEntry removes a file', async function(t){
  const built = platformIn(t);
  fs.writeFileSync(built.dir + 'gone.txt', 'x', 'utf8');

  await built.platform.deleteEntry({ path: built.dir + 'gone.txt' });

  assert.ok(!fs.existsSync(built.dir + 'gone.txt'));
});

test('deleteEntry removes a directory tree when recursive is set', async function(t){
  const built = platformIn(t);
  fs.mkdirSync(built.dir + 'tree');
  fs.writeFileSync(built.dir + 'tree/inner.txt', 'x', 'utf8');

  await built.platform.deleteEntry({ path: built.dir + 'tree', recursive: true });

  assert.ok(!fs.existsSync(built.dir + 'tree'));
});

//A path that is already gone is not a failure of anything the caller asked for - deleteEntry is a
//no-op rather than rejecting NOT_FOUND, the same instinct as an idempotent createDirectory above.
test('deleteEntry on a path that is already gone is a silent no-op', async function(t){
  const built = platformIn(t);

  await assert.doesNotReject(built.platform.deleteEntry({ path: built.dir + 'never-existed.txt' }));
});

// ---------------------------------------------------------------------------------------------
// Group F - import
// ---------------------------------------------------------------------------------------------
// Phase 6. These are the commands that get a manuscript INTO the app; group G/H below are what get
// one OUT. unzipper and the OOXML shape of a .docx have no browser build/parser worth trusting, so
// extractZip/importDocx are native by necessity - see the group-level note in platform.js.

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function docxDocumentXml(bodyXml){
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document ' + W_NS + '><w:body>' + bodyXml + '</w:body></w:document>';
}

//Builds a minimal .docx - a zip with word/document.xml and, if given, word/footnotes.xml - on disk.
//importDocx only ever reads those two parts.
function buildDocxZip(destPath, bodyXml, footnotesXml){
  return new Promise(function(resolve, reject){
    const output = fs.createWriteStream(destPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', function(){ resolve(destPath); });
    archive.on('error', reject);

    archive.pipe(output);
    archive.append(docxDocumentXml(bodyXml), { name: 'word/document.xml' });
    if(footnotesXml)
      archive.append(footnotesXml, { name: 'word/footnotes.xml' });
    archive.finalize();
  });
}

function buildZip(destPath, entries){
  return new Promise(function(resolve, reject){
    const output = fs.createWriteStream(destPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', function(){ resolve(destPath); });
    archive.on('error', reject);

    archive.pipe(output);
    entries.forEach(function(entry){
      archive.append(entry.content, { name: entry.name });
    });
    archive.finalize();
  });
}

test('readTextFile returns the file\'s text verbatim', async function(t){
  const built = platformIn(t);
  fs.writeFileSync(built.dir + 'chapter.mdfc', '# Title\n\nBody text.', 'utf8');

  const text = await built.platform.readTextFile({ path: built.dir + 'chapter.mdfc' });

  assert.strictEqual(text, '# Title\n\nBody text.');
});

test('readTextFile rejects NOT_FOUND for a file that is not there', async function(t){
  const built = platformIn(t);
  const err = await rejection(built.platform.readTextFile({ path: built.dir + 'missing.txt' }));

  assert.strictEqual(err.code, CODES.NOT_FOUND);
});

test('extractZip extracts every entry under destPath', async function(t){
  const built = platformIn(t);
  const zipPath = built.dir + 'project.zip';
  await buildZip(zipPath, [
    { name: 'book.md', content: 'chapter one' },
    { name: 'nested/notes.txt', content: 'some notes' }
  ]);

  const result = await built.platform.extractZip({ zipPath: zipPath, destPath: built.dir + 'out' });

  //destPath crosses back normalized to forward slashes, same convention as every other group B/E
  //path in this file (e.g. listDirectory, createDirectory).
  assert.strictEqual(result.path, (built.dir + 'out').replaceAll('\\', '/'));
  assert.strictEqual(fs.readFileSync(path.join(built.dir, 'out', 'book.md'), 'utf8'), 'chapter one');
  assert.strictEqual(fs.readFileSync(path.join(built.dir, 'out', 'nested', 'notes.txt'), 'utf8'), 'some notes');
});

test('extractZip defaults destPath to zipPath with its trailing ".zip" stripped', async function(t){
  const built = platformIn(t);
  const zipPath = built.dir + 'archive.zip';
  await buildZip(zipPath, [{ name: 'a.txt', content: 'x' }]);

  const result = await built.platform.extractZip({ zipPath: zipPath });

  assert.strictEqual(result.path, (built.dir + 'archive').replaceAll('\\', '/'));
  assert.ok(fs.existsSync(path.join(built.dir, 'archive', 'a.txt')));
});

test('extractZip rejects instead of crashing when the zip does not exist', async function(t){
  const built = platformIn(t);
  const err = await rejection(built.platform.extractZip({ zipPath: built.dir + 'nope.zip' }));

  assert.strictEqual(err.code, CODES.NOT_FOUND);
});

test('importDocx returns document.xml and footnotes.xml as text', async function(t){
  const built = platformIn(t);
  const zipPath = built.dir + 'test.docx';
  const footnotesXml = '<?xml version="1.0"?><w:footnotes ' + W_NS + '><w:footnote w:id="1"/></w:footnotes>';
  await buildDocxZip(zipPath, '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>', footnotesXml);

  const result = await built.platform.importDocx({ path: zipPath });

  assert.match(result.documentXml, /<w:t>Hello<\/w:t>/);
  assert.match(result.footnotesXml, /<w:footnote w:id="1"\/>/);
  //Nothing but the two XML texts - a temp directory path is exactly what this command must never
  //hand back, since docx-import.js's parsing is pure string work and the boundary is the point.
  assert.deepStrictEqual(Object.keys(result).sort(), ['documentXml', 'footnotesXml']);
});

test('importDocx returns null footnotesXml when the docx has no footnotes part', async function(t){
  const built = platformIn(t);
  const zipPath = built.dir + 'no-footnotes.docx';
  await buildDocxZip(zipPath, '<w:p><w:r><w:t>Hi</w:t></w:r></w:p>');

  const result = await built.platform.importDocx({ path: zipPath });

  assert.strictEqual(result.footnotesXml, null);
});

//The unzip destination is this command's own implementation detail - it must not leak out as a
//stray directory either. Regression coverage for the same property from the caller's side lives in
//docx-import.test.js.
test('importDocx does not leave its temp extraction directory behind', async function(t){
  const built = platformIn(t);
  const zipPath = built.dir + 'cleanup.docx';
  await buildDocxZip(zipPath, '<w:p><w:r><w:t>Hi</w:t></w:r></w:p>');

  const before = fs.readdirSync(os.tmpdir()).filter(function(name){ return name.startsWith('warewoolf-docx-'); });
  await built.platform.importDocx({ path: zipPath });
  const after = fs.readdirSync(os.tmpdir()).filter(function(name){ return name.startsWith('warewoolf-docx-'); });

  assert.deepStrictEqual(after, before);
});

test('importDocx rejects NOT_FOUND for a file that is not there', async function(t){
  const built = platformIn(t);
  const err = await rejection(built.platform.importDocx({ path: built.dir + 'missing.docx' }));

  assert.strictEqual(err.code, CODES.NOT_FOUND);
});

// ---------------------------------------------------------------------------------------------
// Group G - export and compile
// ---------------------------------------------------------------------------------------------
// The commands that get a manuscript OUT of the app. A silently truncated .epub or .docx is the
// worst failure this project can have - the writer only finds out when they send it to an agent -
// so buildEpub's resolve-on-'close'-not-'finish' behavior below is the single most load-bearing
// property in this group. See the comment on the node backing's implementation for the reasoning.

test('ensureDirectory creates a missing directory', async function(t){
  const built = platformIn(t);

  await built.platform.ensureDirectory({ path: built.dir + 'exports' });

  assert.ok(fs.statSync(built.dir + 'exports').isDirectory());
});

test('ensureDirectory is idempotent: an existing directory is left alone, not rejected', async function(t){
  const built = platformIn(t);
  fs.mkdirSync(built.dir + 'exports');
  fs.writeFileSync(built.dir + 'exports/keep.txt', 'x', 'utf8');

  await assert.doesNotReject(built.platform.ensureDirectory({ path: built.dir + 'exports' }));

  assert.ok(fs.existsSync(built.dir + 'exports/keep.txt'));
});

test('writeTextFile writes text, and overwrites what was there before', async function(t){
  const built = platformIn(t);

  await built.platform.writeTextFile({ path: built.dir + 'out.txt', contents: 'first' });
  await built.platform.writeTextFile({ path: built.dir + 'out.txt', contents: 'second' });

  assert.strictEqual(fs.readFileSync(built.dir + 'out.txt', 'utf8'), 'second');
});

test('writeBinaryFile writes raw bytes verbatim', async function(t){
  const built = platformIn(t);
  const bytes = Buffer.from([0, 1, 2, 255, 254, 3]);

  await built.platform.writeBinaryFile({ path: built.dir + 'out.bin', bytes: bytes });

  assert.deepStrictEqual(fs.readFileSync(built.dir + 'out.bin'), bytes);
});

test('buildEpub writes every entry into a real zip, with mimetype first and stored uncompressed', async function(t){
  const built = platformIn(t);
  const filepath = built.dir + 'book.epub';

  await built.platform.buildEpub({
    filepath: filepath,
    entries: [
      { name: 'mimetype', content: 'application/epub+zip' },
      { name: 'META-INF/container.xml', content: '<container/>' },
      { name: 'OEBPS/chapter_1.xhtml', content: '<html><body>Chapter text.</body></html>' }
    ]
  });

  const dir = await unzipper.Open.file(filepath);

  assert.strictEqual(dir.files[0].path, 'mimetype');
  assert.strictEqual(dir.files[0].compressionMethod, 0, 'mimetype must be STORED, not deflated');
  assert.notStrictEqual(dir.files[1].compressionMethod, 0, 'other entries should be deflated');

  const chapterEntry = dir.files.find(function(f){ return f.path === 'OEBPS/chapter_1.xhtml'; });
  assert.strictEqual((await chapterEntry.buffer()).toString('utf8'), '<html><body>Chapter text.</body></html>');
});

//Regression guard for the property the comment on buildEpub's node-backing implementation depends
//on: resolving before the write stream's 'close' would mean handing off a file that is not
//guaranteed to be readable yet. Reading it back as a valid zip immediately after the promise
//resolves - with no wait, no retry loop - is the observable half of that guarantee.
test('buildEpub\'s promise resolves only once the file is immediately readable as a valid zip', async function(t){
  const built = platformIn(t);
  const filepath = built.dir + 'immediate.epub';

  await built.platform.buildEpub({
    filepath: filepath,
    entries: [{ name: 'mimetype', content: 'application/epub+zip' }]
  });

  const dir = await unzipper.Open.file(filepath);
  assert.strictEqual(dir.files.length, 1);
});

//Direct proof of the property the two tests above can only observe indirectly: buildEpub resolves
//on the write stream's 'close', not archiver's 'finish'. A controllableWriteStream lets 'finish'
//fire for real - archiver still writes real chunks and calls .end() when it's done - while holding
//'close' back until the test says so, so the promise's state can be checked in the gap between them.
test('buildEpub resolves on the write stream\'s "close", not on archiver\'s "finish"', async function(t){
  const output = controllableWriteStream();
  const platform = wrap(createNodeBacking({ createWriteStream: function(){ return output; } }));

  let settled = false;
  const finished = new Promise(function(resolve){ output.once('finish', resolve); });

  const promise = platform.buildEpub({
    filepath: 'unused.epub',
    entries: [{ name: 'mimetype', content: 'application/epub+zip' }]
  });
  promise.then(function(){ settled = true; }, function(){ settled = true; });

  await finished;
  //'finish' has fired for real at this point. If buildEpub resolved on it, `settled` would already
  //be true (or about to become true on the very next microtask) - give it a full turn of the event
  //loop, past the microtask queue, before asserting it is still false.
  await new Promise(function(resolve){ setImmediate(resolve); });
  assert.strictEqual(settled, false, 'buildEpub resolved before the write stream emitted "close"');

  output.triggerClose();
  await promise;
  assert.strictEqual(settled, true);
});

test('buildEpub rejects instead of crashing when the parent directory does not exist', async function(t){
  const built = platformIn(t);
  const err = await rejection(built.platform.buildEpub({
    filepath: built.dir + 'missing-dir/book.epub',
    entries: [{ name: 'mimetype', content: 'x' }]
  }));

  assert.ok(err.isPlatformError);
});

// ---------------------------------------------------------------------------------------------
// Group H - backup
// ---------------------------------------------------------------------------------------------

function makeBackupProjectFixture(dir){
  const filename = 'notes.final.woolf';
  fs.writeFileSync(dir + filename, '{"title":"test"}', 'utf8');
  fs.mkdirSync(dir + 'chapters');
  fs.writeFileSync(dir + 'chapters/chap1.txt', 'chapter one', 'utf8');

  return { filename: filename, chapsDir: 'chapters' };
}

test('archiveProject zips the project file and chapters directory, and allocates the archive name', async function(t){
  const built = platformIn(t);
  const fixture = makeBackupProjectFixture(built.dir);
  fs.mkdirSync(built.dir + 'backups');

  const result = await built.platform.archiveProject({
    projectDir: built.dir, chapsDir: fixture.chapsDir, filename: fixture.filename, destDir: built.dir + 'backups'
  });

  assert.match(result.filename, /^notes\.final\d{14}\.zip$/);
  assert.strictEqual(result.path, path.join(built.dir + 'backups', result.filename));
  assert.ok(fs.existsSync(result.path));

  const dir = await unzipper.Open.file(result.path);
  const entryPaths = dir.files.map(function(f){ return f.path; });
  assert.ok(entryPaths.includes(fixture.filename));
  assert.ok(entryPaths.includes(fixture.chapsDir + '/chap1.txt'));
});

//Same regression class as buildEpub above, and the same fix: the original backup-project.js
//listened on archiver's 'finish' rather than the write stream's 'close', which risked handing back
//an archive name before fs had actually flushed it to disk. Reading the result straight back as a
//valid zip is the observable half of that guarantee.
test('archiveProject\'s promise resolves only once the archive is immediately readable as a valid zip', async function(t){
  const built = platformIn(t);
  const fixture = makeBackupProjectFixture(built.dir);
  fs.mkdirSync(built.dir + 'backups');

  const result = await built.platform.archiveProject({
    projectDir: built.dir, chapsDir: fixture.chapsDir, filename: fixture.filename, destDir: built.dir + 'backups'
  });

  const dir = await unzipper.Open.file(result.path);
  assert.ok(dir.files.length > 0);
});

//Direct proof of the property the test above can only observe indirectly, mirroring buildEpub's own
//direct test above it: archiveProject resolves on the write stream's 'close', not archiver's
//'finish'. This is the exact bug Phase 6 found and fixed in the original backup-project.js, which
//listened on 'finish'.
test('archiveProject resolves on the write stream\'s "close", not on archiver\'s "finish"', async function(t){
  const dir = tempDir(t);
  const fixture = makeBackupProjectFixture(dir);

  const output = controllableWriteStream();
  const platform = wrap(createNodeBacking({ createWriteStream: function(){ return output; } }));

  let settled = false;
  const finished = new Promise(function(resolve){ output.once('finish', resolve); });

  const promise = platform.archiveProject({
    projectDir: dir, chapsDir: fixture.chapsDir, filename: fixture.filename, destDir: dir
  });
  promise.then(function(){ settled = true; }, function(){ settled = true; });

  await finished;
  await new Promise(function(resolve){ setImmediate(resolve); });
  assert.strictEqual(settled, false, 'archiveProject resolved before the write stream emitted "close"');

  output.triggerClose();
  await promise;
  assert.strictEqual(settled, true);
});

test('archiveProject rejects rather than hanging when the destination directory does not exist', async function(t){
  const built = platformIn(t);
  const fixture = makeBackupProjectFixture(built.dir);

  const err = await rejection(built.platform.archiveProject({
    projectDir: built.dir, chapsDir: fixture.chapsDir, filename: fixture.filename,
    destDir: built.dir + 'no-such-directory'
  }));

  assert.ok(err.isPlatformError);
});

test('listBackups reports every entry with isDirectory as a plain boolean', async function(t){
  const built = platformIn(t);
  fs.writeFileSync(built.dir + 'a.zip', '', 'utf8');
  fs.mkdirSync(built.dir + 'subdir');

  const entries = await built.platform.listBackups({ directory: built.dir });
  const byName = Object.fromEntries(entries.map(function(e){ return [e.name, e.isDirectory]; }));

  assert.strictEqual(byName['a.zip'], false);
  assert.strictEqual(byName['subdir'], true);
});

test('pruneBackups deletes every path given', async function(t){
  const built = platformIn(t);
  fs.writeFileSync(built.dir + 'old1.zip', '', 'utf8');
  fs.writeFileSync(built.dir + 'old2.zip', '', 'utf8');
  fs.writeFileSync(built.dir + 'keep.zip', '', 'utf8');

  await built.platform.pruneBackups({ paths: [built.dir + 'old1.zip', built.dir + 'old2.zip'] });

  assert.deepStrictEqual(fs.readdirSync(built.dir).sort(), ['keep.zip']);
});

//A path that is already gone is not a failure at all - fs.existsSync guards it before rmSync ever
//runs, so it never reaches the per-path try/catch below.
test('pruneBackups treats an already-missing path as a no-op rather than a failure', async function(t){
  const built = platformIn(t);
  fs.writeFileSync(built.dir + 'real.zip', '', 'utf8');

  await assert.doesNotReject(built.platform.pruneBackups({
    paths: [built.dir + 'never-existed.zip', built.dir + 'real.zip']
  }));

  assert.deepStrictEqual(fs.readdirSync(built.dir), []);
});

//A genuinely bad entry (not the "already gone" case above, which never throws at all) must not
//stop the rest of the batch from being pruned - matching deleteOldBackups' original per-file
//try/catch, mirrored on this command since pruneBackups is now what carries that behavior.
test('pruneBackups keeps deleting after an entry that throws', async function(t){
  const built = platformIn(t);
  fs.writeFileSync(built.dir + 'real.zip', '', 'utf8');

  await assert.doesNotReject(built.platform.pruneBackups({
    //A non-string entry fails normalizePath's requireText check, the same way a permission error
    //would fail rmSync - both land in the per-path try/catch.
    paths: [null, built.dir + 'real.zip']
  }));

  assert.deepStrictEqual(fs.readdirSync(built.dir), []);
});

test('the import/export/backup commands refuse arguments they cannot act on', async function(t){
  const built = platformIn(t);

  assert.strictEqual((await rejection(built.platform.readTextFile({}))).code, CODES.INVALID_ARGUMENT);
  assert.strictEqual((await rejection(built.platform.extractZip({}))).code, CODES.INVALID_ARGUMENT);
  assert.strictEqual((await rejection(built.platform.importDocx({}))).code, CODES.INVALID_ARGUMENT);
  assert.strictEqual((await rejection(built.platform.ensureDirectory({}))).code, CODES.INVALID_ARGUMENT);
  assert.strictEqual((await rejection(built.platform.writeTextFile({ path: built.dir + 'x.txt' }))).code,
    CODES.INVALID_ARGUMENT);
  assert.strictEqual((await rejection(built.platform.writeBinaryFile({ path: built.dir + 'x.bin' }))).code,
    CODES.INVALID_ARGUMENT);
  assert.strictEqual((await rejection(built.platform.buildEpub({ entries: [] }))).code, CODES.INVALID_ARGUMENT);
  assert.strictEqual((await rejection(built.platform.archiveProject({ projectDir: built.dir, destDir: built.dir }))).code,
    CODES.INVALID_ARGUMENT);
  assert.strictEqual((await rejection(built.platform.listBackups({}))).code, CODES.INVALID_ARGUMENT);
});

// ---------------------------------------------------------------------------------------------
// Group I - spellcheck dictionaries
// ---------------------------------------------------------------------------------------------

function writeSharedDictionary(appDir){
  fs.mkdirSync(appDir + 'dictionaries', { recursive: true });
  fs.writeFileSync(appDir + 'dictionaries/en_US-large.aff', 'SET UTF-8', 'utf8');
  fs.writeFileSync(appDir + 'dictionaries/en_US-large.dic', '2\nhello\nworld', 'utf8');
}

function writeDictionaryPair(dir, id, affText, dicText){
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dir + '/' + id + '.aff', affText == null ? 'SET UTF-8' : affText, 'utf8');
  fs.writeFileSync(dir + '/' + id + '.dic', dicText == null ? '1\nhello' : dicText, 'utf8');
}

function dictPlatformIn(t){
  const dir = tempDir(t).replaceAll('\\', '/');
  const appDir = dir + 'app';
  const userDataDir = dir + 'user';
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });

  return {
    appDir: appDir,
    userDataDir: userDataDir,
    platform: wrap(createNodeBacking({ paths: { app: appDir, userData: userDataDir } }))
  };
}

//nspell is pure JS and stays in the webview - only the dictionary text crosses.
test('loadDictionaries returns the requested bundled and imported pairs, in order', async function(t){
  const built = dictPlatformIn(t);
  writeDictionaryPair(built.appDir + '/dictionaries', 'en_US-large', 'SET UTF-8', '2\nhello\nworld');
  writeDictionaryPair(built.userDataDir + '/dictionaries', 'fr_FR', 'SET UTF-8', '1\nbonjour');

  const loaded = await built.platform.loadDictionaries({ ids: ['fr_FR', 'en_US-large'] });

  assert.deepStrictEqual(loaded, [
    { id: 'fr_FR', aff: 'SET UTF-8', dic: '1\nbonjour' },
    { id: 'en_US-large', aff: 'SET UTF-8', dic: '2\nhello\nworld' }
  ]);
});

test('loadDictionaries skips an id that is not on disk', async function(t){
  const built = dictPlatformIn(t);
  writeDictionaryPair(built.appDir + '/dictionaries', 'en_US-large');

  const loaded = await built.platform.loadDictionaries({ ids: ['en_US-large', 'nonexistent'] });

  assert.deepStrictEqual(loaded.map(function(d){ return d.id; }), ['en_US-large']);
});

//The behaviour when a writer removes a dictionary they had selected, unticks everything, or copies
//user-settings.json to a machine an import does not exist on - spellcheck must not simply stop
//working.
test('loadDictionaries falls back to the shared default when the selection resolves to nothing', async function(t){
  const built = dictPlatformIn(t);
  writeSharedDictionary(built.appDir + '/');

  const emptyIds = await built.platform.loadDictionaries({ ids: [] });
  const missingIds = await built.platform.loadDictionaries({ ids: ['nonexistent'] });
  const noArgs = await built.platform.loadDictionaries({});

  [emptyIds, missingIds, noArgs].forEach(function(loaded){
    assert.deepStrictEqual(loaded, [{ id: 'en_US-large', aff: 'SET UTF-8', dic: '2\nhello\nworld' }]);
  });
});

test('loadDictionaries rejects UNAVAILABLE when the fallback has no app directory configured', async function(){
  const platform = wrap(createNodeBacking({}));

  assert.strictEqual((await rejection(platform.loadDictionaries({ ids: [] }))).code, CODES.UNAVAILABLE);
});

test('loadDictionaries rejects NOT_FOUND when the fallback dictionary files are missing', async function(t){
  const appDir = tempDir(t).replaceAll('\\', '/');
  const platform = wrap(createNodeBacking({ paths: { app: appDir } }));

  assert.strictEqual((await rejection(platform.loadDictionaries({ ids: [] }))).code, CODES.NOT_FOUND);
});

test('listDictionaries finds both bundled pairs and excludes personal.dic and license', async function(t){
  const built = dictPlatformIn(t);
  writeDictionaryPair(built.appDir + '/dictionaries', 'en_US-large');
  writeDictionaryPair(built.appDir + '/dictionaries', 'en_us');
  fs.writeFileSync(built.appDir + '/dictionaries/personal.dic', 'WareWoolf\n', 'utf8');
  fs.writeFileSync(built.appDir + '/dictionaries/license', 'MIT', 'utf8');

  const listed = await built.platform.listDictionaries();

  assert.deepStrictEqual(listed, [
    { id: 'en_US-large', source: 'bundled', removable: false },
    { id: 'en_us', source: 'bundled', removable: false }
  ]);
});

test('an .aff with no .dic is not listed', async function(t){
  const built = dictPlatformIn(t);
  fs.mkdirSync(built.appDir + '/dictionaries', { recursive: true });
  fs.writeFileSync(built.appDir + '/dictionaries/orphan.aff', 'SET UTF-8', 'utf8');

  assert.deepStrictEqual(await built.platform.listDictionaries(), []);
});

test('listDictionaries marks imported entries removable and bundled ones not', async function(t){
  const built = dictPlatformIn(t);
  writeDictionaryPair(built.appDir + '/dictionaries', 'en_US-large');
  writeDictionaryPair(built.userDataDir + '/dictionaries', 'fr_FR');

  const listed = await built.platform.listDictionaries();

  assert.deepStrictEqual(listed, [
    { id: 'en_US-large', source: 'bundled', removable: false },
    { id: 'fr_FR', source: 'imported', removable: true }
  ]);
});

test('readDictionaryFiles decodes an ISO8859-1 pair and rewrites the stored SET line to UTF-8', async function(t){
  const dir = tempDir(t).replaceAll('\\', '/');
  const affPath = dir + 'café.aff';
  const dicPath = dir + 'café.dic';
  //café encoded as ISO8859-1/latin1 bytes.
  fs.writeFileSync(affPath, Buffer.from('SET ISO8859-1\n', 'latin1'));
  fs.writeFileSync(dicPath, Buffer.from('1\ncafé', 'latin1'));
  const built = dictPlatformIn(t);

  const result = await built.platform.readDictionaryFiles({ affPath: affPath, dicPath: dicPath });

  assert.strictEqual(result.id, 'café');
  assert.strictEqual(result.aff, 'SET UTF-8\n');
  assert.strictEqual(result.dic, '1\ncafé');
});

//A .txt or .dic of names with no affix file at all - what a writer importing "every character in my
//series" actually has.
test('readDictionaryFiles generates a SET UTF-8 affix for a bare word list with no affPath', async function(t){
  const dir = tempDir(t).replaceAll('\\', '/');
  const dicPath = dir + 'characters.dic';
  fs.writeFileSync(dicPath, '2\nAurelion\nDorrigo', 'utf8');
  const built = dictPlatformIn(t);

  const result = await built.platform.readDictionaryFiles({ dicPath: dicPath });

  assert.strictEqual(result.id, 'characters');
  assert.strictEqual(result.aff, 'SET UTF-8\n');
  assert.strictEqual(result.dic, '2\nAurelion\nDorrigo');
});

test('importDictionary writes a new pair into userData/dictionaries', async function(t){
  const built = dictPlatformIn(t);

  await built.platform.importDictionary({ id: 'fr_FR', aff: 'SET UTF-8\n', dic: '1\nbonjour' });

  assert.strictEqual(fs.readFileSync(built.userDataDir + '/dictionaries/fr_FR.aff', 'utf8'), 'SET UTF-8\n');
  assert.strictEqual(fs.readFileSync(built.userDataDir + '/dictionaries/fr_FR.dic', 'utf8'), '1\nbonjour');
  assert.deepStrictEqual(await built.platform.listDictionaries(),
    [{ id: 'fr_FR', source: 'imported', removable: true }]);
});

test('importDictionary generates a SET UTF-8 affix when none is given', async function(t){
  const built = dictPlatformIn(t);

  await built.platform.importDictionary({ id: 'characters', dic: '1\nAurelion' });

  assert.strictEqual(fs.readFileSync(built.userDataDir + '/dictionaries/characters.aff', 'utf8'), 'SET UTF-8\n');
});

test('importDictionary refuses a colliding id whether bundled or already imported', async function(t){
  const built = dictPlatformIn(t);
  writeDictionaryPair(built.appDir + '/dictionaries', 'en_US-large');
  await built.platform.importDictionary({ id: 'fr_FR', aff: 'SET UTF-8\n', dic: '1\nbonjour' });

  const bundledCollision = await rejection(
    built.platform.importDictionary({ id: 'en_US-large', aff: 'SET UTF-8\n', dic: '1\nx' }));
  const importedCollision = await rejection(
    built.platform.importDictionary({ id: 'fr_FR', aff: 'SET UTF-8\n', dic: '1\nx' }));

  assert.strictEqual(bundledCollision.code, CODES.ALREADY_EXISTS);
  assert.strictEqual(importedCollision.code, CODES.ALREADY_EXISTS);
});

test('removeDictionary deletes an imported pair', async function(t){
  const built = dictPlatformIn(t);
  writeDictionaryPair(built.userDataDir + '/dictionaries', 'fr_FR');

  await built.platform.removeDictionary({ id: 'fr_FR' });

  assert.strictEqual(fs.existsSync(built.userDataDir + '/dictionaries/fr_FR.aff'), false);
  assert.strictEqual(fs.existsSync(built.userDataDir + '/dictionaries/fr_FR.dic'), false);
});

test('removeDictionary refuses a bundled id with INVALID_ARGUMENT', async function(t){
  const built = dictPlatformIn(t);
  writeDictionaryPair(built.appDir + '/dictionaries', 'en_US-large');

  const err = await rejection(built.platform.removeDictionary({ id: 'en_US-large' }));

  assert.strictEqual(err.code, CODES.INVALID_ARGUMENT);
  assert.strictEqual(fs.existsSync(built.appDir + '/dictionaries/en_US-large.aff'), true);
});

//Folds in the bootstrap write createPersonalDicIfNeeded() used to require the caller run first
//(spellcheck.js:38-44) - the caller stops knowing the file has to be created before it can be read.
test('loadPersonalDictionary seeds the file on first read', async function(t){
  const built = platformIn(t);

  assert.deepStrictEqual(await built.platform.loadPersonalDictionary(), ['WareWoolf']);
  assert.ok(fs.existsSync(built.dir + 'dictionaries/personal.dic'));
});

test('savePersonalDictionary and loadPersonalDictionary round-trip the word list', async function(t){
  const built = platformIn(t);

  await built.platform.savePersonalDictionary({ words: ['WareWoolf', 'nspell', 'markdownfic'] });

  assert.deepStrictEqual(await built.platform.loadPersonalDictionary(), ['WareWoolf', 'nspell', 'markdownfic']);
});

test('personal dictionary commands reject UNAVAILABLE without a userData directory configured', async function(){
  const platform = wrap(createNodeBacking({}));

  assert.strictEqual((await rejection(platform.loadPersonalDictionary())).code, CODES.UNAVAILABLE);
  assert.strictEqual((await rejection(platform.savePersonalDictionary({ words: [] }))).code, CODES.UNAVAILABLE);
});

// ---------------------------------------------------------------------------------------------
// Group K - updates
// ---------------------------------------------------------------------------------------------

function releaseJson(overrides){
  return JSON.stringify(Object.assign({
    tag_name: 'v2.0.0',
    prerelease: false,
    body: 'Release notes',
    published_at: '2026-01-01T00:00:00Z',
    assets: [{ name: 'warewoolf_2.0.0_amd64.deb', browser_download_url: 'https://example.com/amd64.deb' }]
  }, overrides));
}

test('checkForUpdate resolves the parsed release JSON on a 200 response', async function(t){
  const platform = wrap(createNodeBacking({
    httpsRequest: fakeHttpsRequest({ statusCode: 200, body: releaseJson() })
  }));

  const data = await platform.checkForUpdate();
  assert.strictEqual(data.tag_name, 'v2.0.0');
  assert.strictEqual(data.assets[0].name, 'warewoolf_2.0.0_amd64.deb');
});

test('checkForUpdate rejects IO_ERROR, with GitHub\'s own status and body, on a non-200 response', async function(t){
  const platform = wrap(createNodeBacking({
    httpsRequest: fakeHttpsRequest({ statusCode: 403, body: JSON.stringify({ message: 'API rate limit exceeded' }) })
  }));

  const err = await rejection(platform.checkForUpdate());
  assert.strictEqual(err.code, CODES.IO_ERROR);
  assert.match(err.message, /403/);
  assert.match(err.message, /API rate limit exceeded/);
});

test('checkForUpdate rejects instead of throwing when the response body is not valid JSON', async function(t){
  const platform = wrap(createNodeBacking({
    httpsRequest: fakeHttpsRequest({ statusCode: 200, body: '<html>not json</html>' })
  }));

  const err = await rejection(platform.checkForUpdate());
  assert.ok(err.isPlatformError);
});

test('checkForUpdate rejects when the request itself errors', async function(t){
  const platform = wrap(createNodeBacking({
    httpsRequest: fakeHttpsRequest({ triggerError: new Error('ENOTFOUND api.github.com') })
  }));

  const err = await rejection(platform.checkForUpdate());
  assert.match(err.message, /ENOTFOUND/);
});

test('checkForUpdate sets a request timeout and destroys the request once it fires', async function(t){
  let capturedOptions, capturedReq;
  const platform = wrap(createNodeBacking({
    httpsRequest: function(options){
      capturedOptions = options;
      const req = new EventEmitter();
      req.end = function(){};
      //A real ClientRequest.destroy(err) emits 'error' with that err - reproduced here so
      //checkForUpdate's own promise actually settles instead of hanging forever.
      req.destroy = function(err){ req.destroyedWith = err; req.emit('error', err); };
      capturedReq = req;
      return req;
    }
  }));

  const pending = rejection(platform.checkForUpdate());
  await new Promise(function(resolve){ setImmediate(resolve); });

  assert.ok(capturedOptions.timeout > 0);
  capturedReq.emit('timeout');
  assert.ok(capturedReq.destroyedWith instanceof Error);
  await pending;
});

//Every update test below goes through a backing that was told which platform it is on, because both
//halves of this command pair turn on it: installUpdate is linux-only, and downloadUpdate picks its
//own destination directory differently there. Without the seam neither branch would be exercisable
//on the machine this suite usually runs on, and the branch that matters for privilege is the one
//that would go untested.
function updatePlatform(t, deps){
  const options = Object.assign({}, deps);
  const dirs = [];

  //downloadUpdate allocates its own directories now, so the test cannot register them for cleanup
  //up front the way tempDir() does - it learns the path only from the result.
  t.after(function(){
    dirs.forEach(function(dir){
      //downloadUpdate locks its own temp directory to 0500 and the asset to 0400, so on a real
      //POSIX filesystem neither can be unlinked until the modes go back. Restoring them here is
      //part of the cleanup, not a workaround: a test that could still delete them would be saying
      //the hardening had not happened.
      try{
        fs.chmodSync(dir, 0o700);
        fs.readdirSync(dir).forEach(function(entry){
          try{ fs.chmodSync(path.join(dir, entry), 0o600); } catch(entryErr){}
        });
      }
      catch(chmodErr){}

      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  return {
    platform: wrap(createNodeBacking(options)),
    //Call on any path a command handed back, so a real download's temp directory does not outlive
    //the test that made it.
    cleanUp: function(filePath){
      dirs.push(path.dirname(filePath));
      return filePath;
    }
  };
}

//The shape checkForUpdate's own response actually carries: a browser_download_url on this project's
//repo. downloadUpdate accepts nothing else.
function assetUrl(name){
  return 'https://github.com/brsloan/warewoolf/releases/download/v2.0.0/' + name;
}

function isUnderTempDir(filePath){
  return filePath.replaceAll('\\', '/').indexOf(os.tmpdir().replaceAll('\\', '/') + '/warewoolf-update-') === 0;
}

//Phase 9c: destPath is gone from this command's parameters, and this is the test that says so. The
//path comes back from a directory the backing made and a filename it took off the URL, so there is
//nothing here for a caller to have named.
test('downloadUpdate allocates its own destination and writes the asset there', async function(t){
  const fixture = updatePlatform(t, {
    platform: 'linux',
    httpsGet: fakeHttpsGet([{ statusCode: 200, body: 'binary-content-stand-in' }])
  });

  const result = await fixture.platform.downloadUpdate({ url: assetUrl('warewoolf_2.0.0_amd64.deb') });
  fixture.cleanUp(result.path);

  assert.ok(isUnderTempDir(result.path), result.path + ' should be in a directory this backing made');
  assert.strictEqual(path.basename(result.path), 'warewoolf_2.0.0_amd64.deb');
  assert.strictEqual(fs.readFileSync(result.path, 'utf8'), 'binary-content-stand-in');
});

//The hardening that narrows the window between installUpdate's hash check and dpkg's own read of
//the file. Mode bits are a POSIX notion - Node's chmod on Windows only toggles a read-only flag and
//does nothing at all to a directory - so the modes themselves are asserted only where the OS
//actually has them. The Pi pass is what confirms this for real; what runs everywhere is that the
//call happens on the right branch and not the wrong one.
test('downloadUpdate locks down the asset and the directory it made for it', async function(t){
  const fixture = updatePlatform(t, {
    platform: 'linux',
    httpsGet: fakeHttpsGet([{ statusCode: 200, body: 'binary-content-stand-in' }])
  });

  const result = await fixture.platform.downloadUpdate({ url: assetUrl('warewoolf_2.0.0_amd64.deb') });
  fixture.cleanUp(result.path);

  if(process.platform === 'win32'){
    t.skip('chmod modes are not meaningful on Windows - the Pi pass covers this');
    return;
  }

  assert.strictEqual(fs.statSync(result.path).mode & 0o777, 0o400,
    'the downloaded asset should be read-only, so writeBinaryFile cannot overwrite it');
  assert.strictEqual(fs.statSync(path.dirname(result.path)).mode & 0o777, 0o500,
    'its directory should not be writable, so deleteEntry cannot unlink it and write a replacement');
});

//The reason the hardening exists, expressed as the attack rather than as the mode bits: a renderer
//that has already got a legitimate download vouched tries to swap the bytes underneath it before
//dpkg reads them, using only commands it already has.
test('a renderer cannot swap a vouched update out from under installUpdate', async function(t){
  const fixture = updatePlatform(t, {
    platform: 'linux',
    httpsGet: fakeHttpsGet([{ statusCode: 200, body: 'the real release asset' }])
  });

  const result = await fixture.platform.downloadUpdate({ url: assetUrl('warewoolf_2.0.0_amd64.deb') });
  fixture.cleanUp(result.path);

  //The overwrite half holds on Windows too: chmod there sets the read-only attribute, which is
  //enough to refuse a write. Asserted unconditionally so this does not become a test that only
  //ever runs on hardware nobody develops on.
  await assert.rejects(fixture.platform.writeBinaryFile({
    path: result.path, bytes: Buffer.from('swapped payload')
  }), 'overwriting the vouched asset should be refused by the filesystem');

  //Deleting and recreating is the other route, and refusing it depends on the directory's mode -
  //which Windows does not have. POSIX only, and the Pi pass is what confirms it in the place it
  //actually matters, since installUpdate is linux-only anyway.
  if(process.platform !== 'win32')
    await assert.rejects(fixture.platform.deleteEntry({ path: result.path }),
      'unlinking it to write a replacement should be refused too');

  assert.strictEqual(fs.readFileSync(result.path, 'utf8'), 'the real release asset',
    'the bytes installUpdate hashed must still be the bytes on disk');
});

//The other branch, and the reason the destination is not simply "always a temp directory this
//command owns": off linux there is no installUpdate, the download is the whole deliverable, and the
//About panel tells the writer to go find it in their downloads folder. It is also the writer's own
//folder with their own files in it, so the hardening above must not touch it.
test('downloadUpdate does not lock down the writer\'s downloads folder', async function(t){
  const dir = tempDir(t);
  const fixture = updatePlatform(t, {
    platform: 'win32',
    paths: { downloads: dir },
    httpsGet: fakeHttpsGet([{ statusCode: 200, body: 'windows-binary' }])
  });

  await fixture.platform.downloadUpdate({ url: assetUrl('warewoolf_2.0.0_Windows_x64.zip') });

  //Asserted by behaviour rather than by mode bits, so it means something on every platform: a
  //directory this command does not own must still take a new file afterwards.
  fs.writeFileSync(path.join(dir, 'writer-put-this-here.txt'), 'still mine', 'utf8');
  assert.ok(fs.existsSync(path.join(dir, 'writer-put-this-here.txt')));
});

test('downloadUpdate writes into the downloads directory on platforms that cannot install', async function(t){
  const dir = tempDir(t);
  const fixture = updatePlatform(t, {
    platform: 'win32',
    paths: { downloads: dir },
    httpsGet: fakeHttpsGet([{ statusCode: 200, body: 'windows-binary' }])
  });

  const result = await fixture.platform.downloadUpdate({ url: assetUrl('warewoolf_2.0.0_Windows_x64.zip') });

  assert.strictEqual(result.path, dir.replaceAll('\\', '/') + 'warewoolf_2.0.0_Windows_x64.zip');
  assert.strictEqual(fs.readFileSync(result.path, 'utf8'), 'windows-binary');
});

//A URL is the only thing about this download that still crosses inbound, so it is the only thing
//left to check - and it is checked against the repo the release API itself is read from, not against
//a general "looks like https" rule.
test('downloadUpdate refuses a url that is not a release asset on this project\'s own repo', async function(t){
  const getFake = fakeHttpsGet([]);
  const fixture = updatePlatform(t, { platform: 'linux', httpsGet: getFake });

  const refused = [
    'https://evil.example.com/brsloan/warewoolf/releases/download/v2.0.0/pkg.deb',
    'http://github.com/brsloan/warewoolf/releases/download/v2.0.0/pkg.deb',
    'https://github.com/someone-else/warewoolf/releases/download/v2.0.0/pkg.deb',
    'https://github.com/brsloan/warewoolf/issues/pkg.deb',
    'https://github.com.evil.example.com/brsloan/warewoolf/releases/download/v2.0.0/pkg.deb',
    'not a url at all'
  ];

  for(const url of refused){
    const err = await rejection(fixture.platform.downloadUpdate({ url: url }));
    assert.strictEqual(err.code, CODES.INVALID_ARGUMENT, url + ' should not be downloadable');
  }

  assert.strictEqual(getFake.calls.length, 0, 'nothing should have been fetched');
});

//The filename is taken off the URL rather than from the caller, so it is the URL's last segment that
//has to be unable to name something else. An allowlist rather than a sanitizer: a name that does not
//match is refused outright, so nothing is quietly rewritten into a path the caller did not expect.
test('downloadUpdate refuses an asset filename that could name something other than a file', async function(t){
  const getFake = fakeHttpsGet([]);
  const fixture = updatePlatform(t, { platform: 'linux', httpsGet: getFake });

  const refused = [
    'https://github.com/brsloan/warewoolf/releases/download/v2.0.0/..%2F..%2Fetc%2Fcron.d%2Fx',
    'https://github.com/brsloan/warewoolf/releases/download/v2.0.0/-oDPkg%3A%3APre-Invoke%3A%3A%3Dtouch%20x',
    'https://github.com/brsloan/warewoolf/releases/download/v2.0.0/.bashrc',
    'https://github.com/brsloan/warewoolf/releases/download/v2.0.0/'
  ];

  for(const url of refused){
    const err = await rejection(fixture.platform.downloadUpdate({ url: url }));
    assert.strictEqual(err.code, CODES.INVALID_ARGUMENT, url + ' should not be downloadable');
  }

  assert.strictEqual(getFake.calls.length, 0);
});

//The already-downloaded shortcut, narrowed. Phase 8 skipped the download whenever fs.existsSync was
//true and vouched the path on that alone, which is what made the vouch forgeable; all the shortcut
//was ever worth is saving a re-download of something this session already has, so that is all it
//does now.
test('downloadUpdate skips the network only for a path it already vouched this session', async function(t){
  const dir = tempDir(t);
  const getFake = fakeHttpsGet([
    { statusCode: 200, body: 'the real asset' },
    { statusCode: 200, body: 'should not be needed' }
  ]);
  const fixture = updatePlatform(t, { platform: 'win32', paths: { downloads: dir }, httpsGet: getFake });

  const first = await fixture.platform.downloadUpdate({ url: assetUrl('pkg.deb') });
  const second = await fixture.platform.downloadUpdate({ url: assetUrl('pkg.deb') });

  assert.strictEqual(second.path, first.path);
  assert.strictEqual(getFake.calls.length, 1, 'the second call should have been served from the vouch');
});

test('downloadUpdate downloads over a file it did not put there, rather than trusting it', async function(t){
  const dir = tempDir(t);
  const getFake = fakeHttpsGet([{ statusCode: 200, body: 'the real asset' }]);
  const fixture = updatePlatform(t, { platform: 'win32', paths: { downloads: dir }, httpsGet: getFake });
  fs.writeFileSync(dir + 'pkg.deb', 'planted');

  const result = await fixture.platform.downloadUpdate({ url: assetUrl('pkg.deb') });

  assert.strictEqual(getFake.calls.length, 1, 'an unvouched file must not short-circuit the download');
  assert.strictEqual(fs.readFileSync(result.path, 'utf8'), 'the real asset');
});

test('downloadUpdate follows one redirect to the real asset location', async function(t){
  const getFake = fakeHttpsGet([
    { statusCode: 302, headers: { location: 'https://objects.githubusercontent.com/real-asset.deb' } },
    { statusCode: 200, body: 'redirected-content' }
  ]);
  const fixture = updatePlatform(t, { platform: 'linux', httpsGet: getFake });

  const result = await fixture.platform.downloadUpdate({ url: assetUrl('warewoolf_2.0.0_amd64.deb') });
  fixture.cleanUp(result.path);

  assert.deepStrictEqual(getFake.calls, [
    assetUrl('warewoolf_2.0.0_amd64.deb'),
    'https://objects.githubusercontent.com/real-asset.deb'
  ]);
  assert.strictEqual(fs.readFileSync(result.path, 'utf8'), 'redirected-content');
});

//The redirect target is not checked against a hostname - GitHub's asset CDN has moved more than
//once, and the redirect is chosen by the host we just authenticated over TLS. That it stays on https
//is the part worth pinning, and it is pinned here.
test('downloadUpdate refuses to follow a redirect off https', async function(t){
  const getFake = fakeHttpsGet([
    { statusCode: 302, headers: { location: 'http://objects.example.com/asset.deb' } }
  ]);
  const fixture = updatePlatform(t, { platform: 'linux', httpsGet: getFake });

  const err = await rejection(fixture.platform.downloadUpdate({ url: assetUrl('warewoolf_2.0.0_amd64.deb') }));

  assert.strictEqual(err.code, CODES.IO_ERROR);
  assert.strictEqual(getFake.calls.length, 1);
});

test('downloadUpdate rejects and removes the partial file when the server responds with an error status', async function(t){
  const fixture = updatePlatform(t, {
    platform: 'linux',
    httpsGet: fakeHttpsGet([{ statusCode: 404 }])
  });

  const err = await rejection(fixture.platform.downloadUpdate({ url: assetUrl('missing.deb') }));
  assert.strictEqual(err.code, CODES.IO_ERROR);
});

test('downloadUpdate rejects and removes the partial file when the request itself errors', async function(t){
  const fixture = updatePlatform(t, {
    platform: 'linux',
    httpsGet: fakeHttpsGet([{ triggerError: new Error('socket hang up') }])
  });

  const err = await rejection(fixture.platform.downloadUpdate({ url: assetUrl('flaky.deb') }));
  assert.ok(err.isPlatformError);
});

//Direct proof, mirroring buildEpub/archiveProject's own tests: downloadUpdate resolves on the
//destination write stream's 'close', not on the http response finishing. The original updates.js
//resolved as soon as the response piped through, the same truncated-file risk Phase 6 fixed
//elsewhere - corrected here rather than carried over. See platform.js's note on this command.
test('downloadUpdate resolves on the write stream\'s "close", not when the response finishes piping', async function(t){
  const output = controllableWriteStream();
  const fixture = updatePlatform(t, {
    platform: 'linux',
    createWriteStream: function(){ return output; },
    httpsGet: fakeHttpsGet([{ statusCode: 200, body: 'content' }])
  });

  let settled = false;
  const finished = new Promise(function(resolve){ output.once('finish', resolve); });

  const promise = fixture.platform.downloadUpdate({ url: assetUrl('slow-close.deb') });
  promise.then(function(){ settled = true; }, function(){ settled = true; });

  await finished;
  await new Promise(function(resolve){ setImmediate(resolve); });
  assert.strictEqual(settled, false, 'downloadUpdate resolved before the write stream emitted "close"');

  output.triggerClose();
  await promise;
  assert.strictEqual(settled, true);
});

//installUpdate is the one command in the whole contract that escalates privilege - see the note on
//it in platform.js. Every test below shares one backing with the downloadUpdate that vouched the
//path, the way updates.js's own single standing instance keeps them together in the real app.
async function vouchedInstaller(fixture, name, body){
  const result = await fixture.platform.downloadUpdate({ url: assetUrl(name) });
  fixture.cleanUp(result.path);
  return result.path;
}

function installFixture(t, responses, spawnFake){
  return updatePlatform(t, {
    platform: 'linux',
    spawnProcess: spawnFake,
    httpsGet: fakeHttpsGet(responses)
  });
}

test('installUpdate refuses a path this backing never downloaded, without spawning anything', async function(t){
  const spawnFake = fakeSpawn([]);
  const fixture = installFixture(t, [], spawnFake);

  const err = await rejection(fixture.platform.installUpdate({ path: '/tmp/some-other-pkg.deb', password: 'secret' }));

  assert.strictEqual(err.code, CODES.INVALID_ARGUMENT);
  assert.strictEqual(spawnFake.calls.length, 0);
});

//----------------------------------------------------------------------------------------------
//The attack this pair of commands exists to refuse, written out as the attack.
//
///security-review found it against Phase 9b: three declared commands, all reachable from an
//untrusted renderer over the bridge, composing into the only renderer-to-root path left in the app
//once contextIsolation landed. Phase 8's vouch did not stop it, because downloadUpdate took the
//destination path from the renderer and vouched it on fs.existsSync alone - so "a path this backing
//produced" meant "a path the renderer named", and step 2 below cost one extra IPC call and no
//network traffic at all.
//
//If a change to these commands makes either of the two tests below pass a path through to spawn,
//that change has reopened it. Neither test is about a message or a code: both assert that sudo was
//never reached.
//----------------------------------------------------------------------------------------------
test('regression: writeBinaryFile then downloadUpdate cannot vouch an attacker-supplied installer', async function(t){
  const dir = tempDir(t);
  const spawnFake = fakeSpawn([{ code: 0 }]);
  //The renderer would be calling these three across the bridge; this is the same facade, and under
  //the bridge transport the same serialization too.
  const fixture = installFixture(t, [{ statusCode: 200, body: 'the real asset' }], spawnFake);
  const platform = fixture.platform;
  const plantedPath = dir + 'x.deb';

  // 1. Group G's conceded arbitrary write: put a hostile .deb anywhere.
  await platform.writeBinaryFile({ path: plantedPath, bytes: Buffer.from('hostile postinst') });
  assert.strictEqual(fs.existsSync(plantedPath), true, 'writeBinaryFile is still an arbitrary write');

  // 2. Ask downloadUpdate to bless it, passing the destPath that used to do exactly that. An
  //    untrusted renderer is not held to the declared parameter list - COMMANDS['downloadUpdate']
  //    .params is documentation, and nothing strips an extra key on the way across - so the attack
  //    keeps sending the argument whether or not the contract still lists it. It has to be ignored,
  //    not merely absent: this assertion is what fails if destPath is ever wired back up.
  const downloaded = await platform.downloadUpdate({ url: assetUrl('x.deb'), destPath: plantedPath });
  fixture.cleanUp(downloaded.path);
  assert.notStrictEqual(downloaded.path, plantedPath, 'destPath must not steer the download');
  assert.strictEqual(fs.readFileSync(plantedPath, 'utf8'), 'hostile postinst', 'the planted file is untouched, and unvouched');

  // 3. Install it as root.
  const err = await rejection(platform.installUpdate({ path: plantedPath, password: 'whatever' }));

  assert.strictEqual(err.code, CODES.INVALID_ARGUMENT);
  assert.strictEqual(spawnFake.calls.length, 0, 'sudo must not have been spawned');
});

//The same attack against the one path that *is* vouched. A backing-allocated destination is not a
//secret - it comes back to the renderer, which needs it for installUpdate - and writeBinaryFile can
//still write to it. So the vouch cannot be about the path: it records the sha256 of the bytes this
//backing downloaded, and installUpdate re-reads and re-hashes immediately before spawning.
//The hash guard on its own, with the permission guard deliberately stood down. downloadUpdate now
//locks the asset to 0400, so the swap this test performs is refused by the filesystem before it can
//even be attempted through writeBinaryFile - which is what the hardening is for, and what its own
//test above asserts. But the two are separate layers and the hash is the one that has to hold: file
//modes protect against this app's own command surface and nothing else, so anything running as the
//user outside it can still put different bytes there. Restoring the mode first is how this test
//keeps asking the question it was written to ask - if the bytes change by any means at all, does
//installUpdate still refuse? - rather than quietly becoming a second test of the chmod.
test('regression: overwriting the file downloadUpdate did produce does not inherit its vouch', async function(t){
  const spawnFake = fakeSpawn([{ code: 0 }]);
  const fixture = installFixture(t, [{ statusCode: 200, body: 'the real asset' }], spawnFake);
  const platform = fixture.platform;

  const installerPath = await vouchedInstaller(fixture, 'pkg.deb');
  fs.chmodSync(path.dirname(installerPath), 0o700);
  fs.chmodSync(installerPath, 0o600);
  await platform.writeBinaryFile({ path: installerPath, bytes: Buffer.from('hostile postinst') });

  const err = await rejection(platform.installUpdate({ path: installerPath, password: 'whatever' }));

  assert.strictEqual(err.code, CODES.INVALID_ARGUMENT);
  assert.match(err.message, /contents changed/);
  assert.strictEqual(spawnFake.calls.length, 0, 'sudo must not have been spawned');
});

test('installUpdate runs sudo/apt via spawn with the vouched path after a "--", no shell', async function(t){
  const spawnFake = fakeSpawn([{ code: 0 }]);
  const fixture = installFixture(t, [{ statusCode: 200, body: 'installer bytes' }], spawnFake);
  const installerPath = await vouchedInstaller(fixture, 'pkg.deb');

  await fixture.platform.installUpdate({ path: installerPath, password: 'secret' });

  assert.strictEqual(spawnFake.calls[0].command, 'sudo');
  assert.deepStrictEqual(spawnFake.calls[0].args, ['-S', 'apt', 'install', '--', installerPath]);
  assert.ok(!spawnFake.calls[0].options || !spawnFake.calls[0].options.shell);
});

test('installUpdate writes the password to the child\'s stdin, never into argv', async function(t){
  let capturedChild;
  const fixture = installFixture(t, [{ statusCode: 200, body: 'installer bytes' }], function(){
    capturedChild = fakeChildProcess();
    setImmediate(function(){ capturedChild.emit('close', 0); });
    return capturedChild;
  });
  const installerPath = await vouchedInstaller(fixture, 'pkg.deb');
  const dangerousPass = 'p"a$s\'w`ord; rm -rf /; #';

  await fixture.platform.installUpdate({ path: installerPath, password: dangerousPass });

  assert.strictEqual(capturedChild.stdinChunks.join(''), dangerousPass + '\n');
});

test('installUpdate rejects IO_ERROR with the process output when apt exits non-zero', async function(t){
  const spawnFake = fakeSpawn([{ stderrChunks: ['Sorry, try again.'], code: 1 }]);
  const fixture = installFixture(t, [{ statusCode: 200, body: 'installer bytes' }], spawnFake);
  const installerPath = await vouchedInstaller(fixture, 'pkg.deb');

  const err = await rejection(fixture.platform.installUpdate({ path: installerPath, password: 'wrong' }));

  assert.strictEqual(err.code, CODES.IO_ERROR);
  assert.strictEqual(err.exitCode, 1);
  assert.match(err.message, /Sorry, try again\./);
});

test('installUpdate resolves once apt closes with exit code 0', async function(t){
  const fixture = installFixture(t, [{ statusCode: 200, body: 'installer bytes' }], fakeSpawn([{ code: 0 }]));
  const installerPath = await vouchedInstaller(fixture, 'pkg.deb');

  await assert.doesNotReject(fixture.platform.installUpdate({ path: installerPath, password: 'secret' }));
});

// ---------------------------------------------------------------------------------------------
// Group K - email
// ---------------------------------------------------------------------------------------------

function credentialFixture(t, deps){
  const dir = tempDir(t);
  return wrap(createNodeBacking(Object.assign({ paths: { userData: dir } }, deps)));
}

test('sendEmail sends a literal attachment as-is', async function(t){
  let capturedMail;
  const platform = credentialFixture(t, {
    createMailTransport: fakeMailTransport(function(mailOptions, cb){
      capturedMail = mailOptions;
      cb(null, { response: '250 OK' });
    })
  });

  await platform.sendEmail({
    service: 'email', sender: 'me@example.com', secret: 'typed-by-hand', receiver: 'you@example.com',
    attachments: [{ filename: 'a.txt', content: 'hello' }]
  });

  assert.strictEqual(capturedMail.from, 'me@example.com');
  assert.strictEqual(capturedMail.to, 'you@example.com');
  assert.deepStrictEqual(capturedMail.attachments, [{ filename: 'a.txt', content: 'hello', encoding: undefined }]);
});

test('sendEmail resolves SAVED_SECRET against the stored credential and never passes the sentinel to the transport', async function(t){
  let capturedAuth;
  const platform = credentialFixture(t, {
    createMailTransport: function(config){
      capturedAuth = config.auth;
      return { sendMail: function(mailOptions, cb){ cb(null, { response: '250 OK' }); } };
    }
  });
  await platform.storeCredential({ service: 'email', secret: 'the-real-password' });

  await platform.sendEmail({
    service: 'email', sender: 'me@example.com', secret: SAVED_SECRET, receiver: 'you@example.com', attachments: []
  });

  assert.strictEqual(capturedAuth.pass, 'the-real-password');
});

test('sendEmail rejects INVALID_ARGUMENT for SAVED_SECRET when nothing is stored, and never builds a transport', async function(t){
  let transportCalls = 0;
  const platform = credentialFixture(t, {
    createMailTransport: function(){ transportCalls++; return { sendMail: function(){} }; }
  });

  const err = await rejection(platform.sendEmail({
    service: 'email', sender: 'me@example.com', secret: SAVED_SECRET, receiver: 'you@example.com', attachments: []
  }));

  assert.strictEqual(err.code, CODES.INVALID_ARGUMENT);
  assert.strictEqual(transportCalls, 0);
});

test('sendEmail rejects LOCKED for SAVED_SECRET against a passphrase-protected credential nobody unlocked', async function(t){
  const dir = tempDir(t);
  const seeded = wrap(createNodeBacking({ paths: { userData: dir } }));
  await seeded.storeCredential({ service: 'email', secret: 'the-real-password', passphrase: 'hunter2' });

  let transportCalls = 0;
  //A fresh backing over the same directory: the passphrase-derived session key lives in the first
  //backing's own closure and never reached this one, so the credential is locked here.
  const platform = wrap(createNodeBacking({
    paths: { userData: dir },
    createMailTransport: function(){ transportCalls++; return { sendMail: function(){} }; }
  }));

  const err = await rejection(platform.sendEmail({
    service: 'email', sender: 'me@example.com', secret: SAVED_SECRET, receiver: 'you@example.com', attachments: []
  }));

  assert.strictEqual(err.code, CODES.LOCKED);
  assert.strictEqual(transportCalls, 0);
});

test('sendEmail\'s projectArchive attachment builds via archiveProject and cleans up its temp directory', async function(t){
  const dir = tempDir(t);
  const fixture = makeBackupProjectFixture(dir);

  let capturedMail;
  const platform = credentialFixture(t, {
    createMailTransport: fakeMailTransport(function(mailOptions, cb){
      capturedMail = mailOptions;
      cb(null, { response: '250 OK' });
    })
  });

  //Tracked only from here - credentialFixture()/tempDir() above make their own mkdtempSync calls
  //for the credential store's userData directory, unrelated to sendEmail's own temp directory.
  const createdDirs = [];
  const realMkdtemp = fs.mkdtempSync;
  patch(t, fs, 'mkdtempSync', function(prefix, options){
    const made = realMkdtemp(prefix, options);
    createdDirs.push(made);
    return made;
  });

  await platform.sendEmail({
    service: 'email', sender: 'me@example.com', secret: 'pw', receiver: 'you@example.com',
    attachments: [{ projectArchive: { projectDir: dir, chapsDir: fixture.chapsDir, sourceFilename: fixture.filename } }]
  });

  assert.match(capturedMail.attachments[0].filename, /^notes\.final\d{14}\.zip$/);
  assert.ok(Buffer.isBuffer(capturedMail.attachments[0].content));
  assert.strictEqual(createdDirs.length, 1);
  assert.strictEqual(fs.existsSync(createdDirs[0]), false);
});

test('sendEmail\'s epubEntries attachment builds via buildEpub and cleans up its temp directory', async function(t){
  let capturedMail;
  const platform = credentialFixture(t, {
    createMailTransport: fakeMailTransport(function(mailOptions, cb){
      capturedMail = mailOptions;
      cb(null, { response: '250 OK' });
    })
  });

  const createdDirs = [];
  const realMkdtemp = fs.mkdtempSync;
  patch(t, fs, 'mkdtempSync', function(prefix, options){
    const made = realMkdtemp(prefix, options);
    createdDirs.push(made);
    return made;
  });

  await platform.sendEmail({
    service: 'email', sender: 'me@example.com', secret: 'pw', receiver: 'you@example.com',
    attachments: [{ filename: 'Chapter One.epub', epubEntries: [{ name: 'mimetype', content: 'application/epub+zip' }] }]
  });

  assert.strictEqual(capturedMail.attachments[0].filename, 'Chapter One.epub');
  assert.ok(Buffer.isBuffer(capturedMail.attachments[0].content));
  assert.strictEqual(createdDirs.length, 1);
  assert.strictEqual(fs.existsSync(createdDirs[0]), false);
});

test('sendEmail rejects INVALID_ARGUMENT for an attachment with no content, projectArchive, or epubEntries', async function(t){
  let transportCalls = 0;
  const platform = credentialFixture(t, {
    createMailTransport: function(){ transportCalls++; return { sendMail: function(){} }; }
  });

  const err = await rejection(platform.sendEmail({
    service: 'email', sender: 'me@example.com', secret: 'pw', receiver: 'you@example.com',
    attachments: [{ filename: 'mystery.bin' }]
  }));

  assert.strictEqual(err.code, CODES.INVALID_ARGUMENT);
  assert.strictEqual(transportCalls, 0);
});

test('sendEmail rejects when the transport reports a send failure', async function(t){
  const platform = credentialFixture(t, {
    createMailTransport: fakeMailTransport(function(mailOptions, cb){
      cb(new Error('Invalid login: 535-5.7.8 Username and Password not accepted'), null);
    })
  });

  const err = await rejection(platform.sendEmail({
    service: 'email', sender: 'me@example.com', secret: 'pw', receiver: 'you@example.com', attachments: []
  }));

  assert.match(err.message, /Invalid login/);
});

test('sendEmail refuses arguments it cannot act on', async function(t){
  const platform = credentialFixture(t, { createMailTransport: fakeMailTransport(function(){}) });

  assert.strictEqual((await rejection(platform.sendEmail({ receiver: 'you@example.com', attachments: [] }))).code,
    CODES.INVALID_ARGUMENT);
  assert.strictEqual((await rejection(platform.sendEmail({ sender: 'me@example.com', attachments: [] }))).code,
    CODES.INVALID_ARGUMENT);
});

// ---------------------------------------------------------------------------------------------
// Group K - wifi and battery
// ---------------------------------------------------------------------------------------------

function enoent(command){
  const err = new Error('spawn ' + command + ' ENOENT');
  err.code = 'ENOENT';
  return err;
}

//Stubs only the one path getBatteryCapacity reads (/sys/class/power_supply, absent by
//construction on this suite's own Windows/macOS/CI machines), falling through to the *real*
//fs.readdirSync for anything else - captured before patching, since fs.readdirSync has already
//been reassigned to this replacement by the time it runs, so referencing fs.readdirSync from
//inside it would recurse into itself rather than the original.
function patchPowerSupplyDir(t, entriesOrThrow){
  const realReaddirSync = fs.readdirSync;
  patch(t, fs, 'readdirSync', function(p, options){
    if(p !== '/sys/class/power_supply')
      return realReaddirSync(p, options);
    if(typeof entriesOrThrow === 'function')
      entriesOrThrow();
    return entriesOrThrow;
  });
}

//The two fixtures below (and the wifiGetConnectionState ones further down) are captured, not
//hand-typed. Original bug: wifiListNetworks ran nmcli with no -f, relied on its default terse
//column order (IN-USE:BSSID:SSID:MODE:CHAN:RATE:SIGNAL:BARS:SECURITY), and read fields[7] - which
//is BARS (the signal-strength asterisks), not SSID, because splitNmcliFields correctly keeps a
//BSSID's colons inside one field. The hand-written fixture that stood here before encoded the same
//wrong field count the code assumed, so it agreed with the bug instead of catching it. The fix
//pins the columns explicitly (`-f IN-USE,SSID`), and this fixture is real `nmcli -t -f
//IN-USE,SSID device wifi list --rescan yes` output, captured 2026-09-07 from a Raspberry Pi on the
//writerDeck's own network (one visible network, already connected).
test('wifiListNetworks parses real nmcli output (captured on a Raspberry Pi, single connected network)',
    async function(t){
  const spawnFake = fakeSpawn([{ chunks: ['*:NETGEAR62\n'] }]);
  const platform = wrap(createNodeBacking({ spawnProcess: spawnFake }));

  const result = await platform.wifiListNetworks();

  assert.deepStrictEqual(result, [{ ssid: 'NETGEAR62', isConnected: true }]);
  assert.deepStrictEqual(spawnFake.calls[0].args,
    ['-t', '-f', 'IN-USE,SSID', 'device', 'wifi', 'list', '--rescan', 'yes']);
});

//Multiple networks and colon-escaping aren't covered by the single-network capture above, so these
//two lines are constructed - but from the two-column IN-USE:SSID shape the capture confirmed nmcli
//actually emits with -f pinned, not from a guessed field count the way the old fixture was.
test('wifiListNetworks parses multiple networks and marks only the connected one', async function(t){
  const platform = wrap(createNodeBacking({
    spawnProcess: fakeSpawn([{ chunks: [':Office\n*:HomeNet\n'] }])
  }));

  const result = await platform.wifiListNetworks();

  assert.deepStrictEqual(result, [
    { ssid: 'Office', isConnected: false },
    { ssid: 'HomeNet', isConnected: true }
  ]);
});

test('wifiListNetworks unescapes an SSID containing a literal colon and drops blank-ssid lines', async function(t){
  const platform = wrap(createNodeBacking({
    spawnProcess: fakeSpawn([{ chunks: ['*:Office\\:5G\n:\n\n'] }])
  }));

  const result = await platform.wifiListNetworks();

  assert.deepStrictEqual(result, [{ ssid: 'Office:5G', isConnected: true }]);
});

test('wifiListNetworks rejects UNAVAILABLE when nmcli is not installed', async function(t){
  const platform = wrap(createNodeBacking({
    spawnProcess: fakeSpawn([{ error: enoent('nmcli') }])
  }));

  const err = await rejection(platform.wifiListNetworks());
  assert.strictEqual(err.code, CODES.UNAVAILABLE);
});

test('wifiConnect spawns nmcli with ssid/psk as separate argv elements and resolves on success', async function(t){
  const spawnFake = fakeSpawn([{ code: 0 }]);
  const platform = wrap(createNodeBacking({ spawnProcess: spawnFake }));

  await platform.wifiConnect({ ssid: 'Office:5G', psk: 'p"a$s\'w`ord; rm -rf /' });

  assert.strictEqual(spawnFake.calls[0].command, 'nmcli');
  assert.deepStrictEqual(spawnFake.calls[0].args,
    ['device', 'wifi', 'connect', 'Office:5G', 'password', 'p"a$s\'w`ord; rm -rf /']);
  assert.ok(!spawnFake.calls[0].options || !spawnFake.calls[0].options.shell);
});

test('wifiConnect omits the password argument entirely when none is given', async function(t){
  const spawnFake = fakeSpawn([{ code: 0 }]);
  const platform = wrap(createNodeBacking({ spawnProcess: spawnFake }));

  await platform.wifiConnect({ ssid: 'OpenNetwork' });

  assert.deepStrictEqual(spawnFake.calls[0].args, ['device', 'wifi', 'connect', 'OpenNetwork']);
});

test('wifiConnect rejects IO_ERROR with nmcli\'s own output when the connection attempt fails', async function(t){
  const platform = wrap(createNodeBacking({
    spawnProcess: fakeSpawn([{ stderrChunks: ['Error: No network with SSID \'Office\' found.'], code: 1 }])
  }));

  const err = await rejection(platform.wifiConnect({ ssid: 'Office', psk: 'wrong' }));

  assert.strictEqual(err.code, CODES.IO_ERROR);
  assert.match(err.message, /No network with SSID/);
});

test('wifiConnect rejects UNAVAILABLE when nmcli is not installed', async function(t){
  const platform = wrap(createNodeBacking({ spawnProcess: fakeSpawn([{ error: enoent('nmcli') }]) }));

  const err = await rejection(platform.wifiConnect({ ssid: 'Office' }));
  assert.strictEqual(err.code, CODES.UNAVAILABLE);
});

test('wifiGetAddress resolves the first address reported by hostname -I', async function(t){
  const platform = wrap(createNodeBacking({
    spawnProcess: fakeSpawn([{ chunks: ['192.168.1.42 fe80::1\n'] }])
  }));

  assert.strictEqual(await platform.wifiGetAddress(), '192.168.1.42');
});

test('wifiGetAddress resolves an empty string rather than a sentinel when there is no output', async function(t){
  const platform = wrap(createNodeBacking({ spawnProcess: fakeSpawn([{ chunks: [] }]) }));

  assert.strictEqual(await platform.wifiGetAddress(), '');
});

test('wifiGetAddress rejects UNAVAILABLE when hostname is not installed', async function(t){
  const platform = wrap(createNodeBacking({ spawnProcess: fakeSpawn([{ error: enoent('hostname') }]) }));

  const err = await rejection(platform.wifiGetAddress());
  assert.strictEqual(err.code, CODES.UNAVAILABLE);
});

//wifiGetConnectionState/wifiGetStatus/wifiEnable/wifiDisable close the gap Phase 8 recorded rather
//than converted: wifi-manager.js had seven functions and only three had a command. These four
//never appeared in COMMANDS before now and used to spawn nmcli directly from wifi-manager.js -
//see the inventory's group K section. UNAVAILABLE off a missing nmcli is asserted as the ordinary
//case throughout, matching every other wifi/battery command in this group.

//Real `nmcli -t -f DEVICE,TYPE,STATE,CONNECTION device status` output, captured 2026-09-07 from the
//same Raspberry Pi as the wifiListNetworks fixture above, while connected to wifi. Unlike
//wifiListNetworks, this command's default column order was already the one this code assumed
//(DEVICE:TYPE:STATE:CONNECTION, no colon-bearing values), so there was no field-index bug to fix
//here - but the fixture is captured anyway rather than hand-typed, on the same "don't trust an
//unchecked belief about nmcli's output" reasoning, and -f is now pinned explicitly too. This
//capture also exercises a real multi-device machine: it finds the `wifi`-typed line among a
//`wifi-p2p`, an `ethernet` and a `loopback` device, and two of those lines have an empty
//CONNECTION field (a trailing, un-escaped colon with nothing after it).
test('wifiGetConnectionState reports real nmcli output (captured on a Raspberry Pi, connected)', async function(t){
  const spawnFake = fakeSpawn([{ chunks: [
    'wlan0:wifi:connected:NETGEAR62\n' +
    'p2p-dev-wlan0:wifi-p2p:disconnected:\n' +
    'eth0:ethernet:unavailable:\n' +
    'lo:loopback:unmanaged:\n'
  ] }]);
  const platform = wrap(createNodeBacking({ spawnProcess: spawnFake }));

  const result = await platform.wifiGetConnectionState();

  assert.deepStrictEqual(result, { state: 'connected', connection: 'NETGEAR62' });
  assert.deepStrictEqual(spawnFake.calls[0].args,
    ['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device', 'status']);
});

//The no-wifi-device case is the captured fixture above with its wlan0 line removed, rather than an
//invented device list - the other three lines are the real, unmodified capture.
test('wifiGetConnectionState resolves unknown/null instead of throwing when no wifi device is present', async function(t){
  const platform = wrap(createNodeBacking({
    spawnProcess: fakeSpawn([{ chunks: [
      'p2p-dev-wlan0:wifi-p2p:disconnected:\n' +
      'eth0:ethernet:unavailable:\n' +
      'lo:loopback:unmanaged:\n'
    ] }])
  }));

  const result = await platform.wifiGetConnectionState();

  assert.deepStrictEqual(result, { state: 'unknown', connection: null });
});

test('wifiGetConnectionState unescapes a connection name containing a literal colon', async function(t){
  const platform = wrap(createNodeBacking({
    spawnProcess: fakeSpawn([{ chunks: ['wlan0:wifi:connected:My\\:Home\n'] }])
  }));

  const result = await platform.wifiGetConnectionState();

  assert.deepStrictEqual(result, { state: 'connected', connection: 'My:Home' });
});

test('wifiGetConnectionState rejects UNAVAILABLE when nmcli is not installed', async function(t){
  const platform = wrap(createNodeBacking({ spawnProcess: fakeSpawn([{ error: enoent('nmcli') }]) }));

  const err = await rejection(platform.wifiGetConnectionState());
  assert.strictEqual(err.code, CODES.UNAVAILABLE);
});

test('wifiGetStatus resolves the trimmed radio state', async function(t){
  const spawnFake = fakeSpawn([{ chunks: ['enabled\n'] }]);
  const platform = wrap(createNodeBacking({ spawnProcess: spawnFake }));

  assert.strictEqual(await platform.wifiGetStatus(), 'enabled');
  assert.deepStrictEqual(spawnFake.calls[0].args, ['radio', 'wifi']);
});

test('wifiGetStatus rejects UNAVAILABLE when nmcli is not installed', async function(t){
  const platform = wrap(createNodeBacking({ spawnProcess: fakeSpawn([{ error: enoent('nmcli') }]) }));

  const err = await rejection(platform.wifiGetStatus());
  assert.strictEqual(err.code, CODES.UNAVAILABLE);
});

test('wifiEnable spawns "nmcli radio wifi on" and resolves on success', async function(t){
  const spawnFake = fakeSpawn([{ code: 0 }]);
  const platform = wrap(createNodeBacking({ spawnProcess: spawnFake }));

  await platform.wifiEnable();

  assert.strictEqual(spawnFake.calls[0].command, 'nmcli');
  assert.deepStrictEqual(spawnFake.calls[0].args, ['radio', 'wifi', 'on']);
});

test('wifiDisable spawns "nmcli radio wifi off" and resolves on success', async function(t){
  const spawnFake = fakeSpawn([{ code: 0 }]);
  const platform = wrap(createNodeBacking({ spawnProcess: spawnFake }));

  await platform.wifiDisable();

  assert.deepStrictEqual(spawnFake.calls[0].args, ['radio', 'wifi', 'off']);
});

test('wifiEnable rejects IO_ERROR with nmcli\'s own output when the radio command fails', async function(t){
  const platform = wrap(createNodeBacking({
    spawnProcess: fakeSpawn([{ stderrChunks: ['nmcli: radio control unavailable'], code: 1 }])
  }));

  const err = await rejection(platform.wifiEnable());

  assert.strictEqual(err.code, CODES.IO_ERROR);
  assert.match(err.message, /radio control unavailable/);
});

test('wifiDisable rejects IO_ERROR with nmcli\'s own output when the radio command fails', async function(t){
  const platform = wrap(createNodeBacking({
    spawnProcess: fakeSpawn([{ stderrChunks: ['nmcli: radio control unavailable'], code: 1 }])
  }));

  const err = await rejection(platform.wifiDisable());

  assert.strictEqual(err.code, CODES.IO_ERROR);
  assert.match(err.message, /radio control unavailable/);
});

test('wifiEnable rejects UNAVAILABLE when nmcli is not installed', async function(t){
  const platform = wrap(createNodeBacking({ spawnProcess: fakeSpawn([{ error: enoent('nmcli') }]) }));

  const err = await rejection(platform.wifiEnable());
  assert.strictEqual(err.code, CODES.UNAVAILABLE);
});

test('wifiDisable rejects UNAVAILABLE when nmcli is not installed', async function(t){
  const platform = wrap(createNodeBacking({ spawnProcess: fakeSpawn([{ error: enoent('nmcli') }]) }));

  const err = await rejection(platform.wifiDisable());
  assert.strictEqual(err.code, CODES.UNAVAILABLE);
});

test('getBatteryCapacity resolves the capacity reported by the kernel for a real battery', async function(t){
  patchPowerSupplyDir(t, ['AC', 'BAT0']);
  const platform = wrap(createNodeBacking({ spawnProcess: fakeSpawn([{ chunks: ['87\n'] }]) }));

  assert.strictEqual(await platform.getBatteryCapacity(), 87);
});

test('getBatteryCapacity rejects UNAVAILABLE, the everyday case, when there is no power_supply directory at all', async function(t){
  patchPowerSupplyDir(t, function(){
    const err = new Error('ENOENT: no such file or directory');
    err.code = 'ENOENT';
    throw err;
  });
  const platform = wrap(createNodeBacking({}));

  const err = await rejection(platform.getBatteryCapacity());
  assert.strictEqual(err.code, CODES.UNAVAILABLE);
});

test('getBatteryCapacity rejects UNAVAILABLE when the directory exists but nothing starts with BAT', async function(t){
  patchPowerSupplyDir(t, ['AC']);
  const platform = wrap(createNodeBacking({}));

  const err = await rejection(platform.getBatteryCapacity());
  assert.strictEqual(err.code, CODES.UNAVAILABLE);
});

//Distinct from "no battery" above: a battery is genuinely present here, so a read that fails is a
//real problem (IO_ERROR), not the everyday result CODES.UNAVAILABLE exists for.
test('getBatteryCapacity rejects IO_ERROR when a battery exists but the kernel read fails to spawn', async function(t){
  patchPowerSupplyDir(t, ['BAT0']);
  const platform = wrap(createNodeBacking({ spawnProcess: fakeSpawn([{ error: new Error('spawn cat ENOENT') }]) }));

  const err = await rejection(platform.getBatteryCapacity());
  assert.strictEqual(err.code, CODES.IO_ERROR);
});

test('getBatteryCapacity rejects IO_ERROR when the kernel read produces non-numeric output', async function(t){
  patchPowerSupplyDir(t, ['BAT0']);
  const platform = wrap(createNodeBacking({
    spawnProcess: fakeSpawn([{ stderrChunks: ['cat: permission denied'], chunks: [] }])
  }));

  const err = await rejection(platform.getBatteryCapacity());
  assert.strictEqual(err.code, CODES.IO_ERROR);
});

test('the network/hardware commands refuse arguments they cannot act on', async function(t){
  const platform = wrap(createNodeBacking({ spawnProcess: fakeSpawn([]) }));

  assert.strictEqual((await rejection(platform.installUpdate({}))).code, CODES.INVALID_ARGUMENT);
  assert.strictEqual((await rejection(platform.installUpdate({ path: '/tmp/x' }))).code, CODES.INVALID_ARGUMENT);
  assert.strictEqual((await rejection(platform.downloadUpdate({}))).code, CODES.INVALID_ARGUMENT);
  assert.strictEqual((await rejection(platform.wifiConnect({}))).code, CODES.INVALID_ARGUMENT);
});

// ---------------------------------------------------------------------------------------------
// What groups B and C give up
// ---------------------------------------------------------------------------------------------

//The point of converting these two, beyond the Tauri port: the models stop being able to reach the
//filesystem at all. Anything they need has to be a declared command, which is what makes "the
//renderer cannot write an arbitrary path" checkable rather than a convention. Phase 9 turns this
//from a property into a build error; until then, this is what holds it.
testOnce('the project and chapter models no longer require anything native', function(){
  ['models/project.js', 'models/chapter.js'].forEach(function(relative){
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'components', relative.split('/')[0], relative.split('/')[1]), 'utf8');

    ['fs', 'path', 'os', 'crypto', 'child_process', 'electron'].forEach(function(builtin){
      assert.strictEqual(source.indexOf("require('" + builtin + "')"), -1,
        relative + ' still requires ' + builtin);
    });
  });
});

//The layout of a chapter on disk - the extension, the notes prefix, the stash name used during a
//save - belongs to the native side now. A renderer that still spelled any of it out would be
//deciding filenames the command is supposed to hand back.
testOnce('the chapter model no longer spells out how a chapter is laid out on disk', function(){
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'models', 'chapter.js'), 'utf8');

  [NOTES_PREPEND, OLD_VERSION_FLAG, "'.txt'"].forEach(function(literal){
    assert.strictEqual(source.indexOf(literal), -1,
      'chapter.js still knows about ' + literal);
  });
});

});
