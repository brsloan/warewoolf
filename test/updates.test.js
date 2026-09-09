const test = require('node:test');
const assert = require('node:assert');
const https = require('https');
const child_process = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { Readable } = require('stream');

const errorLog = require('../src/components/controllers/error-log');
const { createPlatform } = require('../src/components/controllers/platform');
const { createNodeBacking } = require('../src/components/controllers/platform-node');
const updatesPath = require.resolve('../src/components/controllers/updates');
const { installBridge, uninstallBridge } = require('./fake-bridge');

//updates.js (Phase 8) holds its own standing platform instance, built once when the module is
//first required - createNodeBacking() resolves https.request/https.get/child_process.spawn off
//the real modules at *that* construction moment, not fresh on every call. So a test that mocks any
//of those has to do it before updates.js's module body runs, exactly like wifi-manager.test.js and
//battery-monitor.test.js's own freshXxx() helpers already require for the same reason - this is
//the same pattern applied to every test in this file now, not just the ones that used to need it.
function freshUpdates(deps){
  delete require.cache[updatesPath];
  //Phase 9a: the standing instance is ipc-backed now, so the node backing that resolves
  //https.request/https.get/child_process.spawn lives behind the bridge instead of inside this
  //module. The ordering constraint is unchanged and this is still where it is satisfied - the
  //backing is constructed here, after the mock and before the re-require. It also has to be *one*
  //backing per test run: installUpdate only accepts a path a prior downloadUpdate vouched for, and
  //re-installing the bridge mid-test would throw that set away.
  //Phase 9c: `deps` reach the node backing on the far side of that bridge. downloadUpdate allocates
  //its own destination now, so a test that needs a real download either mocks https.get on the
  //module before this call (as the download tests below still do) or injects httpsGet here.
  installBridge(deps);
  return require(updatesPath);
}

//startWindowsUpdate/finishWindowsUpdate need the bridge itself, not just the module exports - the
//events they subscribe to only exist as something a test can fire (bridge.emit) or count
//(bridge.listenerCount) on that fake bridge, the same one platform.on/off talk to underneath.
function freshUpdatesWithBridge(deps){
  delete require.cache[updatesPath];
  const bridge = installBridge(deps);
  return { updates: require(updatesPath), bridge: bridge };
}

function tempDir(){
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-updates-'));
}

function freshTempDir(t){
  const dir = tempDir();
  t.after(function(){
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

//Keep any incidental real logError call out of the repo's cwd instead of the default bare
//"error_log.txt".
test.before(function(){
  errorLog.setPlatform(createPlatform(createNodeBacking({ paths: { userData: tempDir() } })));
});

test.after(uninstallBridge);

function releaseJson(tag, overrides){
  const v = tag.replace('v', '');
  return JSON.stringify(Object.assign({
    tag_name: tag,
    prerelease: false,
    body: 'Release notes for ' + tag,
    published_at: '2026-01-01T00:00:00Z',
    assets: [
      { name: 'warewoolf_' + v + '_amd64.deb', browser_download_url: 'https://example.com/' + v + '/amd64.deb' },
      { name: 'warewoolf_' + v + '_arm64.deb', browser_download_url: 'https://example.com/' + v + '/arm64.deb' },
      { name: 'warewoolf_' + v + '_Windows_x64.zip', browser_download_url: 'https://example.com/' + v + '/win.zip' },
      { name: 'warewoolf_' + v + '_MacOS_Intel.zip', browser_download_url: 'https://example.com/' + v + '/mac-intel.zip' },
      { name: 'warewoolf_' + v + '_MacOS_AppleSilicon.zip', browser_download_url: 'https://example.com/' + v + '/mac-arm.zip' },
      { name: 'warewoolf_' + v + '_MacOS_Legacy.zip', browser_download_url: 'https://example.com/' + v + '/mac-legacy.zip' }
    ]
  }, overrides));
}

//Mocks the single https.request call platform.checkForUpdate() makes to the GitHub API.
function mockReleaseResponse(t, opts){
  return t.mock.method(https, 'request', function(options, callback){
    const req = new EventEmitter();
    req.destroy = function(err){ req.emit('error', err); };
    req.end = function(){
      if(opts.triggerError){
        setImmediate(function(){ req.emit('error', opts.triggerError); });
        return;
      }
      setImmediate(function(){
        const res = new EventEmitter();
        res.statusCode = opts.statusCode || 200;
        callback(res);
        setImmediate(function(){
          res.emit('data', Buffer.from(opts.body));
          res.emit('end');
        });
      });
    };
    return req;
  });
}

//Mocks the sequence of https.get calls platform.downloadUpdate() makes (more than one entry
//simulates following a redirect). Returns the list of URLs actually requested, in order.
function mockHttpsGetSequence(t, responses){
  const calls = [];
  t.mock.method(https, 'get', function(url, callback){
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
  });
  return calls;
}

function makeFakeChild(){
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

//The only URL shape downloadUpdate accepts: a release asset on this project's own repo, which is
//the only shape checkForUpdate's own response ever carries.
function assetUrl(name){
  return 'https://github.com/brsloan/warewoolf/releases/download/v2.0.0/' + name;
}

//Vouches a path for installUpdate the same way the real app does: a successful downloadUpdate call
//against the same standing platform instance.
//
//Phase 9c: it has to be a real download. Writing the file first used to be enough, because
//downloadUpdate vouched anything fs.existsSync could see at a path the caller named - which is
//precisely the hole this phase closed, so a helper that still worked that way would be asserting
//against a vouch the app no longer grants. The backing picks the directory, so the path comes back
//from the call rather than going into it, and the test cleans up what it is handed.
function vouchedPath(t, downloadUpdate, name){
  return new Promise(function(resolve){
    downloadUpdate({ name: name, url: assetUrl(name) }, function(filePath){
      t.after(function(){
        fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
      });
      resolve(filePath);
    });
  });
}

//Downloads for the install tests are injected rather than mocked on the https module, so a test that
//also mocks child_process.spawn does not have to sequence two module mocks against one construction.
function installerBytes(){
  return function(url, callback){
    const req = new EventEmitter();
    req.end = function(){};
    setImmediate(function(){
      const res = Readable.from([Buffer.from('stand-in-installer')]);
      res.statusCode = 200;
      res.headers = {};
      callback(res);
    });
    return req;
  };
}

//---------------------------------------------------------------------------
// getUpdates
//---------------------------------------------------------------------------

test('getUpdates reports the release info when a newer version is available', async function(t){
  mockReleaseResponse(t, { body: releaseJson('v2.0.0') });
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const origArch = Object.getOwnPropertyDescriptor(process, 'arch');
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
  t.after(function(){
    Object.defineProperty(process, 'platform', origPlatform);
    Object.defineProperty(process, 'arch', origArch);
  });
  const { getUpdates } = freshUpdates();

  const latest = await new Promise(function(resolve){ getUpdates('1.0.0', resolve); });

  assert.ok(latest);
  assert.strictEqual(latest.tag, 'v2.0.0');
  assert.strictEqual(latest.downloadInfo.name, 'warewoolf_2.0.0_amd64.deb');
});

test('getUpdates reports null when already on the latest version', async function(t){
  mockReleaseResponse(t, { body: releaseJson('v1.0.0') });
  const { getUpdates } = freshUpdates();

  const [latest, err] = await new Promise(function(resolve){
    getUpdates('1.0.0', function(latest, err){ resolve([latest, err]); });
  });
  assert.strictEqual(latest, null);
  assert.ok(!err, 'a genuine "no update" result must not be reported as a failed check');
});

test('getUpdates reports null when the installed version is already newer than the latest release', async function(t){
  mockReleaseResponse(t, { body: releaseJson('v1.0.0') });
  const { getUpdates } = freshUpdates();

  const latest = await new Promise(function(resolve){ getUpdates('2.0.0', resolve); });
  assert.strictEqual(latest, null);
});

test('getUpdates regression: a higher patch version alone is reported as an available update', async function(t){
  mockReleaseResponse(t, { body: releaseJson('v1.2.3') });
  const { getUpdates } = freshUpdates();

  const latest = await new Promise(function(resolve){ getUpdates('1.2.2', resolve); });
  assert.ok(latest, 'a higher patch version should be reported as available');
});

test('getUpdates regression: a lower minor version is not reported as available even with a higher patch', async function(t){
  mockReleaseResponse(t, { body: releaseJson('v1.1.9') });
  const { getUpdates } = freshUpdates();

  const latest = await new Promise(function(resolve){ getUpdates('1.2.0', resolve); });
  assert.strictEqual(latest, null);
});

//Regression: a GitHub API error response ({"message": "..."} with no "assets") used to throw
//uncaught inside packageReleaseData's forEach instead of being reported as "no update".
test('getUpdates regression: reports null instead of throwing when GitHub responds with a non-200 status', async function(t){
  mockReleaseResponse(t, { statusCode: 403, body: JSON.stringify({ message: 'API rate limit exceeded' }) });
  const { getUpdates } = freshUpdates();

  const latest = await new Promise(function(resolve){ getUpdates('1.0.0', resolve); });
  assert.strictEqual(latest, null);
});

//Regression: JSON.parse on a non-JSON body (proxy error page, truncated response, etc.) used to
//throw uncaught inside the 'end' handler with nothing to catch it.
test('getUpdates regression: reports null instead of throwing when the response body is not valid JSON', async function(t){
  mockReleaseResponse(t, { statusCode: 200, body: '<html>not json</html>' });
  const { getUpdates } = freshUpdates();

  const latest = await new Promise(function(resolve){ getUpdates('1.0.0', resolve); });
  assert.strictEqual(latest, null);
});

//Regression: a request-level network error only called logError, never the getUpdates
//callback - the caller (the "Checking..." button) would hang forever.
test('getUpdates regression: reports null instead of hanging forever when the request errors', async function(t){
  mockReleaseResponse(t, { triggerError: new Error('ENOTFOUND api.github.com') });
  const { getUpdates } = freshUpdates();

  const latest = await new Promise(function(resolve){ getUpdates('1.0.0', resolve); });
  assert.strictEqual(latest, null);
});

//Regression: a failed release check (bad status, bad JSON, unexpected shape, or a network
//error) used to call back with plain `null`, identical to a genuine "no update available"
//result - the About panel then told the user "No Updates Available" even when the check never
//actually completed. getUpdates must now pass an error as the second callback argument so the
//two cases can be told apart.
test('getUpdates regression: reports an error instead of a bare null when GitHub responds with a non-200 status', async function(t){
  mockReleaseResponse(t, { statusCode: 403, body: JSON.stringify({ message: 'API rate limit exceeded' }) });
  const { getUpdates } = freshUpdates();

  const [latest, err] = await new Promise(function(resolve){
    getUpdates('1.0.0', function(latest, err){ resolve([latest, err]); });
  });
  assert.strictEqual(latest, null);
  assert.ok(err instanceof Error);
});

test('getUpdates regression: reports an error instead of a bare null when the response body is not valid JSON', async function(t){
  mockReleaseResponse(t, { statusCode: 200, body: '<html>not json</html>' });
  const { getUpdates } = freshUpdates();

  const [latest, err] = await new Promise(function(resolve){
    getUpdates('1.0.0', function(latest, err){ resolve([latest, err]); });
  });
  assert.strictEqual(latest, null);
  assert.ok(err instanceof Error);
});

test('getUpdates regression: reports an error instead of a bare null for an unexpected release data shape', async function(t){
  mockReleaseResponse(t, { statusCode: 200, body: JSON.stringify({ no: 'assets here' }) });
  const { getUpdates } = freshUpdates();

  const [latest, err] = await new Promise(function(resolve){
    getUpdates('1.0.0', function(latest, err){ resolve([latest, err]); });
  });
  assert.strictEqual(latest, null);
  assert.ok(err instanceof Error);
});

test('getUpdates regression: reports an error instead of a bare null when the request errors', async function(t){
  mockReleaseResponse(t, { triggerError: new Error('ENOTFOUND api.github.com') });
  const { getUpdates } = freshUpdates();

  const [latest, err] = await new Promise(function(resolve){
    getUpdates('1.0.0', function(latest, err){ resolve([latest, err]); });
  });
  assert.strictEqual(latest, null);
  assert.ok(err instanceof Error);
});

//Regression: a malformed/prerelease-style tag produced NaN digits, which compared as neither
//greater-than nor equal-to anything and used to silently fall through; make sure it resolves
//to "no update" rather than throwing or reporting a false positive.
test('getUpdates regression: does not throw and reports no update for a malformed release tag', async function(t){
  mockReleaseResponse(t, { body: releaseJson('not-a-version') });
  const { getUpdates } = freshUpdates();

  const latest = await new Promise(function(resolve){ getUpdates('1.0.0', resolve); });
  assert.strictEqual(latest, null);
});

//Regression: fetchLatestReleaseData had no request timeout, so a hung connection blocked the
//update check indefinitely.
//getUpdates' own call into platform.checkForUpdate() now crosses createPlatform's Promise wrapper
//(Promise.resolve().then(...) - see platform.js), so the backing's https.request call lands one
//microtask after getUpdates() returns rather than synchronously within it, unlike before this
//conversion - a single setImmediate flush is enough to let it land.
function flushMicrotask(){
  return new Promise(function(resolve){ setImmediate(resolve); });
}

test('getUpdates regression: sets a timeout on the release-check request so it cannot hang forever', async function(t){
  let capturedOptions;
  t.mock.method(https, 'request', function(options){
    capturedOptions = options;
    const req = new EventEmitter();
    req.end = function(){};
    return req;
  });
  const { getUpdates } = freshUpdates();

  getUpdates('1.0.0', function(){});
  await flushMicrotask();

  assert.ok(capturedOptions.timeout > 0);
});

test('getUpdates regression: destroys the request once it times out', async function(t){
  let capturedReq;
  t.mock.method(https, 'request', function(options, callback){
    const req = new EventEmitter();
    req.end = function(){};
    req.destroy = function(err){ req.destroyedWith = err; };
    capturedReq = req;
    return req;
  });
  const { getUpdates } = freshUpdates();

  getUpdates('1.0.0', function(){});
  await flushMicrotask();
  capturedReq.emit('timeout');

  assert.ok(capturedReq.destroyedWith instanceof Error);
});

//`electron` is what the build was packaged against, and on darwin it decides which of the two mac
//lineages the build follows. Leaving it off a row is itself a case worth covering: that is this
//suite's own situation, plain node with no process.versions.electron, and it has to read as
//mainline rather than legacy.
function asPlatform(t, c){
  const orig = {
    platform: Object.getOwnPropertyDescriptor(process, 'platform'),
    arch: Object.getOwnPropertyDescriptor(process, 'arch'),
    electron: Object.getOwnPropertyDescriptor(process.versions, 'electron')
  };
  Object.defineProperty(process, 'platform', { value: c.platform, configurable: true });
  Object.defineProperty(process, 'arch', { value: c.arch, configurable: true });
  if(c.electron)
    Object.defineProperty(process.versions, 'electron', { value: c.electron, configurable: true });
  else
    delete process.versions.electron;

  t.after(function(){
    Object.defineProperty(process, 'platform', orig.platform);
    Object.defineProperty(process, 'arch', orig.arch);
    if(orig.electron)
      Object.defineProperty(process.versions, 'electron', orig.electron);
    else
      delete process.versions.electron;
  });
}

[
  { platform: 'linux', arch: 'x64', expected: 'amd64' },
  { platform: 'linux', arch: 'arm64', expected: 'arm64' },
  { platform: 'win32', arch: 'x64', expected: 'Windows_x64' },
  { platform: 'darwin', arch: 'x64', expected: 'MacOS_Intel' },
  { platform: 'darwin', arch: 'arm64', expected: 'MacOS_AppleSilicon' },
  { platform: 'darwin', arch: 'x64', electron: '44.2.0', expected: 'MacOS_Intel' },
  { platform: 'darwin', arch: 'arm64', electron: '44.2.0', expected: 'MacOS_AppleSilicon' },
  { platform: 'darwin', arch: 'x64', electron: '32.3.3', expected: 'MacOS_Legacy' },
  //The boundary from both sides. 32 is the last line that runs on Catalina; 33 raised the floor to
  //Big Sur and is therefore mainline.
  { platform: 'darwin', arch: 'x64', electron: '32.0.0', expected: 'MacOS_Legacy' },
  { platform: 'darwin', arch: 'x64', electron: '33.0.0', expected: 'MacOS_Intel' },
  //A legacy build on an Apple Silicon mac runs under Rosetta, where process.arch reports x64 just
  //as it does on real Intel hardware. It has to stay on the legacy track anyway: its Electron
  //predates every mainline asset on offer.
  { platform: 'darwin', arch: 'x64', electron: '32.3.3', rosetta: true, expected: 'MacOS_Legacy' }
].forEach(function(c){
  const label = c.platform + '/' + c.arch + (c.electron ? '/electron ' + c.electron : '/no electron')
    + (c.rosetta ? ' (Rosetta)' : '');

  test('getUpdates selects the ' + c.expected + ' binary on ' + label, async function(t){
    mockReleaseResponse(t, { body: releaseJson('v2.0.0') });
    asPlatform(t, c);
    const { getUpdates } = freshUpdates();

    //Whole-name equality rather than includes(): a substring assertion here is the same weakness
    //that makes the production find() collide, and would pass on the wrong asset.
    const ext = c.platform == 'linux' ? '.deb' : '.zip';
    const latest = await new Promise(function(resolve){ getUpdates('1.0.0', resolve); });
    assert.ok(latest.downloadInfo, 'expected a matching binary to be selected');
    assert.strictEqual(latest.downloadInfo.name, 'warewoolf_2.0.0_' + c.expected + ext);
  });
});

//Regression, and the reason the legacy asset is not named MacOS_Intel_Legacy.
//extractUpdateDownloadInfo picks with find(), which takes the first name that merely *includes*
//binType - so a legacy name carrying the mainline substring would be handed out on whichever
//ordering the GitHub API happened to return that day. The names are checked here for the overlap
//that would make ordering matter at all, and the two lineages are checked below against an
//ordering deliberately chosen to break a name that had it.
test('the legacy and mainline mac asset names cannot match each other by substring', function(){
  assert.ok(!'warewoolf_2.0.0_MacOS_Legacy.zip'.includes('MacOS_Intel'));
  assert.ok(!'warewoolf_2.0.0_MacOS_Intel.zip'.includes('MacOS_Legacy'));
  assert.ok(!'warewoolf_2.0.0_MacOS_Legacy.zip'.includes('MacOS_AppleSilicon'));
  assert.ok(!'warewoolf_2.0.0_MacOS_Legacy.zip'.includes('arm64'));
});

[
  { electron: '32.3.3', expected: 'warewoolf_2.0.0_MacOS_Legacy.zip', other: 'the mainline build it cannot launch' },
  { electron: '44.2.0', expected: 'warewoolf_2.0.0_MacOS_Intel.zip', other: 'a silent downgrade to the legacy build' }
].forEach(function(c){
  test('an Electron ' + c.electron + ' mac build is never offered ' + c.other + ', whatever order the assets are listed in', async function(t){
    //Legacy listed first, the ordering that would break a substring-overlapping name.
    mockReleaseResponse(t, { body: releaseJson('v2.0.0', { assets: [
      { name: 'warewoolf_2.0.0_MacOS_Legacy.zip', browser_download_url: 'https://example.com/2.0.0/mac-legacy.zip' },
      { name: 'warewoolf_2.0.0_MacOS_Intel.zip', browser_download_url: 'https://example.com/2.0.0/mac-intel.zip' }
    ] }) });
    asPlatform(t, { platform: 'darwin', arch: 'x64', electron: c.electron });
    const { getUpdates } = freshUpdates();

    const latest = await new Promise(function(resolve){ getUpdates('1.0.0', resolve); });
    assert.strictEqual(latest.downloadInfo.name, c.expected);
  });
});

//A legacy build looking at a release that predates the legacy lineage - every release before this
//one - finds nothing, rather than falling back to a mainline asset that cannot launch on its OS.
test('a legacy mac build finds no binary in a release that has no legacy asset', async function(t){
  mockReleaseResponse(t, { body: releaseJson('v2.0.0', { assets: [
    { name: 'warewoolf_2.0.0_MacOS_Intel.zip', browser_download_url: 'https://example.com/2.0.0/mac-intel.zip' }
  ] }) });
  asPlatform(t, { platform: 'darwin', arch: 'x64', electron: '32.3.3' });
  const { getUpdates } = freshUpdates();

  const latest = await new Promise(function(resolve){ getUpdates('1.0.0', resolve); });
  assert.ok(latest, 'an update is still announced');
  assert.strictEqual(latest.downloadInfo, undefined);
});

//Regression: Step 1 of the Windows autoupdate plan adds RELEASES and warewoolf-<version>-full.nupkg
//to the assets a Windows release actually carries alongside the .exe. extractUpdateDownloadInfo
//matches by bin.name.includes(binType) over a find(), so a release listing that includes them must
//still hand win32 the .exe and not accidentally match one of the two new files (neither one
//contains "Windows_x64", but this is the regression that would show it if a future rename broke
//that).
test('getUpdates regression: matches the Windows installer even when RELEASES and the .nupkg feed file are also listed as assets', async function(t){
  mockReleaseResponse(t, { body: releaseJson('v2.0.0', { assets: [
    { name: 'warewoolf_2.0.0_amd64.deb', browser_download_url: 'https://example.com/2.0.0/amd64.deb' },
    { name: 'warewoolf_2.0.0_Windows_x64.exe', browser_download_url: 'https://example.com/2.0.0/win.exe' },
    { name: 'RELEASES', browser_download_url: 'https://example.com/2.0.0/RELEASES' },
    { name: 'warewoolf-2.0.0-full.nupkg', browser_download_url: 'https://example.com/2.0.0/warewoolf-2.0.0-full.nupkg' }
  ] }) });
  asPlatform(t, { platform: 'win32', arch: 'x64' });
  const { getUpdates } = freshUpdates();

  const latest = await new Promise(function(resolve){ getUpdates('1.0.0', resolve); });

  assert.strictEqual(latest.downloadInfo.name, 'warewoolf_2.0.0_Windows_x64.exe');
});

test('getUpdates regression: leaves downloadInfo undefined instead of throwing on an unsupported platform/arch combo', async function(t){
  mockReleaseResponse(t, { body: releaseJson('v2.0.0') });
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const origArch = Object.getOwnPropertyDescriptor(process, 'arch');
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
  t.after(function(){
    Object.defineProperty(process, 'platform', origPlatform);
    Object.defineProperty(process, 'arch', origArch);
  });
  const { getUpdates } = freshUpdates();

  const latest = await new Promise(function(resolve){ getUpdates('1.0.0', resolve); });
  assert.ok(latest, 'an update is still available even without a matching binary');
  assert.strictEqual(latest.downloadInfo, undefined);
});

//---------------------------------------------------------------------------
// downloadUpdate
//---------------------------------------------------------------------------

//Phase 9c: what "already downloaded" means. It used to mean "fs.existsSync says something is
//there", which vouched any file the renderer had written; it now means "this session already
//downloaded to this path", which is all the shortcut was ever worth. A file the app did not put
//there is downloaded over instead of trusted.
test('downloadUpdate skips the network on a second call for a path this session already downloaded', async function(t){
  const dir = freshTempDir(t);
  const calls = mockHttpsGetSequence(t, [
    { statusCode: 200, body: 'the real asset' },
    { statusCode: 200, body: 'should not be needed' }
  ]);
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  t.after(function(){ Object.defineProperty(process, 'platform', origPlatform); });
  const { downloadUpdate } = freshUpdates({ paths: { downloads: dir } });

  const first = await new Promise(function(resolve){
    downloadUpdate({ name: 'warewoolf_2.0.0_amd64.deb', url: assetUrl('warewoolf_2.0.0_amd64.deb') }, resolve);
  });
  const second = await new Promise(function(resolve){
    downloadUpdate({ name: 'warewoolf_2.0.0_amd64.deb', url: assetUrl('warewoolf_2.0.0_amd64.deb') }, resolve);
  });

  assert.strictEqual(second, first);
  assert.strictEqual(calls.length, 1);
});

//The renderer cannot name the destination any more, which is the whole of the fix - so this asserts
//the negative directly, at the level updates.js actually calls: whatever comes back is somewhere
//this file never mentioned.
test('downloadUpdate hands back a path the renderer did not compose', async function(t){
  const dir = freshTempDir(t);
  mockHttpsGetSequence(t, [{ statusCode: 200, body: 'binary-content-stand-in' }]);
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  t.after(function(){ Object.defineProperty(process, 'platform', origPlatform); });
  const { downloadUpdate } = freshUpdates({ paths: { downloads: dir } });

  const filePath = await new Promise(function(resolve){
    downloadUpdate({ name: 'warewoolf_2.0.0_amd64.deb', url: assetUrl('warewoolf_2.0.0_amd64.deb') }, resolve);
  });
  t.after(function(){ fs.rmSync(path.dirname(filePath), { recursive: true, force: true }); });

  assert.strictEqual(filePath.indexOf(dir), -1, 'linux downloads do not land in the downloads directory');
  assert.ok(path.dirname(filePath).includes('warewoolf-update-'), filePath + ' should be in a directory the backing made');
});

//Regression: fs was used throughout this function (existsSync/createWriteStream/unlink) but
//never required, so this whole path threw "ReferenceError: fs is not defined" as soon as it ran.
test('downloadUpdate regression: downloads the asset and writes it to disk', async function(t){
  const calls = mockHttpsGetSequence(t, [{ statusCode: 200, body: 'binary-content-stand-in' }]);
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  t.after(function(){ Object.defineProperty(process, 'platform', origPlatform); });
  const { downloadUpdate } = freshUpdates();

  const filePath = await new Promise(function(resolve){
    downloadUpdate(
      { name: 'warewoolf_2.0.0_amd64.deb', url: assetUrl('warewoolf_2.0.0_amd64.deb') },
      resolve
    );
  });
  t.after(function(){ fs.rmSync(path.dirname(filePath), { recursive: true, force: true }); });

  assert.strictEqual(path.basename(filePath), 'warewoolf_2.0.0_amd64.deb');
  assert.strictEqual(fs.readFileSync(filePath, 'utf8'), 'binary-content-stand-in');
  assert.deepStrictEqual(calls, [assetUrl('warewoolf_2.0.0_amd64.deb')]);
});

//Still the downloads folder off linux, and still for the reason the About panel's own message gives
//- the writer goes and runs it. The difference is that the directory now comes from the app paths
//the main process already holds, not from an argument this file passed in.
test('downloadUpdate uses the downloads directory instead of temp on non-linux platforms', async function(t){
  const dir = freshTempDir(t);
  mockHttpsGetSequence(t, [{ statusCode: 200, body: 'windows-binary' }]);
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  t.after(function(){ Object.defineProperty(process, 'platform', origPlatform); });
  const { downloadUpdate } = freshUpdates({ paths: { downloads: dir } });

  const filePath = await new Promise(function(resolve){
    downloadUpdate(
      { name: 'warewoolf_2.0.0_Windows_x64.zip', url: assetUrl('warewoolf_2.0.0_Windows_x64.zip') },
      resolve
    );
  });

  assert.strictEqual(filePath, dir.replaceAll('\\', '/') + '/warewoolf_2.0.0_Windows_x64.zip');
  assert.strictEqual(fs.readFileSync(filePath, 'utf8'), 'windows-binary');
});

//End to end at this level: a URL that is not a release asset on this project's repo never reaches
//the network, and the writer is told through the error log rather than by a download appearing.
test('downloadUpdate refuses a download URL that is not a release asset on this project\'s repo', async function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  const calls = mockHttpsGetSequence(t, []);
  const { downloadUpdate } = freshUpdates();

  let called = false;
  downloadUpdate({ name: 'pkg.deb', url: 'https://evil.example.com/pkg.deb' }, function(){ called = true; });

  await new Promise(function(resolve){ setTimeout(resolve, 20); });

  assert.strictEqual(called, false);
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

test('downloadUpdate follows a redirect to the real asset location', async function(t){
  const dir = freshTempDir(t);
  const calls = mockHttpsGetSequence(t, [
    { statusCode: 302, headers: { location: 'https://cdn.example.com/real-asset.deb' } },
    { statusCode: 200, body: 'redirected-content' }
  ]);
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  t.after(function(){ Object.defineProperty(process, 'platform', origPlatform); });
  const { downloadUpdate } = freshUpdates();
  //The redirect target is deliberately not on github.com: only the first URL is checked, because
  //the redirect is chosen by the host that answered it.

  const filePath = await new Promise(function(resolve){
    downloadUpdate(
      { name: 'warewoolf_2.0.0_amd64.deb', url: assetUrl('warewoolf_2.0.0_amd64.deb') },
      resolve
    );
  });
  t.after(function(){ fs.rmSync(path.dirname(filePath), { recursive: true, force: true }); });

  assert.deepStrictEqual(calls, [assetUrl('warewoolf_2.0.0_amd64.deb'), 'https://cdn.example.com/real-asset.deb']);
  assert.strictEqual(fs.readFileSync(filePath, 'utf8'), 'redirected-content');
});

test('downloadUpdate regression: removes the partial file and never calls back when the server responds with an error status', async function(t){
  const dir = freshTempDir(t);
  mockHttpsGetSequence(t, [{ statusCode: 404 }]);
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  //win32 so the destination is the injected downloads directory and this test can look at it.
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  t.after(function(){ Object.defineProperty(process, 'platform', origPlatform); });
  const { downloadUpdate } = freshUpdates({ paths: { downloads: dir } });

  let called = false;
  downloadUpdate({ name: 'missing.deb', url: assetUrl('missing.deb') }, function(){ called = true; });

  await new Promise(function(resolve){ setTimeout(resolve, 50); });

  assert.strictEqual(called, false);
  assert.strictEqual(fs.existsSync(dir + '/missing.deb'), false);
});

test('downloadUpdate regression: removes the partial file when the download request itself errors', async function(t){
  const dir = freshTempDir(t);
  mockHttpsGetSequence(t, [{ triggerError: new Error('socket hang up') }]);
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  t.after(function(){ Object.defineProperty(process, 'platform', origPlatform); });
  const { downloadUpdate } = freshUpdates({ paths: { downloads: dir } });

  let called = false;
  downloadUpdate({ name: 'flaky.deb', url: assetUrl('flaky.deb') }, function(){ called = true; });

  await new Promise(function(resolve){ setTimeout(resolve, 50); });

  assert.strictEqual(called, false);
  assert.strictEqual(fs.existsSync(dir + '/flaky.deb'), false);
});

//Regression: extractUpdateDownloadInfo returning undefined for an unsupported platform used to
//be passed straight through to downloadUpdate, which then crashed dereferencing
//downloadInfo.name.
test('downloadUpdate regression: logs and does nothing instead of crashing when no compatible binary was found', function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  const { downloadUpdate: freshDownloadUpdate } = freshUpdates();

  let called = false;
  assert.doesNotThrow(function(){
    freshDownloadUpdate(undefined, function(){ called = true; });
  });

  assert.strictEqual(called, false);
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

//---------------------------------------------------------------------------
// installUpdate
//---------------------------------------------------------------------------

//Regression: installUpdate used to build ' sudo -S <<< "<pass>" apt install <filePath>' as one
//string and run it through /bin/bash, so a filePath (or password) containing shell
//metacharacters could inject arbitrary commands. It must now be spawned as an argv array with
//no shell - and, as of Phase 9c, with a `--` terminator, so a path cannot be read as an apt option
//either. The argv array answers shell injection; only the `--` answers argument injection.
test('installUpdate regression: runs sudo/apt via spawn with the file path as a separate argv element after a "--", instead of a shell string', async function(t){
  //spawn must be mocked before freshUpdates() reconstructs the standing platform instance -
  //createNodeBacking() resolves child_process.spawn once, at construction, the same ordering
  //requirement platform-node.js's https/nodemailer seams have (see the file-level comment on
  //freshUpdates() above). vouchedPath itself never touches spawn - it only downloads.
  let capturedCommand, capturedArgs, capturedOptions, fakeChild;
  t.mock.method(child_process, 'spawn', function(command, args, options){
    capturedCommand = command;
    capturedArgs = args;
    capturedOptions = options;
    fakeChild = makeFakeChild();
    return fakeChild;
  });

  const { downloadUpdate, installUpdate } = freshUpdates({ httpsGet: installerBytes() });
  const filePath = await vouchedPath(t, downloadUpdate, 'pkg.deb');

  installUpdate('secret', filePath, { innerText: '' });
  //platform.installUpdate() crosses createPlatform's Promise wrapper, so the backing's spawn call
  //lands one microtask after installUpdate() returns rather than synchronously within it.
  await flushMicrotask();

  assert.strictEqual(capturedCommand, 'sudo');
  assert.deepStrictEqual(capturedArgs, ['-S', 'apt', 'install', '--', filePath]);
  assert.ok(!capturedOptions || !capturedOptions.shell, 'spawn must not run the command through a shell');

  //Let installUpdate's own promise settle rather than leaving it dangling past the test's end.
  fakeChild.emit('close', 0);
  await new Promise(function(resolve){ setImmediate(resolve); });
});

//The other half of the same worry, and the reason the argv shape above is no longer the only
//defence: a hostile asset filename can no longer become a path at all. The name is taken off the
//release URL's last segment and checked against an allowlist, so the shell-metacharacter case this
//file's original regression was written for is refused before anything is downloaded.
test('installUpdate regression: an asset name full of shell metacharacters never becomes a downloaded path', async function(t){
  const logErrorMock = t.mock.method(errorLog, 'logError', function(){});
  let spawnCalled = false;
  t.mock.method(child_process, 'spawn', function(){
    spawnCalled = true;
    return makeFakeChild();
  });

  const dangerousName = 'some pkg $(touch INJECTED).deb';
  const { downloadUpdate } = freshUpdates({ httpsGet: installerBytes() });

  let called = false;
  downloadUpdate({ name: dangerousName, url: assetUrl(encodeURIComponent(dangerousName)) }, function(){ called = true; });

  await new Promise(function(resolve){ setTimeout(resolve, 20); });

  assert.strictEqual(called, false, 'nothing should have been downloaded');
  assert.strictEqual(spawnCalled, false);
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

//Regression: the sudo password was interpolated straight into the spawned command string,
//so it was briefly visible to other local users via `ps`. It must be written to the child's
//stdin instead.
test('installUpdate regression: writes the password to the child\'s stdin instead of embedding it in argv', async function(t){
  let capturedArgs;
  let fakeChild;
  t.mock.method(child_process, 'spawn', function(command, args){
    capturedArgs = args;
    fakeChild = makeFakeChild();
    return fakeChild;
  });

  const { downloadUpdate, installUpdate } = freshUpdates({ httpsGet: installerBytes() });
  const filePath = await vouchedPath(t, downloadUpdate, 'pkg.deb');

  const dangerousPass = 'p"a$s\'w`ord; rm -rf /; #';
  installUpdate(dangerousPass, filePath, { innerText: '' });
  await flushMicrotask();

  assert.ok(
    !capturedArgs.some(function(a){ return a.includes(dangerousPass); }),
    'the password must never appear in the spawned argv'
  );
  assert.strictEqual(fakeChild.stdinChunks.join(''), dangerousPass + '\n');

  fakeChild.emit('close', 0);
  await new Promise(function(resolve){ setImmediate(resolve); });
});

//The guard installUpdate exists to enforce: sudo apt install must never run against a path the
//caller merely names. A path this backing did not itself produce via downloadUpdate is refused
//before spawn is ever called, regardless of how plausible it looks.
test('installUpdate regression: refuses a path it did not itself download, without spawning sudo', async function(t){
  const { installUpdate } = freshUpdates();
  let spawnCalled = false;
  t.mock.method(child_process, 'spawn', function(){
    spawnCalled = true;
    return makeFakeChild();
  });

  const statusElement = { innerText: '' };
  installUpdate('secret', '/tmp/some-other-pkg.deb', statusElement, function(){});

  await new Promise(function(resolve){ setTimeout(resolve, 20); });

  assert.strictEqual(spawnCalled, false, 'sudo must never be spawned for an unvouched path');
  assert.match(statusElement.innerText, /not produced by this session/);
});

test('installUpdate relays the final outcome to the status element when the process closes successfully', async function(t){
  let fakeChild;
  t.mock.method(child_process, 'spawn', function(){
    fakeChild = makeFakeChild();
    return fakeChild;
  });

  const { downloadUpdate, installUpdate } = freshUpdates({ httpsGet: installerBytes() });
  const filePath = await vouchedPath(t, downloadUpdate, 'pkg.deb');

  const statusElement = { innerText: '' };
  installUpdate('secret', filePath, statusElement);
  assert.strictEqual(statusElement.innerText, 'Installing...');
  await flushMicrotask();

  fakeChild.emit('close', 0);
  await new Promise(function(resolve){ setImmediate(resolve); });

  assert.ok(statusElement.innerText.includes('Installation Finished! Reboot to complete.'));
});

//Regression: the 'close' handler used to unconditionally append "Installation Finished! Reboot
//to complete." no matter the exit code, so a failed install (bad password, apt error, etc.)
//still ended with a success message layered on top of the error text already shown.
test('installUpdate regression: reports failure instead of a false success message when the process exits with a non-zero code', async function(t){
  let fakeChild;
  t.mock.method(child_process, 'spawn', function(){
    fakeChild = makeFakeChild();
    return fakeChild;
  });

  const { downloadUpdate, installUpdate } = freshUpdates({ httpsGet: installerBytes() });
  const filePath = await vouchedPath(t, downloadUpdate, 'pkg.deb');

  const statusElement = { innerText: '' };
  installUpdate('wrong-password', filePath, statusElement);
  await flushMicrotask();

  fakeChild.stderr.emit('data', 'Sorry, try again.');
  fakeChild.emit('close', 1);
  await new Promise(function(resolve){ setImmediate(resolve); });

  assert.ok(!statusElement.innerText.includes('Installation Finished!'), 'must not claim success on a non-zero exit code');
  assert.match(statusElement.innerText, /failed/);
  assert.match(statusElement.innerText, /Sorry, try again\./);
});

//Regression: installUpdate had no way to tell its caller whether the install succeeded, so a
//UI showing an "Install" button had no signal to re-enable it after a failure.
test('installUpdate regression: invokes the onDone callback with the process exit code', async function(t){
  let fakeChild;
  t.mock.method(child_process, 'spawn', function(){
    fakeChild = makeFakeChild();
    return fakeChild;
  });

  const { downloadUpdate, installUpdate } = freshUpdates({ httpsGet: installerBytes() });
  const filePath = await vouchedPath(t, downloadUpdate, 'pkg.deb');

  const calls = [];
  installUpdate('secret', filePath, { innerText: '' }, function(exitCode){ calls.push(exitCode); });
  await flushMicrotask();

  fakeChild.emit('close', 1);
  await new Promise(function(resolve){ setImmediate(resolve); });

  assert.deepStrictEqual(calls, [1]);
});

//---------------------------------------------------------------------------
// startWindowsUpdate / finishWindowsUpdate
//---------------------------------------------------------------------------

test('startWindowsUpdate calls startSquirrelUpdate with the tag and subscribes to both outcome events', async function(t){
  const seenTags = [];
  const { updates, bridge } = freshUpdatesWithBridge({
    platform: 'win32',
    onStartSquirrelUpdate: function(feedUrl){ seenTags.push(feedUrl); }
  });

  updates.startWindowsUpdate('v2.6.0', function(){}, function(){});
  await flushMicrotask();

  assert.deepStrictEqual(seenTags, ['https://github.com/brsloan/warewoolf/releases/download/v2.6.0']);
  assert.strictEqual(bridge.listenerCount('app-update-downloaded'), 1);
  assert.strictEqual(bridge.listenerCount('app-update-failed'), 1);
});

test('startWindowsUpdate fires onDownloaded and unsubscribes both listeners when the download finishes', async function(t){
  const { updates, bridge } = freshUpdatesWithBridge({
    platform: 'win32',
    onStartSquirrelUpdate: function(){}
  });

  let downloadedCalls = 0;
  let failedCalls = 0;
  updates.startWindowsUpdate('v2.6.0', function(){ downloadedCalls++; }, function(){ failedCalls++; });
  await flushMicrotask();

  bridge.emit('app-update-downloaded');

  assert.strictEqual(downloadedCalls, 1);
  assert.strictEqual(failedCalls, 0);
  assert.strictEqual(bridge.listenerCount('app-update-downloaded'), 0,
    'the downloaded listener must not be left behind');
  assert.strictEqual(bridge.listenerCount('app-update-failed'), 0,
    'the failed listener must not be left behind either, once either event has fired');
});

test('startWindowsUpdate fires onFailed with the message and unsubscribes both listeners when the update fails', async function(t){
  const { updates, bridge } = freshUpdatesWithBridge({
    platform: 'win32',
    onStartSquirrelUpdate: function(){}
  });

  let downloadedCalls = 0;
  const failedMessages = [];
  updates.startWindowsUpdate('v2.6.0', function(){ downloadedCalls++; }, function(message){ failedMessages.push(message); });
  await flushMicrotask();

  bridge.emit('app-update-failed', 'Update failed: network is unreachable.');

  assert.strictEqual(downloadedCalls, 0);
  assert.deepStrictEqual(failedMessages, ['Update failed: network is unreachable.']);
  assert.strictEqual(bridge.listenerCount('app-update-downloaded'), 0);
  assert.strictEqual(bridge.listenerCount('app-update-failed'), 0);
});

//Regression coverage for the seam test/fake-bridge.js's listenerCount exists to catch: a writer who
//clicks Install, hits an immediate rejection (a bad tag, or this off win32), and clicks again must
//not accumulate listeners across attempts.
test('startWindowsUpdate reports onFailed and leaves zero listeners behind when startSquirrelUpdate itself rejects', async function(t){
  const { updates, bridge } = freshUpdatesWithBridge({ platform: 'linux' });

  const failedMessages = [];
  updates.startWindowsUpdate('v2.6.0', function(){}, function(message){ failedMessages.push(message); });
  await flushMicrotask();

  assert.strictEqual(failedMessages.length, 1);
  assert.strictEqual(bridge.listenerCount('app-update-downloaded'), 0);
  assert.strictEqual(bridge.listenerCount('app-update-failed'), 0);
});

test('finishWindowsUpdate calls quitAndInstallUpdate', async function(t){
  let called = 0;
  const { updates } = freshUpdatesWithBridge({
    platform: 'win32',
    onQuitAndInstallUpdate: function(){ called++; }
  });

  updates.finishWindowsUpdate();
  await flushMicrotask();

  assert.strictEqual(called, 1);
});
