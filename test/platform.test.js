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
//The one guard standing between Phase 9 and a menu that silently stops working. EVENTS holds the
//literal channel names index.js sends on - the ipc backing passes them straight to
//ipcRenderer.on() - so a name that drifts from the main process subscribes to a channel nothing
//sends, with no error anywhere. Phase 1 shipped exactly that mistake in one of the 36 entries.
test('every event name matches a channel the main process actually sends', function(){
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
  const sent = new Set(Array.from(main.matchAll(/webContents\.send\(['"]([^'"]+)['"]/g),
    function(match){ return match[1]; }));

  assert.deepStrictEqual(EVENTS.filter(function(event){ return !sent.has(event); }), [],
    'declared events the main process never sends');
  assert.deepStrictEqual(Array.from(sent).filter(function(channel){ return EVENTS.indexOf(channel) === -1; }), [],
    'channels the main process sends that EVENTS does not declare');
});

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

// ---------------------------------------------------------------------------------------------
// What groups B and C give up
// ---------------------------------------------------------------------------------------------

//The point of converting these two, beyond the Tauri port: the models stop being able to reach the
//filesystem at all. Anything they need has to be a declared command, which is what makes "the
//renderer cannot write an arbitrary path" checkable rather than a convention. Phase 9 turns this
//from a property into a build error; until then, this is what holds it.
test('the project and chapter models no longer require anything native', function(){
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
test('the chapter model no longer spells out how a chapter is laid out on disk', function(){
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'models', 'chapter.js'), 'utf8');

  [NOTES_PREPEND, OLD_VERSION_FLAG, "'.txt'"].forEach(function(literal){
    assert.strictEqual(source.indexOf(literal), -1,
      'chapter.js still knows about ' + literal);
  });
});
