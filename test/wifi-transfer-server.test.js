const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const {
  createTransferServer, pickLanAddress, isPrivateIpv4, sameSubnet, cleanUploadName,
  MAX_UPLOAD_BYTES, MAX_WRONG_CODES
} = require('../src/components/controllers/wifi-transfer-server');

//A real server on the loopback interface. chooseAddress stands in for the deck's Wi-Fi address -
//127.0.0.1 is not a private address, so pickLanAddress would never choose it - and port 0 lets the
//OS pick, so parallel test files never collide.
function startServer(t, extra){
  var inbox = fs.mkdtempSync(path.join(os.tmpdir(), 'wwtransfer-inbox-'));
  var server = createTransferServer(Object.assign({
    inboxDir: inbox,
    chooseAddress: function(){ return { address: '127.0.0.1', netmask: '255.0.0.0' }; },
    port: 0,
    page: '<!doctype html><title>page</title>'
  }, extra || {}));
  t.after(function(){
    server.stop(null);
    fs.rmSync(inbox, { recursive: true, force: true });
  });
  return server.start().then(function(status){
    return { server: server, status: status, inbox: inbox, port: Number(status.url.split(':').pop()) };
  });
}

//`host` defaults to the one a browser pointed at the deck would send.
function request(ctx, method, urlPath, options){
  options = options || {};
  return new Promise(function(resolve, reject){
    var headers = Object.assign({ Host: '127.0.0.1:' + ctx.port }, options.headers || {});
    if(options.cookie)
      headers.Cookie = options.cookie;
    var req = http.request({ host: '127.0.0.1', port: ctx.port, method: method, path: urlPath, headers: headers }, function(res){
      var chunks = [];
      res.on('data', function(chunk){ chunks.push(chunk); });
      res.on('end', function(){
        var body = Buffer.concat(chunks);
        var json = null;
        try{ json = JSON.parse(body.toString('utf8')); } catch(err){}
        resolve({ status: res.statusCode, headers: res.headers, body: body, json: json });
      });
    });
    req.on('error', reject);
    if(options.body != null)
      req.end(options.body);
    else
      req.end();
  });
}

function pairWith(ctx, code){
  return request(ctx, 'POST', '/api/pair', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code })
  });
}

async function paired(ctx){
  var res = await pairWith(ctx, ctx.status.code);
  assert.strictEqual(res.status, 200);
  return res.headers['set-cookie'][0].split(';')[0];
}

function upload(ctx, cookie, name, content){
  return request(ctx, 'PUT', '/api/upload?name=' + encodeURIComponent(name), {
    cookie: cookie,
    headers: { 'Content-Type': 'application/octet-stream' },
    body: content
  });
}

test('pickLanAddress takes a private Wi-Fi address over wired, and nothing loopback, public or IPv6', function(){
  var interfaces = {
    lo: [{ family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: true }],
    eth0: [{ family: 'IPv4', address: '10.0.0.4', netmask: '255.255.255.0', internal: false }],
    wlan0: [
      { family: 'IPv6', address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', internal: false },
      { family: 'IPv4', address: '192.168.1.20', netmask: '255.255.255.0', internal: false }
    ]
  };
  assert.deepStrictEqual(pickLanAddress(interfaces), { address: '192.168.1.20', netmask: '255.255.255.0' });
  assert.deepStrictEqual(pickLanAddress({ eth0: interfaces.eth0 }), { address: '10.0.0.4', netmask: '255.255.255.0' });
  assert.deepStrictEqual(pickLanAddress({
    docker0: [{ family: 'IPv4', address: '172.17.0.1', netmask: '255.255.0.0', internal: false }],
    usb0: [{ family: 'IPv4', address: '192.168.7.2', netmask: '255.255.255.0', internal: false }]
  }), { address: '192.168.7.2', netmask: '255.255.255.0' }, 'a Docker bridge comes after anything real');
  assert.strictEqual(pickLanAddress({ eth0: [{ family: 'IPv4', address: '203.0.113.9', netmask: '255.255.255.0', internal: false }] }), null);
  assert.strictEqual(pickLanAddress({ lo: interfaces.lo }), null);
});

test('isPrivateIpv4 and sameSubnet', function(){
  assert.ok(isPrivateIpv4('10.1.2.3'));
  assert.ok(isPrivateIpv4('172.16.0.1'));
  assert.ok(isPrivateIpv4('172.31.255.1'));
  assert.ok(!isPrivateIpv4('172.32.0.1'));
  assert.ok(isPrivateIpv4('192.168.0.9'));
  assert.ok(!isPrivateIpv4('8.8.8.8'));
  assert.ok(!isPrivateIpv4('not an address'));
  assert.ok(sameSubnet('192.168.1.20', '192.168.1.99', '255.255.255.0'));
  assert.ok(!sameSubnet('192.168.1.20', '192.168.2.20', '255.255.255.0'));
  assert.ok(sameSubnet('10.200.1.1', '10.0.0.1', '255.0.0.0'));
});

test('cleanUploadName keeps the last path segment, lower-cases the extension, and refuses other types', function(){
  assert.strictEqual(cleanUploadName('Chapter One.DOCX'), 'Chapter One.docx');
  assert.strictEqual(cleanUploadName('../../etc/evil.txt'), 'evil.txt');
  assert.strictEqual(cleanUploadName('C:\\Users\\me\\draft.md'), 'draft.md');
  assert.strictEqual(cleanUploadName('a<b>:c?.fountain'), 'abc.fountain');
  assert.strictEqual(cleanUploadName('My Novel20260101120000.zip'), 'My Novel20260101120000.zip');
  assert.strictEqual(cleanUploadName('.bashrc'), null);
  assert.strictEqual(cleanUploadName('...txt'), null);
  assert.strictEqual(cleanUploadName('script.sh'), null);
  assert.strictEqual(cleanUploadName('noextension'), null);
  assert.strictEqual(cleanUploadName(null), null);
});

test('start reports the address and a six-digit code, and starting again changes nothing', async function(t){
  var ctx = await startServer(t);
  assert.strictEqual(ctx.status.running, true);
  assert.match(ctx.status.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(ctx.status.code, /^\d{3} \d{3}$/);
  assert.strictEqual(ctx.status.connected, false);
  assert.deepStrictEqual(ctx.status.inbox.files, []);

  var again = await ctx.server.start();
  assert.strictEqual(again.code, ctx.status.code);
  assert.strictEqual(again.url, ctx.status.url);
});

test('start refuses when the deck has no local network address', async function(t){
  var inbox = fs.mkdtempSync(path.join(os.tmpdir(), 'wwtransfer-inbox-'));
  t.after(function(){ fs.rmSync(inbox, { recursive: true, force: true }); });
  var server = createTransferServer({ inboxDir: inbox, chooseAddress: function(){ return null; }, page: 'x' });
  await assert.rejects(server.start(), function(err){
    return err.code === 'UNAVAILABLE' && /Wi-Fi Manager/.test(err.message);
  });
  assert.strictEqual(server.status().running, false);
});

test('the page is served with a strict content policy, and the API wants the code first', async function(t){
  var ctx = await startServer(t);
  var page = await request(ctx, 'GET', '/');
  assert.strictEqual(page.status, 200);
  assert.match(page.headers['content-security-policy'], /default-src 'none'/);
  assert.strictEqual(page.headers['cache-control'], 'no-store');

  var state = await request(ctx, 'GET', '/api/state');
  assert.strictEqual(state.status, 401);
});

test('a request naming another host is refused, so a rebinding page cannot use the server', async function(t){
  var ctx = await startServer(t);
  var res = await request(ctx, 'GET', '/', { headers: { Host: 'evil.example:' + ctx.port } });
  assert.strictEqual(res.status, 403);
});

test('a client outside the deck\'s subnet is refused', async function(t){
  //The server listens on 127.0.0.2 as a subnet of one, and the client connects from 127.0.0.1.
  var inbox = fs.mkdtempSync(path.join(os.tmpdir(), 'wwtransfer-inbox-'));
  t.after(function(){ fs.rmSync(inbox, { recursive: true, force: true }); });
  var outside = createTransferServer({
    inboxDir: inbox,
    chooseAddress: function(){ return { address: '127.0.0.2', netmask: '255.255.255.255' }; },
    port: 0,
    page: 'x'
  });
  var status;
  try{
    status = await outside.start();
  }
  catch(err){
    //Some systems do not route 127.0.0.2; nothing to test there.
    t.skip('127.0.0.2 is not available here');
    return;
  }
  t.after(function(){ outside.stop(null); });
  var port = Number(status.url.split(':').pop());
  var res = await new Promise(function(resolve, reject){
    var req = http.request({ host: '127.0.0.2', port: port, path: '/', localAddress: '127.0.0.1',
      headers: { Host: '127.0.0.2:' + port } }, function(response){
      response.resume();
      resolve(response.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.strictEqual(res, 403);
});

test('the right code connects one device once; the code is spent and a second device is turned away', async function(t){
  var ctx = await startServer(t);
  var res = await pairWith(ctx, ctx.status.code.replace(' ', ''));
  assert.strictEqual(res.status, 200);
  var cookie = res.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);

  var status = ctx.server.status();
  assert.strictEqual(status.connected, true);
  assert.strictEqual(status.code, null);

  var state = await request(ctx, 'GET', '/api/state', { cookie: cookie.split(';')[0] });
  assert.strictEqual(state.status, 200);
  assert.ok(state.json.accept.indexOf('docx') !== -1);

  var second = await pairWith(ctx, ctx.status.code);
  assert.strictEqual(second.status, 409);

  var forged = await request(ctx, 'GET', '/api/state', { cookie: 'warewoolf_transfer=' + 'a'.repeat(64) });
  assert.strictEqual(forged.status, 401);
});

test('a wrong code says how many tries are left, and too many switch the server off', async function(t){
  var ctx = await startServer(t);
  var wrong = ctx.status.code.replace(' ', '') === '000000' ? '111111' : '000000';

  var first = await pairWith(ctx, wrong);
  assert.strictEqual(first.status, 403);
  assert.strictEqual(first.json.triesLeft, MAX_WRONG_CODES - 1);

  for(var i = 1; i < MAX_WRONG_CODES; i++)
    await pairWith(ctx, wrong);

  await new Promise(function(resolve){ setTimeout(resolve, 50); });
  var status = ctx.server.status();
  assert.strictEqual(status.running, false);
  assert.match(status.stopReason, /wrong codes/);
});

test('an offered file downloads under its own name', async function(t){
  var ctx = await startServer(t);
  var cookie = await paired(ctx);
  var status = ctx.server.offer([{ name: 'My Novel.docx', content: Buffer.from('docx bytes') }]);
  assert.deepStrictEqual(status.offers, [{ name: 'My Novel.docx', size: 10 }]);

  var state = await request(ctx, 'GET', '/api/state', { cookie: cookie });
  var id = state.json.offers[0].id;
  var file = await request(ctx, 'GET', '/api/offers/' + id, { cookie: cookie });
  assert.strictEqual(file.status, 200);
  assert.strictEqual(file.body.toString(), 'docx bytes');
  assert.match(file.headers['content-disposition'], /attachment; filename="My Novel.docx"/);

  var unpaired = await request(ctx, 'GET', '/api/offers/' + id);
  assert.strictEqual(unpaired.status, 401);
});

test('offering a file of the same name replaces it rather than listing it twice', async function(t){
  var ctx = await startServer(t);
  ctx.server.offer([{ name: 'Book.epub', content: Buffer.from('one') }]);
  var status = ctx.server.offer([{ name: 'Book.epub', content: Buffer.from('two!') }]);
  assert.deepStrictEqual(status.offers, [{ name: 'Book.epub', size: 4 }]);
});

test('an upload lands in the inbox and never replaces a file already there', async function(t){
  var ctx = await startServer(t);
  var cookie = await paired(ctx);

  var first = await upload(ctx, cookie, 'Chapter 9.docx', 'first');
  assert.strictEqual(first.status, 201);
  assert.strictEqual(first.json.name, 'Chapter 9.docx');
  var second = await upload(ctx, cookie, 'Chapter 9.docx', 'second');
  assert.strictEqual(second.json.name, 'Chapter 9 (2).docx');

  assert.strictEqual(fs.readFileSync(path.join(ctx.inbox, 'Chapter 9.docx'), 'utf8'), 'first');
  assert.strictEqual(fs.readFileSync(path.join(ctx.inbox, 'Chapter 9 (2).docx'), 'utf8'), 'second');

  var status = ctx.server.status();
  assert.deepStrictEqual(status.received.map(function(r){ return r.name; }), ['Chapter 9.docx', 'Chapter 9 (2).docx']);
  assert.deepStrictEqual(status.inbox.files.map(function(f){ return f.name; }).sort(), ['Chapter 9 (2).docx', 'Chapter 9.docx']);
  assert.deepStrictEqual(fs.readdirSync(ctx.inbox).filter(function(n){ return n.charAt(0) === '.'; }), []);
});

test('an upload is refused without the cookie, for a type Import cannot read, and over the size limit', async function(t){
  var ctx = await startServer(t);
  var cookie = await paired(ctx);

  var noCookie = await upload(ctx, null, 'a.txt', 'x');
  assert.strictEqual(noCookie.status, 401);

  var badType = await upload(ctx, cookie, 'run-me.sh', 'x');
  assert.strictEqual(badType.status, 415);

  var tooBig = await new Promise(function(resolve, reject){
    var req = http.request({ host: '127.0.0.1', port: ctx.port, method: 'PUT', path: '/api/upload?name=big.txt',
      headers: { Host: '127.0.0.1:' + ctx.port, Cookie: cookie, 'Content-Length': MAX_UPLOAD_BYTES + 1 } }, function(res){
      res.resume();
      resolve(res.statusCode);
      req.destroy();
    });
    req.on('error', function(){});
    req.flushHeaders();
  });
  assert.strictEqual(tooBig, 413);
  assert.deepStrictEqual(fs.readdirSync(ctx.inbox), []);
});

test('the server switches itself off after the idle limit, and says why', async function(t){
  var ctx = await startServer(t, { idleLimitMs: 40 });
  await new Promise(function(resolve){ setTimeout(resolve, 120); });
  var status = ctx.server.status();
  assert.strictEqual(status.running, false);
  assert.match(status.stopReason, /ten minutes/);
  assert.strictEqual(status.code, null);
});

test('stopping takes the offers down, and the inbox outlives it', async function(t){
  var ctx = await startServer(t);
  var cookie = await paired(ctx);
  await upload(ctx, cookie, 'notes.md', 'keep me');
  ctx.server.offer([{ name: 'x.txt', content: Buffer.from('x') }]);

  ctx.server.stop(null);
  var status = ctx.server.status();
  assert.strictEqual(status.running, false);
  assert.strictEqual(status.stopReason, null);
  assert.deepStrictEqual(status.offers, []);
  assert.deepStrictEqual(status.inbox.files.map(function(f){ return f.name; }), ['notes.md']);
  assert.throws(function(){ ctx.server.offer([{ name: 'y.txt', content: Buffer.from('y') }]); }, /not switched on/);
});

test('a half-written upload left by a crash is swept at the next start and never listed', async function(t){
  var inbox = fs.mkdtempSync(path.join(os.tmpdir(), 'wwtransfer-inbox-'));
  fs.writeFileSync(path.join(inbox, '.partial-deadbeef'), 'half');
  fs.writeFileSync(path.join(inbox, 'kept.txt'), 'whole');
  var server = createTransferServer({
    inboxDir: inbox,
    chooseAddress: function(){ return { address: '127.0.0.1', netmask: '255.0.0.0' }; },
    port: 0,
    page: 'x'
  });
  t.after(function(){
    server.stop(null);
    fs.rmSync(inbox, { recursive: true, force: true });
  });
  assert.deepStrictEqual(server.status().inbox.files.map(function(f){ return f.name; }), ['kept.txt']);
  await server.start();
  assert.deepStrictEqual(fs.readdirSync(inbox), ['kept.txt']);
});
