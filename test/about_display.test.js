const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const aboutDisplayPath = require.resolve('../src/components/views/about_display');
const updatesControllerPath = require.resolve('../src/components/controllers/updates');
const installUpdateDisplayPath = require.resolve('../src/components/views/install-update_display');
const { installBridge, uninstallBridge } = require('./fake-bridge');

//Captured once, before anything starts swapping fakes into require.cache for that module, and held
//for the life of the file - see the note on it in freshAboutDisplay below.
const realCanUpdateInPlace = require(updatesControllerPath).canUpdateInPlace;
delete require.cache[updatesControllerPath];

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
      //Not stubbed by default, and deliberately the real one: it is a pure read of the platformInfo
      //this view is already handed, and it decides whether a Windows writer is offered an in-place
      //install or a download. A stub here would let the view and the controller disagree about which
      //Windows build is running while every test still passed.
      canUpdateInPlace: mocks.canUpdateInPlace || realCanUpdateInPlace,
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
//`windowsInstall` defaults to 'squirrel' on win32 - the installed build, which is what every win32
//case in this file meant before the portable zip existed and what the overwhelming majority of
//Windows writers run. A test that wants the portable build asks for it by name; nothing here
//defaults to it, because 'portable' is the branch that must not be reached by accident.
function platformInfo(platform, windowsInstall){
  return {
    platform: platform,
    arch: 'x64',
    windowsInstall: platform === 'win32' ? (windowsInstall || 'squirrel') : null
  };
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

//Mock timers here even though nothing in this test ticks: it leaves a download in flight (neither
//outcome callback is ever fired), and a download in flight owns a live 15-second "still working"
//interval that nothing will stop. Left real, that interval holds the node process open after every
//assertion has passed, and the file hangs rather than fails - so any test that clicks Install and
//does not finish the download has to mock setInterval, the same as the ticker tests below do.
test('on win32, clicking Install Update disables the button, shows the wait message, and starts the Squirrel update with the release tag', function(t){
  t.mock.timers.enable({ apis: ['setInterval'] });
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

//The Windows download reports no progress - Electron's built-in autoUpdater has no
//download-progress event - so a line that keeps changing is the only thing standing between a slow
//download and a writer who concludes the app has hung. These four cover that it starts, that it
//stops on each of the two outcomes, and that it stops on its own if the popup is closed under it.
function statusLine(){
  return document.querySelector('.updates-status').innerText;
}

test('on win32, the downloading status keeps reporting elapsed time so a long wait does not look frozen', function(t){
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var showAbout = freshAboutDisplay({
    getUpdates: function(version, cb){ cb(win32Latest()); },
    startWindowsUpdate: function(){}
  });

  showAbout('2.3.1', platformInfo('win32'), immediateConfirm);
  findButton('Check For Updates').onclick();
  updatesButton().onclick();

  assert.match(statusLine(), /several minutes/, 'the wait is explained before the first tick');

  t.mock.timers.tick(15000);
  assert.strictEqual(statusLine(), 'Still downloading - 15 seconds so far.');

  t.mock.timers.tick(45000);
  assert.strictEqual(statusLine(), 'Still downloading - 1 minute so far.');

  //Past the first minute it still counts seconds. Rounded to whole minutes the line would sit
  //unchanged for four ticks at a time, which is the one thing it exists not to do.
  t.mock.timers.tick(15000);
  assert.strictEqual(statusLine(), 'Still downloading - 1 minute 15 seconds so far.');

  t.mock.timers.tick(105000);
  assert.strictEqual(statusLine(), 'Still downloading - 3 minutes so far.');
});

test('on win32, the downloaded event clears the status and stops the ticker', function(t){
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var onDownloaded;
  var showAbout = freshAboutDisplay({
    getUpdates: function(version, cb){ cb(win32Latest()); },
    startWindowsUpdate: function(tag, downloaded){ onDownloaded = downloaded; }
  });

  showAbout('2.3.1', platformInfo('win32'), immediateConfirm);
  findButton('Check For Updates').onclick();
  updatesButton().onclick();
  t.mock.timers.tick(15000);
  onDownloaded();

  assert.strictEqual(statusLine(), '');

  t.mock.timers.tick(60000);
  assert.strictEqual(statusLine(), '', 'a stopped ticker must not write over "Update ready."');
  assert.strictEqual(document.querySelector('.updates-text').innerText, 'Update ready.');
});

test('on win32, the failed event clears the status and stops the ticker', function(t){
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var onFailed;
  var showAbout = freshAboutDisplay({
    getUpdates: function(version, cb){ cb(win32Latest()); },
    startWindowsUpdate: function(tag, downloaded, failed){ onFailed = failed; }
  });

  showAbout('2.3.1', platformInfo('win32'), immediateConfirm);
  findButton('Check For Updates').onclick();
  updatesButton().onclick();
  t.mock.timers.tick(15000);
  onFailed('Squirrel could not reach the feed.');

  assert.strictEqual(statusLine(), '');

  t.mock.timers.tick(60000);
  assert.strictEqual(statusLine(), '');
  assert.match(document.querySelector('.updates-text').innerText, /could not reach the feed/);
});

//A writer who closes About while the download runs leaves an interval with nothing to write to.
//There is no close hook in this view to hang a clearInterval on, so the tick checks whether its own
//element is still in the document - which covers closePopups(), Escape, and any other way out at
//once. Mutation-checked: dropping the isConnected guard fails this and nothing else.
test('on win32, closing the popup mid-download stops the ticker instead of leaving it running', function(t){
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var showAbout = freshAboutDisplay({
    getUpdates: function(version, cb){ cb(win32Latest()); },
    startWindowsUpdate: function(){}
  });

  showAbout('2.3.1', platformInfo('win32'), immediateConfirm);
  findButton('Check For Updates').onclick();
  updatesButton().onclick();

  var status = document.querySelector('.updates-status');
  t.mock.timers.tick(15000);
  var lastSeen = status.innerText;

  findButton('Close').onclick();
  assert.strictEqual(document.querySelector('.updates-status'), null, 'the popup is gone');

  t.mock.timers.tick(60000);
  assert.strictEqual(status.innerText, lastSeen, 'the detached line must not still be being written to');
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

//---------------------------------------------------------------------------
// win32 portable: the build that cannot install anything, including itself
//---------------------------------------------------------------------------

//What getUpdates hands a portable copy: extractUpdateDownloadInfo matched the portable zip for it,
//because 'Windows_Portable_x64' is the bin type that build asks for. The point of these tests is
//that the view never puts that zip through the Squirrel path, and never puts a portable copy in
//front of the installer.
function portableLatest(){
  return {
    tag: 'v2.4.0', date: '2026-01-15T00:00:00Z', description: 'desc',
    downloadInfo: {
      name: 'warewoolf_2.4.0_Windows_Portable_x64.zip',
      url: 'https://example.com/x.zip'
    }
  };
}

test('on the portable win32 build, an available update shows Download rather than Install Update', function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var showAbout = freshAboutDisplay({
    getUpdates: function(version, cb){ cb(portableLatest()); }
  });

  showAbout('2.3.1', platformInfo('win32', 'portable'), immediateConfirm);
  findButton('Check For Updates').onclick();

  //textContent, not innerText: the label the portable build keeps is the one createButton gave it,
  //and nothing relabels it - which is the assertion. jsdom's innerText is only ever what this view
  //assigned, so it is undefined here exactly because the Install Update line did not run.
  assert.strictEqual(updatesButton().textContent, 'Download');
  assert.strictEqual(updatesButton().innerText, undefined);
});

//The regression this whole change exists for. Before it, every Windows copy took the Squirrel
//branch: a portable one has no Update.exe to hand the job to, so it failed, and the failure path
//offered to download the *installer* - which installs a second WareWoolf somewhere else and leaves
//the folder the writer is actually running from untouched and stale.
test('on the portable win32 build, clicking Download never starts a Squirrel update', function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var startCalls = 0;
  var downloaded = [];
  var showAbout = freshAboutDisplay({
    getUpdates: function(version, cb){ cb(portableLatest()); },
    startWindowsUpdate: function(){ startCalls++; },
    downloadUpdate: function(info, cb){ downloaded.push(info.name); cb('C:/Users/w/Downloads/' + info.name); }
  });

  showAbout('2.3.1', platformInfo('win32', 'portable'), immediateConfirm);
  findButton('Check For Updates').onclick();
  updatesButton().onclick();

  assert.strictEqual(startCalls, 0, 'the portable build has no Squirrel to start');
  assert.deepStrictEqual(downloaded, ['warewoolf_2.4.0_Windows_Portable_x64.zip']);
});

//A zip sitting in Downloads is not an update until the writer swaps their folder for it, and
//nothing else in the app is going to say so.
test('on the portable win32 build, a finished download says to replace the folder', function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var showAbout = freshAboutDisplay({
    getUpdates: function(version, cb){ cb(portableLatest()); },
    downloadUpdate: function(info, cb){ cb('C:/Users/w/Downloads/' + info.name); }
  });

  showAbout('2.3.1', platformInfo('win32', 'portable'), immediateConfirm);
  findButton('Check For Updates').onclick();
  updatesButton().onclick();

  assert.strictEqual(updatesButton().innerText, 'Downloaded Into Downloads Folder');
  assert.match(document.querySelector('.updates-status').innerText, /replace your WareWoolf folder/);
});

//The installed build is untouched by any of this: it still gets the in-place install it had, and
//the installer as the asset behind it.
test('the installed win32 build still gets Install Update and the Squirrel path', function(t){
  t.mock.timers.enable({ apis: ['setInterval'] });
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var startCalls = [];
  var showAbout = freshAboutDisplay({
    getUpdates: function(version, cb){ cb(win32Latest()); },
    startWindowsUpdate: function(tag){ startCalls.push(tag); }
  });

  showAbout('2.3.1', platformInfo('win32', 'squirrel'), immediateConfirm);
  findButton('Check For Updates').onclick();
  assert.strictEqual(updatesButton().innerText, 'Install Update');

  updatesButton().onclick();
  assert.deepStrictEqual(startCalls, ['v2.4.0']);
});

//downloadUpdate's new onFail, from the view's side. A release with no asset this copy can use -
//a portable copy looking at v2.5.0 or earlier, which predates the portable zip - used to leave the
//button disabled and reading "Downloading..." forever, because downloadUpdate logged and returned
//without calling anything back.
test('a release with no usable asset re-enables the button and says so instead of hanging', function(t){
  t.mock.method(fs, 'existsSync', function(){ return false; });
  var noAsset = portableLatest();
  delete noAsset.downloadInfo;
  //The real downloadUpdate, whose missing-downloadInfo branch is what this is about, reduced to the
  //one call it makes on that path.
  var showAbout = freshAboutDisplay({
    getUpdates: function(version, cb){ cb(noAsset); },
    downloadUpdate: function(info, cb, onFail){ onFail('This release has no download for your platform.'); }
  });

  showAbout('2.3.1', platformInfo('win32', 'portable'), immediateConfirm);
  findButton('Check For Updates').onclick();
  updatesButton().onclick();

  assert.strictEqual(updatesButton().disabled, false, 'the writer must be able to try again');
  assert.strictEqual(updatesButton().innerText, 'Download Failed');
  assert.match(document.querySelector('.updates-status').innerText, /no download for your platform/);
});
