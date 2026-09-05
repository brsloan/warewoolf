const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const aboutDisplayPath = require.resolve('../src/components/views/about_display');
const updatesControllerPath = require.resolve('../src/components/controllers/updates');
const installUpdateDisplayPath = require.resolve('../src/components/views/install-update_display');

//about_display.js destructures getUpdates/downloadUpdate from the updates controller and requires
//install-update_display directly, both at require-time, so these mocks only take effect if the
//cache is primed before about_display.js is (re-)required - same pattern as
//install-update_display.test.js's freshInstallUpdateDisplay().
//fs.existsSync/readFileSync are used as `fs.existsSync(...)` (never destructured), so those are
//mocked directly on the shared fs module object with t.mock.method, as in missing-pups_display.test.js.
function freshAboutDisplay(mocks){
  delete require.cache[aboutDisplayPath];
  require.cache[updatesControllerPath] = {
    id: updatesControllerPath,
    filename: updatesControllerPath,
    loaded: true,
    exports: {
      getUpdates: mocks.getUpdates || function(){},
      downloadUpdate: mocks.downloadUpdate || function(){}
    }
  };
  require.cache[installUpdateDisplayPath] = {
    id: installUpdateDisplayPath,
    filename: installUpdateDisplayPath,
    loaded: true,
    exports: mocks.showInstallUpdate || function(){}
  };
  return require(aboutDisplayPath);
}

//closePopups() also calls disableSearchView()/focusEditor(), which reach for this fixed shell by
//id - same shell used in install-update_display.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div><div id="project-notes"></div><div id="writing-field"></div>';
}

//process.platform is read at click-time by about_display.js (not captured at require time), so
//overriding the real property for the duration of a test is enough - no fresh require needed,
//same pattern as updates.test.js's withPlatform().
function withPlatform(t, platform){
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  t.after(function(){
    Object.defineProperty(process, 'platform', origPlatform);
  });
}

function findButton(text){
  return Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent === text; });
}

function sysDirs(){
  return { app: '/app', temp: '/tmp', downloads: '/downloads' };
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[aboutDisplayPath];
  delete require.cache[updatesControllerPath];
  delete require.cache[installUpdateDisplayPath];
  delete global.window;
  delete global.document;
});

test('renders the app version, WareWoolf.org link, and description, and focuses Close', function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var showAbout = freshAboutDisplay({});

  showAbout(sysDirs(), '2.3.1');

  assert.strictEqual(document.querySelector('.about-version').innerText, '2.3.1');
  assert.strictEqual(document.querySelector('.about-url').innerText, 'WareWoolf.org');
  assert.match(document.querySelector('.popup p').innerText, /open source software/);
  assert.strictEqual(document.activeElement, findButton('Close'));
});

test('Close removes the popup', function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var showAbout = freshAboutDisplay({});

  showAbout(sysDirs(), '2.3.1');
  findButton('Close').onclick();

  assert.strictEqual(document.getElementsByClassName('popup').length, 0);
});

test('Check For Updates disables the button and calls getUpdates with the current app version', function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var getUpdatesCalls = [];
  var showAbout = freshAboutDisplay({
    getUpdates: function(version, cb){ getUpdatesCalls.push(version); }
  });

  showAbout(sysDirs(), '2.3.1');
  var checkBtn = findButton('Check For Updates');
  checkBtn.onclick();

  assert.deepStrictEqual(getUpdatesCalls, ['2.3.1']);
  assert.strictEqual(checkBtn.disabled, true);
  assert.strictEqual(checkBtn.innerText, 'Checking...');
});

test('a failed update check re-enables the button and shows a failure message', function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var showAbout = freshAboutDisplay({
    getUpdates: function(version, cb){ cb(null, new Error('network down')); }
  });

  showAbout(sysDirs(), '2.3.1');
  var checkBtn = findButton('Check For Updates');
  checkBtn.onclick();

  assert.strictEqual(checkBtn.innerText, 'Update Check Failed');
  assert.strictEqual(checkBtn.disabled, false);
});

test('no update available re-enables the button and reports no updates', function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var showAbout = freshAboutDisplay({
    getUpdates: function(version, cb){ cb(null); }
  });

  showAbout(sysDirs(), '2.3.1');
  var checkBtn = findButton('Check For Updates');
  checkBtn.onclick();

  assert.strictEqual(checkBtn.innerText, 'No Updates Available');
  assert.strictEqual(checkBtn.disabled, false);
});

test('an available update shows the updates panel with the tag/date/description and focuses Download', function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var latest = {
    tag: 'v2.4.0',
    date: '2026-01-15T00:00:00Z',
    description: 'Bug fixes and improvements.',
    downloadInfo: { name: 'warewoolf-2.4.0.exe', url: 'https://example.com/warewoolf-2.4.0.exe' }
  };
  var showAbout = freshAboutDisplay({
    getUpdates: function(version, cb){ cb(latest); }
  });

  showAbout(sysDirs(), '2.3.1');
  var checkBtn = findButton('Check For Updates');
  checkBtn.onclick();

  assert.strictEqual(checkBtn.innerText, 'Updates Available!');
  assert.strictEqual(document.querySelector('.updates-panel').style.display, 'block');
  assert.match(document.querySelector('.updates-panel label').innerText, /WareWoolf v2\.4\.0 Available: /);
  assert.strictEqual(document.querySelector('.updates-text').innerText, 'Published 2026-01-15:\nBug fixes and improvements.');
  assert.strictEqual(document.activeElement, findButton('Download'));
});

test('on non-Linux, clicking Download passes a callback that reports the file was saved to the downloads folder', function(t){
  withPlatform(t, 'win32');
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var downloadCalls = [];
  var latest = {
    tag: 'v2.4.0', date: '2026-01-15T00:00:00Z', description: 'desc',
    downloadInfo: { name: 'warewoolf-2.4.0.exe', url: 'https://example.com/x.exe' }
  };
  var showAbout = freshAboutDisplay({
    getUpdates: function(version, cb){ cb(latest); },
    downloadUpdate: function(sysDirectories, downloadInfo, cb){ downloadCalls.push({ sysDirectories, downloadInfo, cb }); }
  });

  showAbout(sysDirs(), '2.3.1');
  findButton('Check For Updates').onclick();
  var downloadBtn = findButton('Download');
  downloadBtn.onclick();

  assert.strictEqual(downloadCalls.length, 1);
  assert.deepStrictEqual(downloadCalls[0].sysDirectories, sysDirs());
  assert.strictEqual(downloadCalls[0].downloadInfo, latest.downloadInfo);
  assert.strictEqual(downloadBtn.disabled, true);
  assert.strictEqual(downloadBtn.innerText, 'Downloading...');

  downloadCalls[0].cb('/downloads/warewoolf-2.4.0.exe');
  assert.strictEqual(downloadBtn.innerText, 'Downloaded Into Downloads Folder');
});

//Regression coverage: on Linux the flow hands off to showInstallUpdate instead of just reporting
//the file landed in Downloads, since installing there requires running the packaged installer.
test('on Linux, clicking Download hands off to showInstallUpdate instead of the downloads-folder callback', function(t){
  withPlatform(t, 'linux');
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var downloadCalls = [];
  var showInstallUpdateCalls = [];
  var latest = {
    tag: 'v2.4.0', date: '2026-01-15T00:00:00Z', description: 'desc',
    downloadInfo: { name: 'warewoolf_2.4.0_amd64.deb', url: 'https://example.com/x.deb' }
  };
  var showAbout = freshAboutDisplay({
    getUpdates: function(version, cb){ cb(latest); },
    downloadUpdate: function(sysDirectories, downloadInfo, cb){ downloadCalls.push(cb); },
    showInstallUpdate: function(fpath){ showInstallUpdateCalls.push(fpath); }
  });

  showAbout(sysDirs(), '2.3.1');
  findButton('Check For Updates').onclick();
  findButton('Download').onclick();

  assert.strictEqual(downloadCalls.length, 1);
  //downloadUpdate was handed showInstallUpdate itself as its completion callback
  downloadCalls[0]('/tmp/warewoolf_2.4.0_amd64.deb');
  assert.deepStrictEqual(showInstallUpdateCalls, ['/tmp/warewoolf_2.4.0_amd64.deb']);
});

test('View License loads and displays the license text from sysDirectories.app and focuses it', function(t){
  t.mock.method(fs, 'existsSync', function(p){ return p === '/app/licenses.txt'; });
  //Node's own module loader uses the real fs.readFileSync to read source files, so this mock must
  //pass through anything that isn't the licenses path rather than always returning fake text -
  //otherwise (re-)requiring any module while this mock is active fails to parse as JS.
  var originalReadFileSync = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', function(p, ...rest){
    if(p === '/app/licenses.txt')
      return 'MIT License text here.';
    return originalReadFileSync.call(fs, p, ...rest);
  });
  var showAbout = freshAboutDisplay({});

  showAbout(sysDirs(), '2.3.1');
  findButton('View License').onclick();

  var licenseText = document.querySelector('pre');
  assert.strictEqual(licenseText.innerText, 'MIT License text here.');
  assert.strictEqual(licenseText.parentElement.style.display, 'block');
  assert.strictEqual(document.activeElement, licenseText);
});

test('View License shows empty text when the licenses file does not exist', function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var showAbout = freshAboutDisplay({});

  showAbout(sysDirs(), '2.3.1');
  findButton('View License').onclick();

  assert.strictEqual(document.querySelector('pre').innerText, '');
});
