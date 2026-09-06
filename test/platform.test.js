const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('node:os');
const path = require('node:path');
const nodeCrypto = require('node:crypto');

const {
  createPlatform, COMMANDS, EVENTS, CODES, PlatformError, SAVED_SECRET
} = require('../src/components/controllers/platform');
const { createNodeBacking, NOTES_PREPEND, OLD_VERSION_FLAG } = require('../src/components/controllers/platform-node');

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

function platformIn(t, options){
  const built = backingIn(t, options);
  return { dir: built.dir, backing: built.backing, platform: createPlatform(built.backing) };
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

test('a declared command the backing does not implement rejects with NOT_IMPLEMENTED', async function(t){
  const platform = platformIn(t).platform;
  const err = await rejection(platform.buildEpub({ filepath: 'x', htmlChapters: [], meta: {} }));

  assert.strictEqual(err.code, CODES.NOT_IMPLEMENTED);
  assert.strictEqual(err.command, 'buildEpub');
  //Names the group so an unconverted call site says which phase still owes it.
  assert.match(err.message, /group G/);
});

//A caller must never have to both try/catch and .catch() the same command, so a backing that fails
//before it ever returns a promise still comes back as a rejection.
test('a backing that throws synchronously still rejects', async function(){
  const platform = createPlatform({
    logError: function(){ throw new Error('boom'); },
    on: function(){}, off: function(){}
  });

  const err = await rejection(platform.logError({ text: 'x' }));

  assert.strictEqual(err.isPlatformError, true);
  assert.strictEqual(err.code, CODES.IO_ERROR);
  assert.strictEqual(err.command, 'logError');
});

test('errno codes become stable contract codes', async function(){
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
test('an error that is already a PlatformError passes through unchanged', async function(){
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

test('every group in the inventory is represented', function(){
  const groups = {};
  Object.keys(COMMANDS).forEach(function(name){
    groups[COMMANDS[name].group] = true;
  });

  assert.deepStrictEqual(Object.keys(groups).sort(),
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']);
});

//All 36 main -> renderer channels, not just the file-open one the inventory names. A typo has to
//fail here rather than becoming a menu item that quietly does nothing.
test('events are validated by name and unsubscribe cleanly', function(t){
  const built = platformIn(t);
  const seen = [];
  const handler = function(){ seen.push(1); };

  assert.strictEqual(EVENTS.length, 36);
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
test('the contract file itself reaches for nothing native', function(){
  const contract = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'controllers', 'platform.js'), 'utf8');

  assert.strictEqual(contract.indexOf('require('), -1);
});

test('createPlatform refuses to wrap nothing', function(){
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
  const platform = createPlatform(createNodeBacking({
    paths: { userData: '/u', home: '/h', temp: '/t', docs: '/d', app: '/a', downloads: '/dl',
      somethingElseEntirely: 'should not leak' }
  }));

  const paths = await platform.getAppPaths();

  assert.deepStrictEqual(paths, {
    userData: '/u', home: '/h', temp: '/t', docs: '/d', app: '/a', downloads: '/dl'
  });
});

test('getPlatform reports this process\'s own platform and arch', async function(){
  const platform = createPlatform(createNodeBacking({}));

  assert.deepStrictEqual(await platform.getPlatform(), { platform: process.platform, arch: process.arch });
});

test('getFileRequestedOnOpen returns whatever the backing was constructed with, or null', async function(){
  const withOne = createPlatform(createNodeBacking({ fileRequestedOnOpen: '/opened/via/argv.woolf' }));
  const withNone = createPlatform(createNodeBacking({}));

  assert.strictEqual(await withOne.getFileRequestedOnOpen(), '/opened/via/argv.woolf');
  assert.strictEqual(await withNone.getFileRequestedOnOpen(), null);
});

//setTheme/showAppMenu/confirmExit/notifyRendererReady have no return value - what a backing does
//with them is entirely the injected hook's business, which is exactly what these assert.
test('setTheme, showAppMenu, confirmExit, and notifyRendererReady call their injected hooks', async function(){
  const seen = { mode: undefined, menu: 0, exit: 0, ready: 0 };
  const platform = createPlatform(createNodeBacking({
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
  const platform = createPlatform(createNodeBacking({}));

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

  assert.deepStrictEqual(result, { migrated: true });
  assert.strictEqual((await built.platform.describeCredential({ service: 'email' })).backend, 'keyfile');
  assert.strictEqual(built.backing.resolveSecret({ service: 'email' }), 'old-saved-password');

  const onDisk = fs.readFileSync(path.join(built.dir, 'credentials.json'), 'utf8');
  assert.strictEqual(onDisk.indexOf('old-saved-password'), -1);
});

test('anything that is not a legacy blob is left alone', async function(t){
  const built = platformIn(t);

  for(const blob of [null, undefined, {}, { v: 2, iv: 'aa', tag: 'bb', content: 'cc' }]){
    const result = await built.platform.migrateLegacyCredential({ service: 'email', legacyBlob: blob });
    assert.deepStrictEqual(result, { migrated: false });
  }

  assert.strictEqual((await built.platform.describeCredential({ service: 'email' })).hasPassword, false);
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
