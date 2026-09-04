const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const emailDisplayPath = require.resolve('../src/components/views/email-doc_display');
const emailControllerPath = require.resolve('../src/components/controllers/email-doc');
const workingDisplayPath = require.resolve('../src/components/views/working_display');

//email-doc_display.js destructures prepareAndEmail and showWorkingAndThen/hideWorking from their
//modules at require-time, so these mocks only take effect if the cache is primed with them before
//email-doc_display.js is (re-)required - same pattern as compile_display.test.js's
//freshCompileDisplay().
function freshEmailDisplay(mocks){
  delete require.cache[emailDisplayPath];
  require.cache[emailControllerPath] = { id: emailControllerPath, filename: emailControllerPath, loaded: true, exports: { prepareAndEmail: mocks.prepareAndEmail } };
  require.cache[workingDisplayPath] = { id: workingDisplayPath, filename: workingDisplayPath, loaded: true, exports: { showWorkingAndThen: mocks.showWorkingAndThen, hideWorking: mocks.hideWorking } };
  return require(emailDisplayPath);
}

function makeUserSettings(overrides){
  return Object.assign({
    senderEmail: 'writer@gmail.com',
    receiverEmail: 'backup@example.com',
    emailType: undefined,
    compileType: '.docx',
    compileChapMark: '***',
    compileInsertHeaders: false,
    compileGenTitlePage: true,
    save: function(){}
  }, overrides);
}

//A minimal fake of getCredentialStore()'s returned object (src/components/models/credential-store.js),
//tracking just enough state for describe()/getPassword()/savePassword()/unlock()/clear() to behave
//the way the real store does.
function makeCredentialStore(overrides){
  var state = Object.assign({
    hasPassword: false,
    backend: 'safeStorage',
    locked: false,
    secureStorageAvailable: true,
    password: null,
    correctPassphrase: null
  }, overrides);

  return {
    describe: function(){
      return {
        hasPassword: state.hasPassword,
        backend: state.backend,
        locked: state.locked,
        secureStorageAvailable: state.secureStorageAvailable
      };
    },
    getPassword: function(){ return state.password; },
    savePassword: function(password, options){
      state.password = password;
      state.hasPassword = true;
      state.backend = (options && options.passphrase) ? 'passphrase' : state.backend;
      state.locked = false;
      return true;
    },
    unlock: function(passphrase){
      if(state.correctPassphrase != null && passphrase === state.correctPassphrase){
        state.locked = false;
        return true;
      }
      return false;
    },
    clear: function(){
      state.hasPassword = false;
      state.password = null;
      return true;
    },
    _state: state
  };
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[emailDisplayPath];
  delete require.cache[emailControllerPath];
  delete require.cache[workingDisplayPath];
  delete global.window;
  delete global.document;
});

//Regression: clicking Send used to call prepareAndEmail (which can run synchronous docx/epub/
//compile work before ever reaching the async network send) directly, with no chance for
//"Sending..." or the disabled button to paint first - freezing the UI just like the bug already
//fixed in compile_display.js/convert-italics_display.js/convert-tabs-display.js.
test('clicking Send shows a working indicator and defers prepareAndEmail until it resolves', function(t){
  var project = { title: 'My Novel' };
  var userSettings = makeUserSettings();
  var credentialStore = makeCredentialStore();

  var prepareCalls = [];
  var capturedSendCallback = null;
  var prepareAndEmail = function(project, userSettings, editorQuill, sender, pass, receiver, filetype, compileOptions, cback){
    prepareCalls.push({ project, sender, receiver, filetype, compileOptions });
    capturedSendCallback = cback;
  };

  var showWorkingCalls = 0;
  var hideWorkingCalls = 0;
  var capturedWorkingCallback = null;
  var showWorkingAndThen = function(status, cb){
    showWorkingCalls++;
    capturedWorkingCallback = cb;
  };
  var hideWorking = function(){ hideWorkingCalls++; };

  var showEmailOptions = freshEmailDisplay({
    prepareAndEmail: prepareAndEmail,
    showWorkingAndThen: showWorkingAndThen,
    hideWorking: hideWorking
  });

  showEmailOptions(project, userSettings, credentialStore, {});

  var sendButton = Array.from(document.querySelectorAll('button')).find(function(b){ return b.innerHTML === 'Send'; });
  var responseText = document.querySelector('fieldset p');

  sendButton.onclick();

  assert.strictEqual(sendButton.disabled, true, 'Send should disable immediately');
  assert.strictEqual(showWorkingCalls, 1, 'the working indicator should show before the heavy work runs');
  assert.strictEqual(prepareCalls.length, 0, 'prepareAndEmail must not run until the working indicator has had a chance to paint');

  capturedWorkingCallback();

  assert.strictEqual(prepareCalls.length, 1);
  assert.strictEqual(prepareCalls[0].project, project);
  assert.strictEqual(hideWorkingCalls, 0, 'hideWorking must not run before prepareAndEmail calls back');

  capturedSendCallback('Email sent successfully.');

  assert.strictEqual(hideWorkingCalls, 1, 'hideWorking should run once prepareAndEmail calls back');
  assert.strictEqual(responseText.innerText, 'Email sent successfully.');
  assert.strictEqual(sendButton.disabled, false, 'Send should re-enable once prepareAndEmail calls back');
});

//Regression: while a passphrase-protected password was still locked, savedPassword was null, so
//senderPassInput.value ('' - never populated) could never match it and the "unchanged" check
//always failed. A writer who then typed just a new passphrase (without unlocking) would have
//credentialStore.savePassword('', {passphrase}) silently overwrite their real saved password with
//an empty one. Send should instead refuse and point at Unlock, touching neither the store nor
//prepareAndEmail.
test('sending while a passphrase-protected password is still locked refuses instead of overwriting it', function(t){
  var project = { title: 'My Novel' };
  var userSettings = makeUserSettings();
  var credentialStore = makeCredentialStore({
    hasPassword: true,
    backend: 'passphrase',
    locked: true,
    password: 'the-real-password',
    correctPassphrase: 'hunter2'
  });

  var prepareCalls = [];
  var showEmailOptions = freshEmailDisplay({
    prepareAndEmail: function(){ prepareCalls.push(true); },
    showWorkingAndThen: function(status, cb){ cb(); },
    hideWorking: function(){}
  });

  showEmailOptions(project, userSettings, credentialStore, {});

  var sendButton = Array.from(document.querySelectorAll('button')).find(function(b){ return b.innerHTML === 'Send'; });
  var newPassphraseInput = document.getElementById('new-passphrase-input');
  var confirmPassphraseInput = document.getElementById('confirm-passphrase-input');
  var unlockInput = document.getElementById('unlock-passphrase-input');

  //Simulate the confused-writer path: typing a new passphrase without ever clicking Unlock.
  newPassphraseInput.value = 'some-new-passphrase';
  confirmPassphraseInput.value = 'some-new-passphrase';

  sendButton.onclick();

  assert.strictEqual(prepareCalls.length, 0, 'prepareAndEmail must not run while locked');
  assert.strictEqual(credentialStore._state.password, 'the-real-password', 'the real saved password must survive untouched');
  assert.strictEqual(document.activeElement, unlockInput, 'focus should move to the passphrase-unlock field');
});

//Regression: settingANewPassword was computed from !credentials.locked alone, so right after a
//successful Unlock (which flips credentials.locked to false) it went unconditionally true - the
//New/Confirm Passphrase rows popped back into view even though nothing had changed.
test('unlocking a passphrase-protected password keeps the new-passphrase fields hidden', function(t){
  var project = { title: 'My Novel' };
  var userSettings = makeUserSettings();
  var credentialStore = makeCredentialStore({
    hasPassword: true,
    backend: 'passphrase',
    locked: true,
    password: 'the-real-password',
    correctPassphrase: 'hunter2'
  });

  var showEmailOptions = freshEmailDisplay({
    prepareAndEmail: function(){},
    showWorkingAndThen: function(status, cb){ cb(); },
    hideWorking: function(){}
  });

  showEmailOptions(project, userSettings, credentialStore, {});

  var unlockInput = document.getElementById('unlock-passphrase-input');
  var unlockButton = Array.from(document.querySelectorAll('button')).find(function(b){ return b.innerHTML === 'Unlock'; });
  var newPassphraseRow = document.getElementById('new-passphrase-input').closest('tr');
  var confirmPassphraseRow = document.getElementById('confirm-passphrase-input').closest('tr');

  unlockInput.value = 'hunter2';
  unlockButton.onclick();

  assert.strictEqual(newPassphraseRow.style.display, 'none', 'New Passphrase row should stay hidden right after unlocking');
  assert.strictEqual(confirmPassphraseRow.style.display, 'none', 'Confirm Passphrase row should stay hidden right after unlocking');
});

//Regression: only 'project' and 'chapter' emailType were handled explicitly, so a first run with
//emailType unset left every radio unchecked - Send would silently behave like "Send Chapter" with
//no visible selection.
test('defaults to the Send Chapter radio when userSettings.emailType is unset', function(t){
  var project = { title: 'My Novel' };
  var userSettings = makeUserSettings({ emailType: undefined });
  var credentialStore = makeCredentialStore();

  var showEmailOptions = freshEmailDisplay({
    prepareAndEmail: function(){},
    showWorkingAndThen: function(status, cb){ cb(); },
    hideWorking: function(){}
  });

  showEmailOptions(project, userSettings, credentialStore, {});

  assert.strictEqual(document.getElementById('email-radio-chap').checked, true);
  assert.strictEqual(document.getElementById('email-radio-compiled').checked, false);
  assert.strictEqual(document.getElementById('email-radio-project').checked, false);
});
