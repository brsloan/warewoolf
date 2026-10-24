require('./quill-dom-setup');
const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const wifiTransfer = require('../src/components/controllers/wifi-transfer');
const backupProject = require('../src/components/controllers/backup-project');
const displayPath = require.resolve('../src/components/views/wifi-transfer_display');

//wifi-transfer_display.js destructures its controller functions at require-time, so the mocks only
//take effect through a fresh require - the same pattern as bluetooth-manager_display.test.js.
function freshDisplay(){
  delete require.cache[displayPath];
  return require(displayPath);
}

var INBOX = { path: '/home/me/Documents/WareWoolf Inbox', files: [
  { name: 'Chapter 9.docx', size: 2048, modified: '2026-10-24T10:00:00.000Z' },
  { name: 'My Novel20261001120000.zip', size: 4096, modified: '2026-10-23T10:00:00.000Z' }
] };

function offStatus(overrides){
  return Object.assign({
    running: false, url: null, code: null, connected: false, offers: [], received: [],
    inbox: INBOX, stopReason: null
  }, overrides || {});
}

function onStatus(overrides){
  return offStatus(Object.assign({ running: true, url: 'http://192.168.1.20:8080', code: '482 913' }, overrides || {}));
}

//`state.status` is what getTransferStatus answers, so a test can change the server under the dialog.
function mockController(t, state, overrides){
  overrides = overrides || {};
  var defaults = {
    startTransfer: function(){ state.status = onStatus(); return Promise.resolve({ status: state.status, message: null }); },
    stopTransfer: function(){ state.status = offStatus(); return Promise.resolve(null); },
    getTransferStatus: function(){ return Promise.resolve({ status: state.status, message: null }); },
    offerToPage: function(){
      state.status = onStatus({ offers: [{ name: 'My Novel.docx', size: 10 }] });
      return Promise.resolve({ status: state.status, message: 'On the page: My Novel.docx.' });
    },
    discardInboxFile: function(){ return Promise.resolve(null); }
  };
  var calls = {};
  Object.keys(defaults).forEach(function(name){
    calls[name] = [];
    var impl = overrides[name] || defaults[name];
    t.mock.method(wifiTransfer, name, function(){
      calls[name].push(Array.from(arguments));
      return impl.apply(null, arguments);
    });
  });
  return calls;
}

function settings(){
  return { emailType: 'compiled', compileType: '.docx', save: function(){} };
}

function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

function findButton(text){
  return Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent === text; });
}

function flushMicrotasks(){
  return new Promise(function(resolve){ setImmediate(resolve); });
}

function inboxTexts(){
  return Array.from(document.getElementById('wifi-transfer-inbox-select').options).map(function(o){ return o.innerText; });
}

function open(actions){
  freshDisplay()({}, settings(), {}, { docs: '/home/me/Documents' }, actions || { importFile: function(){}, openProject: function(){} });
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  //Closes whatever dialog a test left open, so its poll stops.
  var close = findButton('Close');
  if(close)
    close.onclick();
  delete require.cache[displayPath];
  delete global.window;
  delete global.document;
});

test('opens switched off, showing the inbox', async function(t){
  var state = { status: offStatus() };
  var calls = mockController(t, state);
  open();
  await flushMicrotasks();

  assert.strictEqual(document.querySelector('.popup h1').innerText, 'Wi-Fi Transfer');
  assert.strictEqual(document.getElementById('wifi-transfer-check').checked, false);
  assert.strictEqual(document.getElementById('wifi-transfer-address').innerText, '-');
  assert.deepStrictEqual(inboxTexts(), ['Chapter 9.docx (2 KB)', 'My Novel20261001120000.zip (4 KB)']);
  assert.strictEqual(calls.startTransfer.length, 0, 'nothing listens until the writer switches it on');
  assert.strictEqual(document.querySelector('.popup fieldset').disabled, true, 'nothing to offer while off');
});

test('switching on shows the address and the code, and a connected device spends the code', async function(t){
  var state = { status: offStatus() };
  var calls = mockController(t, state);
  open();
  await flushMicrotasks();

  var check = document.getElementById('wifi-transfer-check');
  check.checked = true;
  check.onclick();
  await flushMicrotasks();

  assert.strictEqual(calls.startTransfer.length, 1);
  assert.strictEqual(document.getElementById('wifi-transfer-address').innerText, 'http://192.168.1.20:8080');
  assert.strictEqual(document.getElementById('wifi-transfer-code').innerText, '482 913');
  assert.strictEqual(document.querySelector('.popup fieldset').disabled, false);

  state.status = onStatus({ code: null, connected: true });
  calls.getTransferStatus.length = 0;
  await new Promise(function(resolve){ setTimeout(resolve, 2100); });
  assert.ok(calls.getTransferStatus.length >= 1, 'the dialog polls the server');
  assert.strictEqual(document.getElementById('wifi-transfer-code').innerText, 'used - a device is connected');
});

test('a server that switched itself off unticks the switch and says why', async function(t){
  var state = { status: offStatus() };
  mockController(t, state);
  open();
  await flushMicrotasks();
  var check = document.getElementById('wifi-transfer-check');
  check.checked = true;
  check.onclick();
  await flushMicrotasks();

  state.status = offStatus({ stopReason: 'Wi-Fi Transfer switched itself off after ten minutes with nothing sent.' });
  await new Promise(function(resolve){ setTimeout(resolve, 2100); });

  assert.strictEqual(check.checked, false);
  assert.match(document.getElementById('wifi-transfer-message').innerText, /ten minutes/);
});

test('a deck with no network says so and stays off', async function(t){
  var state = { status: offStatus() };
  mockController(t, state, {
    startTransfer: function(){
      return Promise.resolve({ status: null, message: 'This deck is not on a local network. Join a Wi-Fi network in the Wi-Fi Manager first.' });
    }
  });
  open();
  await flushMicrotasks();
  var check = document.getElementById('wifi-transfer-check');
  check.checked = true;
  check.onclick();
  await flushMicrotasks();

  assert.strictEqual(check.checked, false);
  assert.match(document.getElementById('wifi-transfer-message').innerText, /Wi-Fi Manager/);
});

test('Add to Page offers what Send via Email would attach, using its remembered choices', async function(t){
  var state = { status: offStatus() };
  var calls = mockController(t, state);
  open();
  await flushMicrotasks();
  var check = document.getElementById('wifi-transfer-check');
  check.checked = true;
  check.onclick();
  await flushMicrotasks();

  assert.strictEqual(document.getElementById('wifi-transfer-radio-compiled').checked, true);
  findButton('Add to Page').onclick();
  await flushMicrotasks();

  assert.strictEqual(calls.offerToPage.length, 1);
  assert.strictEqual(calls.offerToPage[0][3], '.docx');
  assert.strictEqual(calls.offerToPage[0][4].compile, true);
  assert.match(document.getElementById('wifi-transfer-offers').innerText, /My Novel\.docx/);

  document.getElementById('wifi-transfer-radio-project').checked = true;
  findButton('Add to Page').onclick();
  await flushMicrotasks();
  assert.strictEqual(calls.offerToPage[1][3], '.zip', 'the project goes as a backup zip');
});

test('Import hands an inbox file to the Import dialog with its type, and switches the server off', async function(t){
  var state = { status: offStatus() };
  var calls = mockController(t, state);
  var imported = [];
  open({ importFile: function(filepath, typeId){ imported.push([filepath, typeId]); }, openProject: function(){} });
  await flushMicrotasks();
  var check = document.getElementById('wifi-transfer-check');
  check.checked = true;
  check.onclick();
  await flushMicrotasks();

  findButton('Import').onclick();
  await flushMicrotasks();

  assert.deepStrictEqual(imported, [['/home/me/Documents/WareWoolf Inbox/Chapter 9.docx', 'docxSelect']]);
  assert.strictEqual(calls.stopTransfer.length, 1);
});

test('Import on a .zip restores it as a backup and opens it', async function(t){
  var state = { status: offStatus() };
  mockController(t, state);
  var adopted = [];
  t.mock.method(backupProject, 'adoptBackup', function(zipPath){
    adopted.push(zipPath);
    return Promise.resolve('/home/me/Documents/backups/My Novel20261001120000/My Novel.woolf');
  });
  var opened = [];
  open({ importFile: function(){}, openProject: function(projectPath){ opened.push(projectPath); } });
  await flushMicrotasks();

  document.getElementById('wifi-transfer-inbox-select').selectedIndex = 1;
  findButton('Import').onclick();
  await flushMicrotasks();

  assert.deepStrictEqual(adopted, ['/home/me/Documents/WareWoolf Inbox/My Novel20261001120000.zip']);
  assert.deepStrictEqual(opened, ['/home/me/Documents/backups/My Novel20261001120000/My Novel.woolf']);
  assert.strictEqual(document.querySelector('.popup'), null);
});

test('a .zip that is not a backup stays in the inbox and the dialog says why', async function(t){
  var state = { status: offStatus() };
  mockController(t, state);
  t.mock.method(backupProject, 'adoptBackup', function(){
    return Promise.reject(new Error('photos.zip is not a WareWoolf backup.'));
  });
  var opened = [];
  open({ importFile: function(){}, openProject: function(p){ opened.push(p); } });
  await flushMicrotasks();

  document.getElementById('wifi-transfer-inbox-select').selectedIndex = 1;
  findButton('Import').onclick();
  await flushMicrotasks();

  assert.deepStrictEqual(opened, []);
  assert.match(document.getElementById('wifi-transfer-message').innerText, /not a WareWoolf backup/);
});

test('Discard deletes the chosen inbox file', async function(t){
  var state = { status: offStatus() };
  var calls = mockController(t, state);
  open();
  await flushMicrotasks();

  findButton('Discard').onclick();
  await flushMicrotasks();

  assert.deepStrictEqual(calls.discardInboxFile[0], [INBOX, 'Chapter 9.docx']);
  assert.match(document.getElementById('wifi-transfer-message').innerText, /Discarded Chapter 9\.docx/);
});

test('Close switches a running server off', async function(t){
  var state = { status: offStatus() };
  var calls = mockController(t, state);
  open();
  await flushMicrotasks();
  var check = document.getElementById('wifi-transfer-check');
  check.checked = true;
  check.onclick();
  await flushMicrotasks();

  findButton('Close').onclick();
  assert.strictEqual(calls.stopTransfer.length, 1);
  assert.strictEqual(document.querySelector('.popup'), null);
});

test('a dialog removed some other way still switches the server off at its next poll', async function(t){
  var state = { status: offStatus() };
  var calls = mockController(t, state);
  open();
  await flushMicrotasks();
  var check = document.getElementById('wifi-transfer-check');
  check.checked = true;
  check.onclick();
  await flushMicrotasks();

  document.querySelector('.popup').remove();
  await new Promise(function(resolve){ setTimeout(resolve, 2100); });

  assert.strictEqual(calls.stopTransfer.length, 1);
});

test('importKindFor maps inbox files to Import file types, a .zip to a backup, and nothing else', function(){
  assert.strictEqual(wifiTransfer.importKindFor('a.DOCX'), 'docxSelect');
  assert.strictEqual(wifiTransfer.importKindFor('a.md'), 'mdfcSelect');
  assert.strictEqual(wifiTransfer.importKindFor('script.fountain'), 'fountainSelect');
  assert.strictEqual(wifiTransfer.importKindFor('script.fdx'), 'fdxSelect');
  assert.strictEqual(wifiTransfer.importKindFor('page.htm'), 'htmlSelect');
  assert.strictEqual(wifiTransfer.importKindFor('book20260101000000.zip'), 'backup');
  assert.strictEqual(wifiTransfer.importKindFor('run.sh'), null);
  assert.strictEqual(wifiTransfer.importKindFor('README'), null);
});
