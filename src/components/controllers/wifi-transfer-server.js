//Wi-Fi Transfer's web server: a page on the local network that hands files from the deck to a phone
//or laptop, and takes files from it into an inbox on the deck. Main-process only - platform-node.js
//holds one of these and the four wifiTransfer* commands drive it. Nothing here imports anything:
//a file that arrives is only written to the inbox, and the writer chooses on the deck what to do
//with it (wifi-transfer_display.js).
//
//What keeps it local and short-lived, since anything on the same network can reach the port:
//
//  - It listens on the deck's private (RFC 1918) address only, and answers only clients on that
//    same subnet, asking for that address by name (the Host check is what stops a web page somewhere
//    else using DNS rebinding to reach it through the phone's browser).
//  - A six-digit code shown on the deck connects one device, once. The code is then spent, and the
//    device holds a random token in an HttpOnly, SameSite=Strict cookie. Five wrong codes and the
//    server switches itself off.
//  - It switches itself off after IDLE_LIMIT_MS with nothing asked of it, and the dialog switches it
//    off when it closes.
//  - An upload has to be one of the types File > Import (or Restore Backup, for a .zip) can open,
//    is capped in size, gets a cleaned-up name, and never replaces a file already in the inbox.
//
//It is plain HTTP. A self-signed certificate would make every phone show a warning page, so what
//crosses the network can be read by others on it; the help chapter says so.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const nodeCrypto = require('crypto');
const { CODES, PlatformError } = require('./platform');

//Easy to type on a phone. Taken by something else, the OS picks a port instead.
const PREFERRED_PORT = 8080;
const IDLE_LIMIT_MS = 10 * 60 * 1000;
const MAX_WRONG_CODES = 5;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
//What one session may write to the inbox altogether, so a stuck upload loop cannot fill the card.
const MAX_SESSION_BYTES = 250 * 1024 * 1024;
const MAX_JSON_BYTES = 1024;
const COOKIE_NAME = 'warewoolf_transfer';
//What Import reads, plus .zip for a project backup.
const UPLOAD_EXTENSIONS = ['docx', 'txt', 'md', 'mdfc', 'html', 'htm', 'xhtml', 'epub',
  'fountain', 'fdx', 'fadein', 'zip'];
//An upload is written under this name and only renamed once every byte is in, so the inbox never
//lists half a file. Leftovers from a crash are swept at the next start.
const PARTIAL_PREFIX = '.partial-';
const PAGE_PATH = path.join(__dirname, '..', '..', 'assets', 'wifi-transfer.html');

//The page has no outside resources and puts every name it shows in with textContent, so nothing
//but its own inline script and style, and requests back to this server, are allowed.
const PAGE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "connect-src 'self'; img-src data:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'";

function ipv4ToInt(address){
  var parts = String(address).split('.');
  if(parts.length !== 4)
    return null;
  var n = 0;
  for(var i = 0; i < 4; i++){
    if(!/^\d{1,3}$/.test(parts[i]) || Number(parts[i]) > 255)
      return null;
    n = n * 256 + Number(parts[i]);
  }
  return n;
}

function isPrivateIpv4(address){
  var n = ipv4ToInt(address);
  if(n == null)
    return false;
  var a = Math.floor(n / 16777216);
  var b = Math.floor(n / 65536) % 256;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function sameSubnet(a, b, netmask){
  var x = ipv4ToInt(a);
  var y = ipv4ToInt(b);
  var mask = ipv4ToInt(netmask);
  if(x == null || y == null || mask == null)
    return false;
  //Unsigned 32-bit AND, which JavaScript's & would turn signed.
  return ((x & mask) >>> 0) === ((y & mask) >>> 0);
}

//The deck's address on its local network, from os.networkInterfaces(): a private IPv4 address,
//Wi-Fi (wl*) first, then wired, then anything else, and last the bridges and tunnels Docker, a VPN
//or a VM add - those have private addresses too, but no phone on the Wi-Fi can reach them. null
//when there is none - no network, or only a public address, which this will not listen on.
function pickLanAddress(interfaces){
  var found = [];
  Object.keys(interfaces || {}).forEach(function(name){
    (interfaces[name] || []).forEach(function(entry){
      var ipv4 = entry.family === 'IPv4' || entry.family === 4;
      if(ipv4 && !entry.internal && isPrivateIpv4(entry.address))
        found.push({ name: name, address: entry.address, netmask: entry.netmask });
    });
  });
  function rank(entry){
    if(/^wl/.test(entry.name)) return 0;
    if(/^(eth|en)/.test(entry.name)) return 1;
    if(/^(docker|br-|virbr|veth|tun|tap|wg|zt|tailscale|vEthernet)/i.test(entry.name)) return 3;
    return 2;
  }
  found.sort(function(x, y){ return rank(x) - rank(y); });
  return found.length > 0 ? { address: found[0].address, netmask: found[0].netmask } : null;
}

//The last path segment, without anything a filesystem or the inbox listing would trip on, and with
//its extension lower-cased. null when nothing usable is left or the type is not one Import reads.
function cleanUploadName(raw){
  var name = String(raw == null ? '' : raw).split(/[\\/]/).pop();
  name = name.replace(/[\x00-\x1f\x7f-\x9f]/g, '').replace(/[<>:"|?*]/g, '').trim();
  name = name.replace(/^[.\s]+/, '');
  var dot = name.lastIndexOf('.');
  if(dot <= 0)
    return null;
  var base = name.slice(0, dot).trim().slice(0, 100);
  var ext = name.slice(dot + 1).toLowerCase();
  if(base === '' || UPLOAD_EXTENSIONS.indexOf(ext) === -1)
    return null;
  return base + '.' + ext;
}

function formatCode(code){
  return code.slice(0, 3) + ' ' + code.slice(3);
}

//`inboxDir` is where uploads land. The rest are seams for the tests: `chooseAddress` in place of
//reading the real interfaces, `port` in place of PREFERRED_PORT, `idleLimitMs`, and `page`.
function createTransferServer(options){
  var inboxDir = options.inboxDir;
  var log = options.log || function(){};
  var chooseAddress = options.chooseAddress || function(){ return pickLanAddress(os.networkInterfaces()); };
  var preferredPort = options.port == null ? PREFERRED_PORT : options.port;
  var idleLimitMs = options.idleLimitMs || IDLE_LIMIT_MS;
  var page = options.page || null;

  var server = null;
  var lan = null;
  var port = null;
  var code = null;
  var token = null;
  var wrongCodes = 0;
  var offers = [];
  var received = [];
  var sessionBytes = 0;
  var idleTimer = null;
  var stopReason = null;
  var starting = null;

  function touch(){
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function(){
      stop('Wi-Fi Transfer switched itself off after ten minutes with nothing sent.');
    }, idleLimitMs);
    if(idleTimer.unref)
      idleTimer.unref();
  }

  function start(){
    if(server != null)
      return Promise.resolve(status());
    if(starting != null)
      return starting;

    var chosen = chooseAddress();
    if(chosen == null)
      return Promise.reject(PlatformError(CODES.UNAVAILABLE,
        'This deck is not on a local network. Join a Wi-Fi network in the Wi-Fi Manager first.'));

    if(page == null)
      page = fs.readFileSync(PAGE_PATH, 'utf8');
    fs.mkdirSync(inboxDir, { recursive: true });
    sweepPartials();

    var candidate = http.createServer(handle);
    //Generous for a phone on slow Wi-Fi sending a 50 MB file, but not unbounded.
    candidate.requestTimeout = 10 * 60 * 1000;
    candidate.maxConnections = 16;

    starting = listen(candidate, chosen.address, preferredPort).then(function(boundPort){
      server = candidate;
      lan = chosen;
      port = boundPort;
      code = String(nodeCrypto.randomInt(0, 1000000)).padStart(6, '0');
      token = null;
      wrongCodes = 0;
      offers = [];
      received = [];
      sessionBytes = 0;
      stopReason = null;
      touch();
      return status();
    }).finally(function(){
      starting = null;
    });
    return starting;
  }

  function listen(candidate, address, wantedPort){
    return new Promise(function(resolve, reject){
      function onError(err){
        if(err.code === 'EADDRINUSE' && wantedPort !== 0){
          resolve(listen(candidate, address, 0));
          return;
        }
        reject(PlatformError(CODES.IO_ERROR, 'Could not start Wi-Fi Transfer: ' + err.message));
      }
      candidate.once('error', onError);
      candidate.listen(wantedPort, address, function(){
        candidate.removeListener('error', onError);
        resolve(candidate.address().port);
      });
    });
  }

  //`reason` is what the dialog shows for a stop it did not ask for; null for the writer's own.
  function stop(reason){
    clearTimeout(idleTimer);
    idleTimer = null;
    if(server != null){
      var closing = server;
      server = null;
      closing.close();
      if(typeof closing.closeAllConnections === 'function')
        closing.closeAllConnections();
      stopReason = reason || null;
    }
    code = null;
    token = null;
    offers = [];
    sweepPartials();
  }

  function status(){
    return {
      running: server != null,
      url: server == null ? null : 'http://' + lan.address + (port === 80 ? '' : ':' + port),
      code: code == null ? null : formatCode(code),
      connected: token != null,
      offers: offers.map(function(offer){ return { name: offer.name, size: offer.content.length }; }),
      received: received.slice(),
      inbox: { path: inboxDir.replace(/\\/g, '/'), files: listInbox() },
      stopReason: server == null ? stopReason : null
    };
  }

  //Replaces an offer of the same name, so offering the book again after more writing does not
  //leave two copies on the page.
  function offer(files){
    if(server == null)
      throw PlatformError(CODES.INVALID_ARGUMENT, 'Wi-Fi Transfer is not switched on.');
    files.forEach(function(file){
      offers = offers.filter(function(existing){ return existing.name !== file.name; });
      offers.push({ id: nodeCrypto.randomBytes(8).toString('hex'), name: file.name, content: file.content });
    });
    touch();
    return status();
  }

  function listInbox(){
    var entries;
    try{
      entries = fs.readdirSync(inboxDir, { withFileTypes: true });
    }
    catch(err){
      if(err.code !== 'ENOENT')
        log(err);
      return [];
    }
    return entries.filter(function(entry){
      return entry.isFile() && entry.name.charAt(0) !== '.';
    }).map(function(entry){
      var stat = fs.statSync(path.join(inboxDir, entry.name));
      return { name: entry.name, size: stat.size, modified: stat.mtime.toISOString() };
    }).sort(function(a, b){
      return a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : 0;
    });
  }

  function sweepPartials(){
    try{
      fs.readdirSync(inboxDir).forEach(function(name){
        if(name.indexOf(PARTIAL_PREFIX) === 0)
          fs.rmSync(path.join(inboxDir, name), { force: true });
      });
    }
    catch(err){
      if(err.code !== 'ENOENT')
        log(err);
    }
  }

  // --- Requests ----------------------------------------------------------------------------------

  function handle(req, res){
    try{
      if(server == null || !allowedClient(req)){
        sendJson(res, 403, { error: 'Not allowed.' });
        return;
      }

      var pathname = new URL(req.url, 'http://localhost').pathname;

      if(req.method === 'GET' && (pathname === '/' || pathname === '/index.html')){
        send(res, 200, page, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PAGE_CSP });
        return;
      }
      if(req.method === 'POST' && pathname === '/api/pair'){
        pair(req, res);
        return;
      }
      if(pathname.indexOf('/api/') === 0 && !authorized(req)){
        sendJson(res, 401, { error: 'Enter the code shown on the deck.' });
        return;
      }
      if(req.method === 'GET' && pathname === '/api/state'){
        touch();
        sendJson(res, 200, {
          offers: offers.map(function(item){ return { id: item.id, name: item.name, size: item.content.length }; }),
          received: received,
          accept: UPLOAD_EXTENSIONS,
          maxUploadBytes: MAX_UPLOAD_BYTES
        });
        return;
      }
      if(req.method === 'GET' && pathname.indexOf('/api/offers/') === 0){
        download(res, pathname.slice('/api/offers/'.length));
        return;
      }
      if(req.method === 'PUT' && pathname === '/api/upload'){
        upload(req, res, new URL(req.url, 'http://localhost').searchParams.get('name'));
        return;
      }
      sendJson(res, 404, { error: 'Not found.' });
    }
    catch(err){
      log(err);
      if(!res.headersSent)
        sendJson(res, 500, { error: 'Something went wrong on the deck.' });
    }
  }

  //Same subnet as the deck, asking for the deck's own address. A browser sends the Host it was
  //pointed at, so a page elsewhere that rebinds its own name to this address still names itself.
  function allowedClient(req){
    var remote = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    if(!sameSubnet(remote, lan.address, lan.netmask))
      return false;
    var host = req.headers.host;
    return host === lan.address + ':' + port || (port === 80 && host === lan.address);
  }

  function authorized(req){
    if(token == null)
      return false;
    var presented = readCookie(req.headers.cookie, COOKIE_NAME);
    return presented != null && safeEqual(presented, token);
  }

  function pair(req, res){
    readSmallBody(req, function(err, body){
      if(err != null){
        sendJson(res, 400, { error: 'Bad request.' });
        return;
      }
      if(token != null){
        sendJson(res, 409, { error: 'Another device is already connected. Choose New Code on the deck to connect this one instead.' });
        return;
      }
      var typed = '';
      try{
        typed = String(JSON.parse(body).code || '').replace(/\D/g, '');
      }
      catch(parseErr){
        typed = '';
      }
      if(code != null && typed.length === code.length && safeEqual(typed, code)){
        token = nodeCrypto.randomBytes(32).toString('hex');
        code = null;
        touch();
        sendJson(res, 200, { ok: true }, {
          'Set-Cookie': COOKIE_NAME + '=' + token + '; Path=/; HttpOnly; SameSite=Strict'
        });
        return;
      }
      wrongCodes++;
      if(wrongCodes >= MAX_WRONG_CODES){
        sendJson(res, 403, { error: 'Too many wrong codes. Wi-Fi Transfer has switched off on the deck.' });
        res.on('finish', function(){
          stop('Wi-Fi Transfer switched itself off after ' + MAX_WRONG_CODES + ' wrong codes.');
        });
        return;
      }
      sendJson(res, 403, { error: 'That code is not right.', triesLeft: MAX_WRONG_CODES - wrongCodes });
    });
  }

  function download(res, id){
    var item = offers.find(function(candidate){ return candidate.id === id; });
    if(item == null){
      sendJson(res, 404, { error: 'That file is no longer offered.' });
      return;
    }
    touch();
    var ascii = item.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    send(res, 200, item.content, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="' + ascii + '"; filename*=UTF-8\'\'' + encodeURIComponent(item.name)
    });
  }

  function upload(req, res, rawName){
    var name = cleanUploadName(rawName);
    if(name == null){
      drain(req);
      sendJson(res, 415, { error: 'The deck only takes files File > Import can read, or a .zip backup: ' +
        UPLOAD_EXTENSIONS.map(function(ext){ return '.' + ext; }).join(' ') });
      return;
    }
    var declared = Number(req.headers['content-length']);
    if(req.headers['content-length'] == null || !Number.isFinite(declared) || declared < 0){
      drain(req);
      sendJson(res, 411, { error: 'The upload has no length.' });
      return;
    }
    if(declared > MAX_UPLOAD_BYTES){
      drain(req);
      sendJson(res, 413, { error: name + ' is too big. The limit is ' + (MAX_UPLOAD_BYTES / 1024 / 1024) + ' MB.' });
      return;
    }
    if(sessionBytes + declared > MAX_SESSION_BYTES){
      drain(req);
      sendJson(res, 413, { error: 'That is all this session can take. Turn Wi-Fi Transfer off and on to send more.' });
      return;
    }

    touch();
    var partialPath = path.join(inboxDir, PARTIAL_PREFIX + nodeCrypto.randomBytes(8).toString('hex'));
    var out = fs.createWriteStream(partialPath, { flags: 'wx' });
    var count = 0;
    var failed = false;

    function fail(status, message, err){
      if(failed)
        return;
      failed = true;
      if(err != null)
        log(err);
      req.unpipe(out);
      out.destroy();
      fs.rm(partialPath, { force: true }, function(){});
      if(!res.headersSent)
        sendJson(res, status, { error: message }, { 'Connection': 'close' });
    }

    req.on('data', function(chunk){
      count += chunk.length;
      if(count > declared)
        fail(400, 'The upload was longer than it said.');
    });
    req.on('close', function(){
      if(!req.complete)
        fail(400, 'The upload was cut off.');
    });
    req.on('error', function(err){ fail(400, 'The upload was cut off.', err); });
    out.on('error', function(err){ fail(500, 'The deck could not save ' + name + ': ' + err.message, err); });
    out.on('close', function(){
      if(failed)
        return;
      if(count !== declared){
        fail(400, 'The upload was cut off.');
        return;
      }
      if(server == null){
        fail(503, 'Wi-Fi Transfer was switched off on the deck.');
        return;
      }
      var finalName;
      try{
        finalName = settle(partialPath, name);
      }
      catch(err){
        fail(500, 'The deck could not save ' + name + ': ' + err.message, err);
        return;
      }
      sessionBytes += count;
      received.push({ name: finalName, size: count });
      touch();
      sendJson(res, 201, { name: finalName });
    });
    req.pipe(out);
  }

  //Gives the finished upload its name, never replacing a file already there: "Draft.docx", then
  //"Draft (2).docx" and so on. A hard link fails rather than overwrites, which makes the check and
  //the claim one step; a filesystem without hard links (a FAT stick) falls back to check-then-rename.
  function settle(partialPath, name){
    var dot = name.lastIndexOf('.');
    var base = name.slice(0, dot);
    var ext = name.slice(dot);
    for(var n = 1; n < 1000; n++){
      var candidate = n === 1 ? name : base + ' (' + n + ')' + ext;
      var target = path.join(inboxDir, candidate);
      try{
        fs.linkSync(partialPath, target);
        fs.rmSync(partialPath, { force: true });
        return candidate;
      }
      catch(err){
        if(err.code === 'EEXIST')
          continue;
        if(fs.existsSync(target))
          continue;
        fs.renameSync(partialPath, target);
        return candidate;
      }
    }
    throw new Error('too many files called ' + name);
  }

  return {
    start: start,
    stop: stop,
    status: status,
    offer: offer
  };
}

// --- HTTP helpers ------------------------------------------------------------------------------

function baseHeaders(){
  return {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin'
  };
}

function send(res, statusCode, body, headers){
  var all = baseHeaders();
  Object.keys(headers || {}).forEach(function(key){ all[key] = headers[key]; });
  var bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  all['Content-Length'] = bytes.length;
  res.writeHead(statusCode, all);
  res.end(bytes);
}

function sendJson(res, statusCode, value, headers){
  var all = { 'Content-Type': 'application/json; charset=utf-8' };
  Object.keys(headers || {}).forEach(function(key){ all[key] = headers[key]; });
  send(res, statusCode, JSON.stringify(value), all);
}

function readSmallBody(req, callback){
  var chunks = [];
  var size = 0;
  var done = false;
  req.on('data', function(chunk){
    if(done)
      return;
    size += chunk.length;
    if(size > MAX_JSON_BYTES){
      done = true;
      callback(new Error('too large'));
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', function(){
    if(done)
      return;
    done = true;
    callback(null, Buffer.concat(chunks).toString('utf8'));
  });
  req.on('error', function(err){
    if(done)
      return;
    done = true;
    callback(err);
  });
}

//Reads and throws away a refused upload's body, so the refusal reaches a browser that is still
//sending rather than the connection being reset under it.
function drain(req){
  req.on('data', function(){});
  req.resume();
}

function readCookie(header, name){
  if(header == null)
    return null;
  var found = null;
  String(header).split(';').forEach(function(part){
    var eq = part.indexOf('=');
    if(eq !== -1 && part.slice(0, eq).trim() === name)
      found = part.slice(eq + 1).trim();
  });
  return found;
}

function safeEqual(a, b){
  var x = Buffer.from(String(a));
  var y = Buffer.from(String(b));
  return x.length === y.length && nodeCrypto.timingSafeEqual(x, y);
}

module.exports = {
  createTransferServer,
  pickLanAddress,
  isPrivateIpv4,
  sameSubnet,
  cleanUploadName,
  UPLOAD_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  MAX_WRONG_CODES
};
