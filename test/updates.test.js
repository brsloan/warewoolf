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
const updatesPath = require.resolve('../src/components/controllers/updates');
const { getUpdates, downloadUpdate, installUpdate } = require(updatesPath);

//updates.js destructures `spawn` from child_process and `logError` from error-log.js at
//require-time, so any test that mocks either of those must re-require this module afterward
//for the fresh destructure to see the mock - same reasoning as battery-monitor.test.js.
function freshUpdates(){
  delete require.cache[updatesPath];
  return require(updatesPath);
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
  errorLog.setLogDirectory(tempDir());
});

//process.platform/process.arch are read at call-time by updates.js (not captured at require
//time), so overriding the real properties for the duration of a test is enough - no fresh
//require needed.
function withPlatform(t, platform, arch){
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const origArch = Object.getOwnPropertyDescriptor(process, 'arch');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  Object.defineProperty(process, 'arch', { value: arch, configurable: true });
  t.after(function(){
    Object.defineProperty(process, 'platform', origPlatform);
    Object.defineProperty(process, 'arch', origArch);
  });
}

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
      { name: 'warewoolf_' + v + '_MacOS_AppleSilicon.zip', browser_download_url: 'https://example.com/' + v + '/mac-arm.zip' }
    ]
  }, overrides));
}

//Mocks the single https.request call fetchLatestReleaseData makes to the GitHub API.
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

//Mocks the sequence of https.get calls downloadRequest makes (more than one entry simulates
//following a redirect). Returns the list of URLs actually requested, in order.
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

//---------------------------------------------------------------------------
// getUpdates
//---------------------------------------------------------------------------

test('getUpdates reports the release info when a newer version is available', async function(t){
  mockReleaseResponse(t, { body: releaseJson('v2.0.0') });
  withPlatform(t, 'linux', 'x64');

  const latest = await new Promise(function(resolve){ getUpdates('1.0.0', resolve); });

  assert.ok(latest);
  assert.strictEqual(latest.tag, 'v2.0.0');
  assert.strictEqual(latest.downloadInfo.name, 'warewoolf_2.0.0_amd64.deb');
});

test('getUpdates reports null when already on the latest version', async function(t){
  mockReleaseResponse(t, { body: releaseJson('v1.0.0') });

  const [latest, err] = await new Promise(function(resolve){
    getUpdates('1.0.0', function(latest, err){ resolve([latest, err]); });
  });
  assert.strictEqual(latest, null);
  assert.ok(!err, 'a genuine "no update" result must not be reported as a failed check');
});

test('getUpdates reports null when the installed version is already newer than the latest release', async function(t){
  mockReleaseResponse(t, { body: releaseJson('v1.0.0') });

  const latest = await new Promise(function(resolve){ getUpdates('2.0.0', resolve); });
  assert.strictEqual(latest, null);
});

test('getUpdates regression: a higher patch version alone is reported as an available update', async function(t){
  mockReleaseResponse(t, { body: releaseJson('v1.2.3') });

  const latest = await new Promise(function(resolve){ getUpdates('1.2.2', resolve); });
  assert.ok(latest, 'a higher patch version should be reported as available');
});

test('getUpdates regression: a lower minor version is not reported as available even with a higher patch', async function(t){
  mockReleaseResponse(t, { body: releaseJson('v1.1.9') });

  const latest = await new Promise(function(resolve){ getUpdates('1.2.0', resolve); });
  assert.strictEqual(latest, null);
});

//Regression: a GitHub API error response ({"message": "..."} with no "assets") used to throw
//uncaught inside packageReleaseData's forEach instead of being reported as "no update".
test('getUpdates regression: reports null instead of throwing when GitHub responds with a non-200 status', async function(t){
  mockReleaseResponse(t, { statusCode: 403, body: JSON.stringify({ message: 'API rate limit exceeded' }) });

  const latest = await new Promise(function(resolve){ getUpdates('1.0.0', resolve); });
  assert.strictEqual(latest, null);
});

//Regression: JSON.parse on a non-JSON body (proxy error page, truncated response, etc.) used to
//throw uncaught inside the 'end' handler with nothing to catch it.
test('getUpdates regression: reports null instead of throwing when the response body is not valid JSON', async function(t){
  mockReleaseResponse(t, { statusCode: 200, body: '<html>not json</html>' });

  const latest = await new Promise(function(resolve){ getUpdates('1.0.0', resolve); });
  assert.strictEqual(latest, null);
});

//Regression: a request-level network error only called logError, never the getUpdates
//callback - the caller (the "Checking..." button) would hang forever.
test('getUpdates regression: reports null instead of hanging forever when the request errors', async function(t){
  mockReleaseResponse(t, { triggerError: new Error('ENOTFOUND api.github.com') });

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

  const [latest, err] = await new Promise(function(resolve){
    getUpdates('1.0.0', function(latest, err){ resolve([latest, err]); });
  });
  assert.strictEqual(latest, null);
  assert.ok(err instanceof Error);
});

test('getUpdates regression: reports an error instead of a bare null when the response body is not valid JSON', async function(t){
  mockReleaseResponse(t, { statusCode: 200, body: '<html>not json</html>' });

  const [latest, err] = await new Promise(function(resolve){
    getUpdates('1.0.0', function(latest, err){ resolve([latest, err]); });
  });
  assert.strictEqual(latest, null);
  assert.ok(err instanceof Error);
});

test('getUpdates regression: reports an error instead of a bare null for an unexpected release data shape', async function(t){
  mockReleaseResponse(t, { statusCode: 200, body: JSON.stringify({ no: 'assets here' }) });

  const [latest, err] = await new Promise(function(resolve){
    getUpdates('1.0.0', function(latest, err){ resolve([latest, err]); });
  });
  assert.strictEqual(latest, null);
  assert.ok(err instanceof Error);
});

test('getUpdates regression: reports an error instead of a bare null when the request errors', async function(t){
  mockReleaseResponse(t, { triggerError: new Error('ENOTFOUND api.github.com') });

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

  const latest = await new Promise(function(resolve){ getUpdates('1.0.0', resolve); });
  assert.strictEqual(latest, null);
});

//Regression: fetchLatestReleaseData had no request timeout, so a hung connection blocked the
//update check indefinitely.
test('getUpdates regression: sets a timeout on the release-check request so it cannot hang forever', function(t){
  let capturedOptions;
  t.mock.method(https, 'request', function(options){
    capturedOptions = options;
    const req = new EventEmitter();
    req.end = function(){};
    return req;
  });

  getUpdates('1.0.0', function(){});

  assert.ok(capturedOptions.timeout > 0);
});

test('getUpdates regression: destroys the request once it times out', function(t){
  let capturedReq;
  t.mock.method(https, 'request', function(options, callback){
    const req = new EventEmitter();
    req.end = function(){};
    req.destroy = function(err){ req.destroyedWith = err; };
    capturedReq = req;
    return req;
  });

  getUpdates('1.0.0', function(){});
  capturedReq.emit('timeout');

  assert.ok(capturedReq.destroyedWith instanceof Error);
});

[
  { platform: 'linux', arch: 'x64', expected: 'amd64' },
  { platform: 'linux', arch: 'arm64', expected: 'arm64' },
  { platform: 'win32', arch: 'x64', expected: 'Windows_x64' },
  { platform: 'darwin', arch: 'x64', expected: 'MacOS_Intel' },
  { platform: 'darwin', arch: 'arm64', expected: 'MacOS_AppleSilicon' }
].forEach(function(c){
  test('getUpdates selects the ' + c.expected + ' binary on ' + c.platform + '/' + c.arch, async function(t){
    mockReleaseResponse(t, { body: releaseJson('v2.0.0') });
    withPlatform(t, c.platform, c.arch);

    const latest = await new Promise(function(resolve){ getUpdates('1.0.0', resolve); });
    assert.ok(latest.downloadInfo, 'expected a matching binary to be selected');
    assert.ok(latest.downloadInfo.name.includes(c.expected));
  });
});

test('getUpdates regression: leaves downloadInfo undefined instead of throwing on an unsupported platform/arch combo', async function(t){
  mockReleaseResponse(t, { body: releaseJson('v2.0.0') });
  withPlatform(t, 'win32', 'arm64');

  const latest = await new Promise(function(resolve){ getUpdates('1.0.0', resolve); });
  assert.ok(latest, 'an update is still available even without a matching binary');
  assert.strictEqual(latest.downloadInfo, undefined);
});

//---------------------------------------------------------------------------
// downloadUpdate
//---------------------------------------------------------------------------

test('downloadUpdate calls back immediately without a network request when the file already exists', async function(t){
  const dir = freshTempDir(t);
  const filePath = dir + '/warewoolf_2.0.0_amd64.deb';
  fs.writeFileSync(filePath, 'already here');
  const calls = mockHttpsGetSequence(t, []);
  withPlatform(t, 'linux', 'x64');

  const result = await new Promise(function(resolve){
    downloadUpdate({ temp: dir }, { name: 'warewoolf_2.0.0_amd64.deb', url: 'https://example.com/x' }, resolve);
  });

  assert.strictEqual(result, filePath);
  assert.strictEqual(calls.length, 0);
});

//Regression: fs was used throughout this function (existsSync/createWriteStream/unlink) but
//never required, so this whole path threw "ReferenceError: fs is not defined" as soon as it ran.
test('downloadUpdate regression: downloads the asset and writes it to disk', async function(t){
  const dir = freshTempDir(t);
  const calls = mockHttpsGetSequence(t, [{ statusCode: 200, body: 'binary-content-stand-in' }]);
  withPlatform(t, 'linux', 'x64');

  const filePath = await new Promise(function(resolve){
    downloadUpdate(
      { temp: dir },
      { name: 'warewoolf_2.0.0_amd64.deb', url: 'https://example.com/release/amd64.deb' },
      resolve
    );
  });

  assert.strictEqual(filePath, dir + '/warewoolf_2.0.0_amd64.deb');
  assert.strictEqual(fs.readFileSync(filePath, 'utf8'), 'binary-content-stand-in');
  assert.deepStrictEqual(calls, ['https://example.com/release/amd64.deb']);
});

test('downloadUpdate uses the downloads directory instead of temp on non-linux platforms', async function(t){
  const dir = freshTempDir(t);
  mockHttpsGetSequence(t, [{ statusCode: 200, body: 'windows-binary' }]);
  withPlatform(t, 'win32', 'x64');

  const filePath = await new Promise(function(resolve){
    downloadUpdate(
      { downloads: dir },
      { name: 'warewoolf_2.0.0_Windows_x64.zip', url: 'https://example.com/release/win.zip' },
      resolve
    );
  });

  assert.strictEqual(filePath, dir + '/warewoolf_2.0.0_Windows_x64.zip');
});

test('downloadUpdate follows a redirect to the real asset location', async function(t){
  const dir = freshTempDir(t);
  const calls = mockHttpsGetSequence(t, [
    { statusCode: 302, headers: { location: 'https://cdn.example.com/real-asset.deb' } },
    { statusCode: 200, body: 'redirected-content' }
  ]);
  withPlatform(t, 'linux', 'x64');

  const filePath = await new Promise(function(resolve){
    downloadUpdate(
      { temp: dir },
      { name: 'warewoolf_2.0.0_amd64.deb', url: 'https://github.com/release/amd64.deb' },
      resolve
    );
  });

  assert.deepStrictEqual(calls, ['https://github.com/release/amd64.deb', 'https://cdn.example.com/real-asset.deb']);
  assert.strictEqual(fs.readFileSync(filePath, 'utf8'), 'redirected-content');
});

test('downloadUpdate regression: removes the partial file and never calls back when the server responds with an error status', async function(t){
  const dir = freshTempDir(t);
  mockHttpsGetSequence(t, [{ statusCode: 404 }]);
  withPlatform(t, 'linux', 'x64');

  let called = false;
  downloadUpdate({ temp: dir }, { name: 'missing.deb', url: 'https://example.com/missing.deb' }, function(){ called = true; });

  await new Promise(function(resolve){ setTimeout(resolve, 50); });

  assert.strictEqual(called, false);
  assert.strictEqual(fs.existsSync(dir + '/missing.deb'), false);
});

test('downloadUpdate regression: removes the partial file when the download request itself errors', async function(t){
  const dir = freshTempDir(t);
  mockHttpsGetSequence(t, [{ triggerError: new Error('socket hang up') }]);
  withPlatform(t, 'linux', 'x64');

  let called = false;
  downloadUpdate({ temp: dir }, { name: 'flaky.deb', url: 'https://example.com/flaky.deb' }, function(){ called = true; });

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
    freshDownloadUpdate({ temp: tempDir() }, undefined, function(){ called = true; });
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
//no shell.
test('installUpdate regression: runs sudo/apt via spawn with the file path as a separate argv element instead of a shell string', function(t){
  let capturedCommand, capturedArgs, capturedOptions;
  t.mock.method(child_process, 'spawn', function(command, args, options){
    capturedCommand = command;
    capturedArgs = args;
    capturedOptions = options;
    return makeFakeChild();
  });

  const { installUpdate: freshInstallUpdate } = freshUpdates();
  const dangerousPath = '/tmp/some pkg $(touch /tmp/INJECTED).deb';
  freshInstallUpdate('secret', dangerousPath, { innerText: '' });

  assert.strictEqual(capturedCommand, 'sudo');
  assert.deepStrictEqual(capturedArgs, ['-S', 'apt', 'install', dangerousPath]);
  assert.ok(!capturedOptions || !capturedOptions.shell, 'spawn must not run the command through a shell');
});

//Regression: the sudo password was interpolated straight into the spawned command string,
//so it was briefly visible to other local users via `ps`. It must be written to the child's
//stdin instead.
test('installUpdate regression: writes the password to the child\'s stdin instead of embedding it in argv', function(t){
  let capturedArgs;
  let fakeChild;
  t.mock.method(child_process, 'spawn', function(command, args){
    capturedArgs = args;
    fakeChild = makeFakeChild();
    return fakeChild;
  });

  const { installUpdate: freshInstallUpdate } = freshUpdates();
  const dangerousPass = 'p"a$s\'w`ord; rm -rf /; #';
  freshInstallUpdate(dangerousPass, '/tmp/pkg.deb', { innerText: '' });

  assert.ok(
    !capturedArgs.some(function(a){ return a.includes(dangerousPass); }),
    'the password must never appear in the spawned argv'
  );
  assert.strictEqual(fakeChild.stdinChunks.join(''), dangerousPass + '\n');
});

test('installUpdate relays stdout/stderr to the status element and appends a completion message when the process closes', function(t){
  let fakeChild;
  t.mock.method(child_process, 'spawn', function(){
    fakeChild = makeFakeChild();
    return fakeChild;
  });

  const { installUpdate: freshInstallUpdate } = freshUpdates();
  const statusElement = { innerText: '' };
  freshInstallUpdate('secret', '/tmp/pkg.deb', statusElement);

  fakeChild.stdout.emit('data', 'Unpacking warewoolf...');
  assert.strictEqual(statusElement.innerText, 'Unpacking warewoolf...');

  fakeChild.stderr.emit('data', 'dependency problems');
  assert.strictEqual(statusElement.innerText, 'Error: dependency problems');

  fakeChild.emit('close', 0);
  assert.ok(statusElement.innerText.includes('Installation Finished! Reboot to complete.'));
});
