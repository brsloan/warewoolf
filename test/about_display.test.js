const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const aboutDisplayPath = require.resolve('../src/components/views/about_display');
const updatesControllerPath = require.resolve('../src/components/controllers/updates');
const installUpdateDisplayPath = require.resolve('../src/components/views/install-update_display');
const { installBridge, uninstallBridge } = require('./fake-bridge');

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
      downloadUpdate: mocks.downloadUpdate || function(){},
      startWindowsUpdate: mocks.startWindowsUpdate || function(){},
      finishWindowsUpdate: mocks.finishWindowsUpdate || function(){}
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

//Phase 8: about_display.js reads platformInfo.platform (render.js's own platform.getPlatform()
//result, threaded in as a third argument) instead of process.platform directly - this just builds
//the shape showAbout expects rather than patching a global.
function platformInfo(platform){
  return { platform: platform, arch: 'x64' };
}

//Stands in for render.js's own proceedOrConfirmSave: runs the continuation straight through, as if
//there were never any unsaved work to ask about. Tests that care whether the check ran at all pass
//their own spy instead.
function immediateConfirm(continueFunc){
  continueFunc();
}

function findButton(text){
  return Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent === text; });
}

//Phase 9c: the sysDirs() helper that used to be here is gone with showAbout's first parameter. It
//survived Phase 9a's removal of the licenses path only because downloadUpdate still composed the
//update asset's destination from temp/downloads in this view; the backing picks that directory now,
//so this view names no filesystem location at all and has nothing to be handed.

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
  //readLicenses used to be reached through a node backing about_display.js built out of the
  //sysDirectories it was handed; the main process owns paths.app now, so the app directory the
  //View License test mocks fs against goes to the backing behind the bridge instead. fs is still
  //resolved per call on the shared module object, so t.mock.method inside a test is seen from here.
  installBridge({ paths: { app: '/app' } });
});

test.afterEach(function(){
  uninstallBridge();
  delete require.cache[aboutDisplayPath];
  delete require.cache[updatesControllerPath];
  delete require.cache[installUpdateDisplayPath];
  delete global.window;
  delete global.document;
});

test('renders the app version, WareWoolf.org link, and description, and focuses Close', function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var showAbout = freshAboutDisplay({});

  showAbout('2.3.1', platformInfo('win32'));

  assert.strictEqual(document.querySelector('.about-version').innerText, '2.3.1');
  assert.strictEqual(document.querySelector('.about-url').innerText, 'WareWoolf.org');
  assert.match(document.querySelector('.popup p').innerText, /open source software/);
  assert.strictEqual(document.activeElement, findButton('Close'));
});

test('Close removes the popup', function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var showAbout = freshAboutDisplay({});

  showAbout('2.3.1', platformInfo('win32'));
  findButton('Close').onclick();

  assert.strictEqual(document.getElementsByClassName('popup').length, 0);
});

test('Check For Updates disables the button and calls getUpdates with the current app version', function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var getUpdatesCalls = [];
  var showAbout = freshAboutDisplay({
    getUpdates: function(version, cb){ getUpdatesCalls.push(version); }
  });

  showAbout('2.3.1', platformInfo('win32'));
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

  showAbout('2.3.1', platformInfo('win32'));
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

  showAbout('2.3.1', platformInfo('win32'));
  var checkBtn = findButton('Check For Updates');
  checkBtn.onclick();

  assert.strictEqual(checkBtn.innerText, 'No Updates Available');
  assert.strictEqual(checkBtn.disabled, false);
});

//darwin here (not win32): win32 grows its own "Install Update" label below, so this asserts the
//shared "found an update" rendering on the platform that still uses it unchanged.
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

  showAbout('2.3.1', platformInfo('darwin'));
  var checkBtn = findButton('Check For Updates');
  checkBtn.onclick();

  assert.strictEqual(checkBtn.innerText, 'Updates Available!');
  assert.strictEqual(document.querySelector('.updates-panel').style.display, 'block');
  assert.match(document.querySelector('.updates-panel label').innerText, /WareWoolf v2\.4\.0 Available: /);
  assert.strictEqual(document.querySelector('.updates-text').innerText, 'Published 2026-01-15:\nBug fixes and improvements.');
  assert.strictEqual(document.activeElement, findButton('Download'));
});

//darwin here too, for the same reason: this is the manual-download path win32 still falls back to
//on failure, but which is otherwise not win32's own happy path any more.
test('on macOS, clicking Download passes a callback that reports the file was saved to the downloads folder', function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var downloadCalls = [];
  var latest = {
    tag: 'v2.4.0', date: '2026-01-15T00:00:00Z', description: 'desc',
    downloadInfo: { name: 'warewoolf-2.4.0.exe', url: 'https://example.com/x.exe' }
  };
  var showAbout = freshAboutDisplay({
    getUpdates: function(version, cb){ cb(latest); },
    downloadUpdate: function(downloadInfo, cb){ downloadCalls.push({ downloadInfo, cb }); }
  });

  showAbout('2.3.1', platformInfo('darwin'));
  findButton('Check For Updates').onclick();
  var downloadBtn = findButton('Download');
  downloadBtn.onclick();

  assert.strictEqual(downloadCalls.length, 1);
  assert.strictEqual(downloadCalls[0].downloadInfo, latest.downloadInfo);
  assert.strictEqual(downloadBtn.disabled, true);
  assert.strictEqual(downloadBtn.innerText, 'Downloading...');

  downloadCalls[0].cb('/downloads/warewoolf-2.4.0.exe');
  assert.strictEqual(downloadBtn.innerText, 'Downloaded Into Downloads Folder');
});

//Regression coverage: on Linux the flow hands off to showInstallUpdate instead of just reporting
//the file landed in Downloads, since installing there requires running the packaged installer.
test('on Linux, clicking Download hands off to showInstallUpdate instead of the downloads-folder callback', function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var downloadCalls = [];
  var showInstallUpdateCalls = [];
  var latest = {
    tag: 'v2.4.0', date: '2026-01-15T00:00:00Z', description: 'desc',
    downloadInfo: { name: 'warewoolf_2.4.0_amd64.deb', url: 'https://example.com/x.deb' }
  };
  var showAbout = freshAboutDisplay({
    getUpdates: function(version, cb){ cb(latest); },
    downloadUpdate: function(downloadInfo, cb){ downloadCalls.push(cb); },
    showInstallUpdate: function(fpath){ showInstallUpdateCalls.push(fpath); }
  });

  showAbout('2.3.1', platformInfo('linux'));
  findButton('Check For Updates').onclick();
  findButton('Download').onclick();

  assert.strictEqual(downloadCalls.length, 1);
  //downloadUpdate was handed showInstallUpdate itself as its completion callback
  downloadCalls[0]('/tmp/warewoolf_2.4.0_amd64.deb');
  assert.deepStrictEqual(showInstallUpdateCalls, ['/tmp/warewoolf_2.4.0_amd64.deb']);
});

//---------------------------------------------------------------------------
// win32: Install Update / Restart To Finish / Download Installer
//---------------------------------------------------------------------------

function win32Latest(){
  return {
    tag: 'v2.4.0', date: '2026-01-15T00:00:00Z', description: 'desc',
    downloadInfo: { name: 'warewoolf_2.4.0_Windows_x64.exe', url: 'https://example.com/x.exe' }
  };
}

//The updates-panel button relabels itself via .innerText as the flow progresses, the same as
//checkUpdatesBtn already does elsewhere in this file - and jsdom's innerText does not update
//textContent (see the file-level comment on innerText above), so these grab the one button in the
//panel by its container rather than by findButton()'s textContent match, exactly as the existing
//"clicking Download..." tests capture their button reference once and read .innerText off it
//afterward instead of re-querying by name.
function updatesButton(){
  return document.querySelector('.updates-panel button');
}

test('on win32, an available update shows Install Update rather than Download', function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var showAbout = freshAboutDisplay({
    getUpdates: function(version, cb){ cb(win32Latest()); }
  });

  showAbout('2.3.1', platformInfo('win32'), immediateConfirm);
  findButton('Check For Updates').onclick();

  assert.strictEqual(updatesButton().innerText, 'Install Update');
});

test('on win32, clicking Install Update disables the button, shows the wait message, and starts the Squirrel update with the release tag', function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var startCalls = [];
  var showAbout = freshAboutDisplay({
    getUpdates: function(version, cb){ cb(win32Latest()); },
    startWindowsUpdate: function(tag, onDownloaded, onFailed){ startCalls.push(tag); }
  });

  showAbout('2.3.1', platformInfo('win32'), immediateConfirm);
  findButton('Check For Updates').onclick();
  var installBtn = updatesButton();
  installBtn.onclick();

  assert.deepStrictEqual(startCalls, ['v2.4.0']);
  assert.strictEqual(installBtn.disabled, true);
  assert.match(installBtn.innerText, /Downloading update/);
});

test('on win32, the downloaded event swaps in Restart To Finish, which runs the unsaved-work check before finishing the update', function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var finishCalls = 0;
  var confirmCalls = 0;
  var onDownloaded;
  var showAbout = freshAboutDisplay({
    getUpdates: function(version, cb){ cb(win32Latest()); },
    startWindowsUpdate: function(tag, downloaded, failed){ onDownloaded = downloaded; },
    finishWindowsUpdate: function(){ finishCalls++; }
  });

  //Not immediateConfirm: this test needs to see that Restart went *through* the check, not just
  //that finishWindowsUpdate eventually ran - a direct quitAndInstallUpdate call from the button
  //handler would also leave finishCalls at 1, which is exactly the bug this check exists to prevent.
  var confirmBeforeContinuing = function(continueFunc){
    confirmCalls++;
    continueFunc();
  };

  showAbout('2.3.1', platformInfo('win32'), confirmBeforeContinuing);
  findButton('Check For Updates').onclick();
  updatesButton().onclick();
  onDownloaded();

  var restartBtn = updatesButton();
  assert.strictEqual(restartBtn.innerText, 'Restart To Finish');
  assert.strictEqual(document.querySelector('.updates-text').innerText, 'Update ready.');

  restartBtn.onclick();

  assert.strictEqual(confirmCalls, 1, 'Restart must run the same unsaved-work check exit-app-clicked uses');
  assert.strictEqual(finishCalls, 1);
});

test('on win32, the failed event falls back to Download Installer and the manual download path', function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var latest = win32Latest();
  var downloadCalls = [];
  var onFailed;
  var showAbout = freshAboutDisplay({
    getUpdates: function(version, cb){ cb(latest); },
    startWindowsUpdate: function(tag, downloaded, failed){ onFailed = failed; },
    downloadUpdate: function(downloadInfo, cb){ downloadCalls.push(downloadInfo); }
  });

  showAbout('2.3.1', platformInfo('win32'), immediateConfirm);
  findButton('Check For Updates').onclick();
  updatesButton().onclick();
  onFailed('Squirrel could not reach the feed.');

  var fallbackBtn = updatesButton();
  assert.strictEqual(fallbackBtn.innerText, 'Download Installer');
  assert.match(document.querySelector('.updates-text').innerText, /Squirrel could not reach the feed\./);
  assert.match(document.querySelector('.updates-text').innerText, /install it yourself instead/);

  fallbackBtn.onclick();

  assert.strictEqual(downloadCalls.length, 1);
  assert.strictEqual(downloadCalls[0], latest.downloadInfo);
});

test('View License loads and displays the license text from sysDirectories.app and focuses it', async function(t){
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

  showAbout('2.3.1', platformInfo('win32'));
  //Loaded on demand now, through the platform facade - awaited so the assertions below see the
  //text rather than racing the microtask that fetches it.
  await findButton('View License').onclick();

  var licenseText = document.querySelector('pre');
  assert.strictEqual(licenseText.innerText, 'MIT License text here.');
  assert.strictEqual(licenseText.parentElement.style.display, 'block');
  assert.strictEqual(document.activeElement, licenseText);
});

test('View License shows empty text when the licenses file does not exist', async function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var showAbout = freshAboutDisplay({});

  showAbout('2.3.1', platformInfo('win32'));
  await findButton('View License').onclick();

  assert.strictEqual(document.querySelector('pre').innerText, '');
});
