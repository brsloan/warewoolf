const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const { SAVED_SECRET } = require('../src/components/controllers/platform');

const errorLogDisplayPath = require.resolve('../src/components/views/error-log_display');
const errorLogControllerPath = require.resolve('../src/components/controllers/error-log');
const emailDocControllerPath = require.resolve('../src/components/controllers/email-doc');

//error-log_display.js destructures loadErrorLog/clearErrorLog and emailFile from their modules at
//require-time, so these mocks only take effect if the cache is primed with them before
//error-log_display.js is (re-)required - same pattern as email-doc_display.test.js's
//freshEmailDisplay().
function freshErrorLogDisplay(mocks){
  delete require.cache[errorLogDisplayPath];
  require.cache[errorLogControllerPath] = { id: errorLogControllerPath, filename: errorLogControllerPath, loaded: true, exports: { loadErrorLog: mocks.loadErrorLog, clearErrorLog: mocks.clearErrorLog } };
  require.cache[emailDocControllerPath] = { id: emailDocControllerPath, filename: emailDocControllerPath, loaded: true, exports: { emailFile: mocks.emailFile } };
  return require(errorLogDisplayPath);
}

function makeUserSettings(overrides){
  return Object.assign({
    senderEmail: 'writer@gmail.com',
    receiverEmail: 'backup@example.com',
    save: function(){ this.saveCalls = (this.saveCalls || 0) + 1; }
  }, overrides);
}

//This dialog only ever asks whether a password exists and whether it is readable, so the one group
//J command it needs is describeCredential. It never stores, unlocks or clears anything, which is
//why a plain stub is enough here where email-doc_display.test.js needs the real backing.
function makePlatform(overrides){
  var described = Object.assign({
    hasPassword: false,
    backend: 'safeStorage',
    locked: false,
    secureStorageAvailable: true
  }, overrides);

  return { describeCredential: function(){ return Promise.resolve(described); } };
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[errorLogDisplayPath];
  delete require.cache[errorLogControllerPath];
  delete require.cache[emailDocControllerPath];
  delete global.window;
  delete global.document;
});

//Regression: clicking Send read senderEmail/receiverEmail from userSettings to prefill the form,
//but never wrote the (possibly edited) values back - unlike email-doc_display.js's Send handler,
//which does persist them. An edit made from the Error Log dialog was silently lost.
test('clicking Send persists the sender/receiver email back to userSettings', async function(t){
  var userSettings = makeUserSettings();
  var platform = makePlatform();

  var emailFileCalls = [];
  var emailFile = function(sender, pass, receiver, attachments, callback){
    emailFileCalls.push({ sender, pass, receiver, attachments });
  };

  var showErrorLog = freshErrorLogDisplay({
    loadErrorLog: function(){ return Promise.resolve('boom'); },
    clearErrorLog: function(){ return Promise.resolve(); },
    emailFile: emailFile
  });

  await showErrorLog(userSettings, platform);

  var senderInput = document.getElementById('sender-email-input');
  var receiverInput = document.getElementById('receiver-email-input');
  senderInput.value = 'new-sender@gmail.com';
  receiverInput.value = 'new-receiver@example.com';

  var sendButton = Array.from(document.querySelectorAll('button')).find(function(b){ return b.innerHTML === 'Send'; });
  sendButton.onclick();

  assert.strictEqual(userSettings.senderEmail, 'new-sender@gmail.com');
  assert.strictEqual(userSettings.receiverEmail, 'new-receiver@example.com');
  assert.strictEqual(userSettings.saveCalls, 1);
  assert.strictEqual(emailFileCalls.length, 1);
  assert.strictEqual(emailFileCalls[0].sender, 'new-sender@gmail.com');
  assert.strictEqual(emailFileCalls[0].receiver, 'new-receiver@example.com');
});

test('the error log text box prefills from loadErrorLog and Clear Log reloads it', async function(t){
  var userSettings = makeUserSettings();
  var platform = makePlatform();
  var logText = 'first error';

  var clearCalls = 0;
  var showErrorLog = freshErrorLogDisplay({
    loadErrorLog: function(){ return Promise.resolve(logText); },
    clearErrorLog: function(){ clearCalls++; logText = ''; return Promise.resolve(); },
    emailFile: function(){}
  });

  await showErrorLog(userSettings, platform);

  var pre = document.querySelector('pre');
  assert.strictEqual(pre.innerText, 'first error');

  var clearBtn = Array.from(document.querySelectorAll('button')).find(function(b){ return b.innerHTML === 'Clear Log'; });
  await clearBtn.onclick();

  assert.strictEqual(clearCalls, 1);
  assert.strictEqual(pre.innerText, '(Log Empty)');
});

//---------------------------------------------------------------------------
// Phase 7: the saved password stops passing through the DOM
//---------------------------------------------------------------------------

//This dialog used to call credentialStore.getPassword() and write the plaintext straight into an
//<input type=password>. It now writes the sentinel, which emailFile resolves natively at send
//time - so the password never reaches the DOM and never reaches this module either.
test('a readable saved password puts the sentinel in the field, never the password', async function(t){
  var userSettings = makeUserSettings();
  var platform = makePlatform({ hasPassword: true, locked: false });

  var emailFileCalls = [];
  var showErrorLog = freshErrorLogDisplay({
    loadErrorLog: function(){ return Promise.resolve('boom'); },
    clearErrorLog: function(){ return Promise.resolve(); },
    emailFile: function(sender, pass, receiver, attachments, callback){
      emailFileCalls.push({ sender, pass, receiver });
    }
  });

  await showErrorLog(userSettings, platform);

  var senderPassInput = document.getElementById('sender-email-pass');
  assert.strictEqual(senderPassInput.value, SAVED_SECRET);

  Array.from(document.querySelectorAll('button')).find(function(b){ return b.innerHTML === 'Send'; }).onclick();

  assert.strictEqual(emailFileCalls.length, 1);
  assert.strictEqual(emailFileCalls[0].pass, SAVED_SECRET);
});

//A passphrase-protected password nobody has unlocked this session has nothing to refer to, so the
//field is left empty and gets typed by hand - exactly what happened when this read the plaintext
//and got null back. Filling in the sentinel here would produce a send that fails with a locked
//credential rather than one the writer can simply type their way past.
test('a locked saved password leaves the field empty', async function(t){
  var userSettings = makeUserSettings();
  var platform = makePlatform({ hasPassword: true, locked: true });

  var showErrorLog = freshErrorLogDisplay({
    loadErrorLog: function(){ return Promise.resolve('boom'); },
    clearErrorLog: function(){ return Promise.resolve(); },
    emailFile: function(){}
  });

  await showErrorLog(userSettings, platform);

  assert.strictEqual(document.getElementById('sender-email-pass').value, '');
});

test('no saved password at all leaves the field empty', async function(t){
  var userSettings = makeUserSettings();

  var showErrorLog = freshErrorLogDisplay({
    loadErrorLog: function(){ return Promise.resolve('boom'); },
    clearErrorLog: function(){ return Promise.resolve(); },
    emailFile: function(){}
  });

  await showErrorLog(userSettings, makePlatform());

  assert.strictEqual(document.getElementById('sender-email-pass').value, '');
});
