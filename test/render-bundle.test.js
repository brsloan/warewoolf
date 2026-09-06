//Every other test in this suite exercises the source tree - src/render.js and src/components/*.
//Since Phase 0 the app does not load any of that: index.html loads src/render.bundle.js, built by
//`npm run build:renderer`. Those are two different artifacts, and deleting the bundle outright
//leaves the rest of the suite entirely green, so nothing else here would notice esbuild failing to
//resolve a module, a build step regressing, or the bundle simply never being built. This file is
//the only thing standing between a green suite and an app that cannot start.
//
//`pretest` builds the bundle, so it is always present and current when these run.

//Quill touches document/Node/MutationObserver at require-time, so the DOM has to exist before the
//bundle (which has Quill inlined into it) is required - same reasoning as render.test.js.
require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { builtinModules } = require('node:module');

const bundlePath = path.resolve(__dirname, '../src/render.bundle.js');

//Mirrors index.html's body, exactly as render.test.js does: the bundle runs its initialize() at
//require-time and reaches for these ids synchronously.
function bodyShell(){
  return '<div id="chapter-list-sidebar" class="sidebar" tabindex="-1">' +
      '<h1 id="chapters-header">Chapters</h1>' +
      '<ul id="chapter-list"></ul>' +
      '<h1 id="reference-header">Reference</h1>' +
      '<ul id="reference-list"></ul>' +
      "<h1 id='trash-header'>Trash</h1>" +
      '<ul id="trash-list"></ul>' +
    '</div>' +
    '<div id="writing-field" class="writing-field-standard-view">' +
      '<div id="editor-container"></div>' +
    '</div>' +
    '<div id="project-notes" class="sidebar">' +
      '<h1 id="notes-header">Project Notes</h1>' +
      '<div id="notes-editor"></div>' +
    '</div>';
}

//None of these paths exist, so loadInitialProject() falls through to createNewProject() and leaves
//a blank project behind a popup - the same blank slate render.test.js relies on. userData and docs
//are real, since user-settings.js and the file dialogs read them for real.
//getAppPaths/getFileRequestedOnOpen/etc. (platform.js's group A) now cross through
//ipcRenderer.invoke() rather than sendSync/send - see platform-ipc.js.
function fakeElectron(){
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-bundle-ud-'));
  const docsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-bundle-docs-'));
  return {
    ipcRenderer: {
      sendSync: function(channel){
        if(channel === 'secure-storage-available')
          return false;
        return undefined;
      },
      invoke: function(channel){
        if(channel === 'getAppPaths')
          return Promise.resolve({ app: '/no-such-app-dir', userData: userDataDir, docs: docsDir,
                   home: '/no-such-home-dir', temp: os.tmpdir(), downloads: '/no-such-downloads' });
        if(channel === 'getFileRequestedOnOpen')
          return Promise.resolve(null);
        if(channel === 'getPlatform')
          return Promise.resolve({ platform: process.platform, arch: process.arch });
        return Promise.resolve(undefined);
      },
      send: function(){},
      on: function(){},
      removeListener: function(){}
    }
  };
}

async function loadBundle(){
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true, exports: fakeElectron()
  };
  delete require.cache[bundlePath];
  document.body.innerHTML = bodyShell();
  const mod = require(bundlePath);
  await mod.ready;
  Array.from(document.querySelectorAll('.popup')).forEach(function(p){ p.remove(); });
  return mod;
}

test('the renderer bundle exists', function(){
  assert.ok(fs.existsSync(bundlePath),
    'src/render.bundle.js is missing - run `npm run build:renderer` (pretest should have)');
});

//The load itself is the assertion: the bundle runs initialize() at require-time, which walks
//almost the whole module graph. Anything esbuild mangled surfaces here as a throw.
test('the renderer bundle loads and runs its startup path', async function(){
  const mod = await loadBundle();

  assert.ok(mod, 'the bundle should export the renderer API');
  if(mod._unregisterKeybindings)
    mod._unregisterKeybindings();
});

//Proves the graph actually executed end to end rather than merely parsing: both Quill instances
//are constructed near the end of startup, against DOM nodes that only exist here.
test('the renderer bundle mounts both editors', async function(){
  const mod = await loadBundle();

  assert.ok(document.querySelector('#editor-container .ql-editor'),
    'the main editor should be mounted');
  assert.ok(document.querySelector('#notes-editor .ql-editor'),
    'the notes editor should be mounted');
  if(mod._unregisterKeybindings)
    mod._unregisterKeybindings();
});

//index.html loads the bundle with a plain <script> tag, so anything the app reaches for has to be
//on the exported object. A bundling change that dropped exports would leave the menu wired to
//nothing, with every other test still green.
test('the renderer bundle exports the API the app drives it through', async function(){
  const mod = await loadBundle();

  ['project', 'userSettings', 'editorQuill', 'notesQuill', 'updateFileList',
   'displayChapterByIndex', 'addNewChapter'].forEach(function(key){
    assert.ok(key in mod, 'the bundle should export ' + key);
  });
  if(mod._unregisterKeybindings)
    mod._unregisterKeybindings();
});

//The actual point of Phase 0. contextIsolation cannot be turned on while the renderer resolves its
//own 71-module graph through require() at runtime, so the graph has to be inlined - not merely
//concatenated alongside. A relative require surviving in the output means some module was left to
//resolve at runtime and the flag flip would break on it.
test('the renderer bundle resolves its own module graph at build time, not runtime', function(){
  const bundle = fs.readFileSync(bundlePath, 'utf8');

  const relativeRequires = bundle.match(/require\(["']\.\.?\//g) || [];

  assert.deepStrictEqual(relativeRequires, [],
    'the bundle still requires local modules at runtime, which contextIsolation would break');
});

//Only Node builtins and electron may remain external. Anything else means a dependency escaped
//bundling and would have to be resolved from node_modules at runtime - which a packaged,
//context-isolated renderer cannot do.
test('the renderer bundle leaves only Node builtins and electron external', function(){
  const bundle = fs.readFileSync(bundlePath, 'utf8');
  const builtins = new Set(builtinModules);

  const externals = new Set();
  const pattern = /require\(["']([^"')]+)["']\)/g;
  var match;
  while((match = pattern.exec(bundle)) !== null)
    externals.add(match[1]);

  const unexpected = Array.from(externals).filter(function(name){
    return name !== 'electron' && !builtins.has(name.replace(/^node:/, ''));
  });

  assert.deepStrictEqual(unexpected, [],
    'these were left to resolve from node_modules at runtime: ' + unexpected.join(', '));
});
