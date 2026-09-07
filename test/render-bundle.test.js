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
const vm = require('vm');

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
//
//(Phase 9b) This used to also patch require.cache for 'electron', because the bundle subscribed to
//the menu channels on ipcRenderer directly. It does not any more, and build:renderer no longer
//passes --external:electron - so a bundle that reached for electron would now fail the build rather
//than need a fake here. What the renderer gets is exactly what preload.js publishes: invoke/on/off.
function fakeBridge(){
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-bundle-ud-'));
  const docsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-bundle-docs-'));
  return {
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
    on: function(){},
    off: function(){}
  };
}

//(Phase 9b) The bundle is *evaluated*, not require()d, and that is the point of the change rather
//than a detail of it. index.html loads it with a plain <script> tag (index.html:35); it was being
//tested through require(), which is the one way the app never loads it. That gap is exactly where
//the flip could have shipped broken with the suite green: while nodeIntegration was on, esbuild's
//CJS output left a bare top-level `module.exports.ready = ...` in the bundle and the page happened
//to have a `module` for it. A context-isolated page has no `module`, so the very first statement of
//the renderer would have thrown ReferenceError - and require() here would have gone on passing,
//because under require() `module` is real.
//
//So build:renderer emits an IIFE assigned to a --global-name, and this runs the file the way a
//<script> does: runInThisContext, top-level `var` landing on the global object, exports read off
//that global. Nothing here supplies `module`, which is the assertion.
async function loadBundle(){
  globalThis.warewoolf = fakeBridge();
  delete globalThis.warewoolfRenderer;
  document.body.innerHTML = bodyShell();

  vm.runInThisContext(fs.readFileSync(bundlePath, 'utf8'), { filename: bundlePath });

  const mod = globalThis.warewoolfRenderer;
  assert.ok(mod, 'the bundle should publish its API on the global name index.html loads it under');
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

//(Phase 9b) This replaced two tests, and the replacement is the point of the phase rather than a
//tidy-up of it.
//
//The first was "the renderer bundle leaves only Node builtins and electron external". That was the
//right rule while the renderer did its own filesystem work, and it is exactly the wrong rule now:
//it would have gone on passing after the flip while asserting the opposite of what the flip is for,
//and would have quietly stopped testing anything at all. The second was 9a's countdown, pinning the
//exact pair (`fs`, `path`) that was left to remove. The countdown reached zero, so it becomes this
//rather than being left asserting an empty array by coincidence.
//
//`--platform=browser` in build:renderer is the other half of this net and catches a different
//thing: an import-shaped survivor fails there at build time. It does not catch a *bare global* -
//`process.platform`, `__dirname`, `process.cwd()` - which is not an import and compiles through
//verbatim. Neither does this test. Those are audited by grep over the source and caught by the
//packaged build; a clean build and a green assertion here are not proof the renderer is Node-free.
test('the renderer bundle leaves nothing external at all', function(){
  const bundle = fs.readFileSync(bundlePath, 'utf8');

  const externals = new Set();
  const pattern = /require\(["']([^"')]+)["']\)/g;
  var match;
  while((match = pattern.exec(bundle)) !== null)
    externals.add(match[1].replace(/^node:/, ''));

  assert.deepStrictEqual(Array.from(externals).sort(), [],
    'a context-isolated renderer can resolve nothing at runtime - not a Node builtin, not electron, '
      + 'not a node_modules package. These were left external: '
      + Array.from(externals).sort().join(', '));
});

//The flip's own assertion, and the only one in the suite that reads the flags rather than their
//consequences. index.js requires 'electron' on its first line, so nothing here can load it; it is
//read as text, the same way preload.test.js compile-checks it.
//
//`sandbox` is asserted explicitly because leaving it out would NOT have left it alone. Electron's
//default has been `sandbox: true` since v20, disabled automatically only while
//`nodeIntegration: true` is set - so removing nodeIntegration turns the OS-level sandbox on as a
//side effect. Phase 9b is one variable, so it is pinned to false here and evaluated on its own
//evidence separately. If that evaluation later turns it on, this test is where that decision
//becomes visible rather than something inherited from a default.
//Comments are stripped first, and not as tidiness: index.js explains at length *why* nodeIntegration
//is gone, and the words "nodeIntegration: true" appear in that explanation. Matching raw source
//would fail on the comment that documents the fix.
function sourceWithoutComments(file){
  return fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ 	]*\/\/.*$/gm, '');
}

test('index.js configures the renderer as context-isolated with no node integration', function(){
  const indexSource = sourceWithoutComments(path.join(__dirname, '..', 'src', 'index.js'));

  assert.match(indexSource, /contextIsolation:\s*true/,
    'contextIsolation must be true - the whole of Part 2 is in service of this line');
  assert.doesNotMatch(indexSource, /nodeIntegration:\s*true/,
    'nodeIntegration must not be re-enabled');
  assert.match(indexSource, /sandbox:\s*(true|false)/,
    'sandbox must be set explicitly, not inherited from an Electron default that changes with '
      + 'nodeIntegration');
  assert.match(indexSource, /preload:/,
    'the renderer reaches the main process only through the preload bridge');
});

//The build flag that makes the assertion above enforceable rather than aspirational. With
//--platform=node, esbuild marks every Node builtin external and the bundle silently keeps a
//require() the page cannot answer; with --platform=browser the same import is a build error.
test('build:renderer targets the browser, so a surviving builtin import fails the build', function(){
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

  assert.match(pkg.scripts['build:renderer'], /--platform=browser/,
    'build:renderer must target the browser - --platform=node would let a Node builtin import '
      + 'through as an external require() that a context-isolated renderer cannot resolve');
});

//The preload bundle is the other half, and it has to be clean already: it is the file that keeps
//working when `sandbox` stops being false, and a sandboxed preload gets no Node builtins at all.
//Only 'electron' may remain, which the sandbox does still provide.
test('the preload bundle leaves nothing but electron external', function(){
  const preloadBundlePath = path.join(__dirname, '..', 'src', 'preload.bundle.js');
  assert.ok(fs.existsSync(preloadBundlePath),
    'src/preload.bundle.js is missing - run `npm run build` (pretest should have)');

  const bundle = fs.readFileSync(preloadBundlePath, 'utf8');

  const externals = new Set();
  const pattern = /require\(["']([^"')]+)["']\)/g;
  var match;
  while((match = pattern.exec(bundle)) !== null)
    externals.add(match[1].replace(/^node:/, ''));

  assert.deepStrictEqual(Array.from(externals).sort(), ['electron']);
});
