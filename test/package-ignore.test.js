const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

//What `npm run package` leaves out of the app, checked against what the app needs.
//
//packagerConfig.ignore in package.json is a list of regular expressions matched against every
//path under the repository root, written with a leading slash ("/src/index.js"), and a match means
//the file does not ship. Until this existed the list held one entry, for test/, and the Windows
//package carried the developer's own error log, the docs/ plans, both source maps, the unbundled
//render.js, and a megabyte of renderer-only modules and legacy fixtures nothing in the package
//could ever load. Nothing noticed because nothing looked.
//
//Two things are asserted. The list of files below is the obvious half: named dev files are out,
//named runtime files are in. The require walk is the half that matters: the main process runs from
//source (src/index.js and everything it requires, not a bundle), so a module it reaches has to
//ship, and a later change that makes index.js require something from views/ - which this list
//excludes - would otherwise fail only in the packaged app, on the first launch after release.

const REPO_ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const ignore = pkg.config.forge.packagerConfig.ignore.map(function(pattern){ return new RegExp(pattern); });

function isIgnored(appRelativePath){
  return ignore.some(function(regex){ return regex.test(appRelativePath); });
}

//The shape @electron/packager hands its filter: the path relative to the app directory, with a
//leading slash and forward slashes regardless of platform.
function appPath(absolute){
  return '/' + path.relative(REPO_ROOT, absolute).split(path.sep).join('/');
}

const DEV_ONLY = [
  '/test/platform.test.js',
  '/test/driven/drive.js',
  '/docs/upgrade-and-isolation-plan.md',
  '/.github/workflows/release.yml',
  '/.gitignore',
  '/README.md',
  '/error_log.txt',
  '/user-settings.json',
  '/src/render.js',
  '/src/preload.js',
  '/src/render.bundle.js.map',
  '/src/preload.bundle.js.map',
  '/node_modules/quill/dist/quill.js.map',
  '/src/components/views/about_display.js',
  '/src/components/blots/footnotes.js',
  '/src/assets/screenshot_darkmode.png',
  '/src/assets/screenshot_lightmode.png',
  '/src/assets/screenshot_corkboard.png',
  '/src/assets/warewoolf_logo_small.png',
  '/src/assets/icon.ico',
  '/src/assets/icon.icns',
  '/src/examples/Frankenstein_Legacy_v1.1/Frankenstein.woolf',
  '/src/examples/Frankenstein_Legacy_v2.1/Frankenstein.woolf',
  '/src/examples/markdownfic.mdfc'
];

const RUNTIME = [
  '/package.json',
  '/LICENSE',
  '/src/index.js',
  '/src/index.html',
  '/src/render.bundle.js',
  '/src/preload.bundle.js',
  '/src/licenses.txt',
  '/src/plist/Info.plist',
  '/src/css/index.css',
  '/src/css/quill.core.css',
  '/src/assets/icon.png',
  '/src/assets/logo.png',
  '/src/assets/warewoolf_at_work.png',
  '/src/dictionaries/en_US-large.dic',
  '/src/dictionaries/en_US-large.aff',
  '/src/examples/Frankenstein/Frankenstein.woolf',
  '/src/examples/Frankenstein/Frankenstein_chapters/Chapter 1.txt',
  '/src/examples/HelpDoc/HelpDoc.woolf',
  '/src/components/controllers/platform-node.js',
  '/src/components/models/credential-store.js',
  '/node_modules/quill/dist/quill.js',
  '/node_modules/nodemailer/package.json'
];

test('the package leaves every development-only file out', function(){
  DEV_ONLY.forEach(function(p){
    assert.ok(isIgnored(p), p + ' should not ship in the packaged app');
  });
});

test('the package keeps every file the app reads at runtime', function(){
  RUNTIME.forEach(function(p){
    assert.ok(!isIgnored(p), p + ' is needed at runtime and must ship');
  });
});

//Every module reachable from src/index.js by a relative require, found by reading the source rather
//than by loading it - index.js requires 'electron' on its first line, so it cannot be loaded here.
//Follows require('./x') and require('../x') only; a bare specifier is a dependency in node_modules,
//which the packager prunes by package.json's own dependencies list rather than by this ignore list.
function relativeRequires(file){
  const source = fs.readFileSync(file, 'utf8');
  const found = [];
  const pattern = /require\((['"])(\.{1,2}\/[^'"]+)\1\)/g;
  let match;

  while((match = pattern.exec(source)) !== null)
    found.push(match[2]);

  return found;
}

function mainProcessModules(){
  const seen = new Set();
  const queue = [path.join(REPO_ROOT, 'src', 'index.js')];

  while(queue.length > 0){
    const file = queue.shift();
    if(seen.has(file))
      continue;
    seen.add(file);

    relativeRequires(file).forEach(function(spec){
      const resolved = require.resolve(path.resolve(path.dirname(file), spec));
      queue.push(resolved);
    });
  }

  return Array.from(seen);
}

test('every module the main process requires from source ships in the package', function(){
  const modules = mainProcessModules();

  //A sanity floor: the walk found the backing and its contract, not just index.js on its own.
  assert.ok(modules.some(function(m){ return m.endsWith('platform-node.js'); }),
    'the require walk should reach platform-node.js from index.js');

  modules.forEach(function(m){
    assert.ok(!isIgnored(appPath(m)), appPath(m) + ' is required by the main process and must ship');
  });
});
