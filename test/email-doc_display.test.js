const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { createPlatform, SAVED_SECRET } = require('../src/components/controllers/platform');
const { createNodeBacking } = require('../src/components/controllers/platform-node');

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

//A real node-backed platform over a real temp directory, built exactly as render.js builds the one
//it hands this dialog - not a fake. Phase 7's whole job here is driving group J correctly, and the
//interesting half of that is storeCredential's SAVED_SECRET handling; a hand-written fake would
//have to reimplement it to be worth anything, and would then agree with itself rather than with the
//backing the app runs. `_state` is gone with the fake, so tests read the stored password the only
//way anything can: resolveSecret() on the backing, which is not a command and never crosses.
function makePlatform(t, options){
  var opts = options || {};
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-email-dialog-')) + path.sep;
  t.after(function(){
    fs.rmSync(dir, { recursive: true, force: true });
  });

  var backing = createNodeBacking({
    paths: { userData: dir },
    secureStorage: {
      isAvailable: function(){ return opts.secureStorageAvailable === true; },
      encrypt: function(text){ return 'keystore:' + Buffer.from(text, 'utf8').toString('base64'); },
      decrypt: function(content){
        return Buffer.from(content.slice('keystore:'.length), 'base64').toString('utf8');
      }
    }
  });

  return {
    dir: dir,
    backing: backing,
    platform: createPlatform(backing),
    storedSecret: function(){ return backing.resolveSecret({ service: 'email' }); }
  };
}

function passwordField(){
  return document.getElementById('sender-email-pass');
}

function sendButton(){
  return Array.from(document.querySelectorAll('button')).find(function(b){ return b.innerHTML === 'Send'; });
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
test('clicking Send shows a working indicator and defers prepareAndEmail until it resolves', async function(t){
  var project = { title: 'My Novel' };
  var userSettings = makeUserSettings();
  var built = makePlatform(t);

  var prepareCalls = [];
  var capturedSendCallback = null;
  var prepareAndEmail = function(project, userSettings, editorQuill, platform, sender, pass, receiver, filetype, compileOptions, cback){
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

  await showEmailOptions(project, userSettings, built.platform, {});

  var send = sendButton();
  var responseText = document.querySelector('fieldset p');

  await send.onclick();

  assert.strictEqual(send.disabled, true, 'Send should disable immediately');
  assert.strictEqual(showWorkingCalls, 1, 'the working indicator should show before the heavy work runs');
  assert.strictEqual(prepareCalls.length, 0, 'prepareAndEmail must not run until the working indicator has had a chance to paint');

  capturedWorkingCallback();

  assert.strictEqual(prepareCalls.length, 1);
  assert.strictEqual(prepareCalls[0].project, project);
  assert.strictEqual(hideWorkingCalls, 0, 'hideWorking must not run before prepareAndEmail calls back');

  capturedSendCallback('Email sent successfully.');

  assert.strictEqual(hideWorkingCalls, 1, 'hideWorking should run once prepareAndEmail calls back');
  assert.strictEqual(responseText.innerText, 'Email sent successfully.');
  assert.strictEqual(send.disabled, false, 'Send should re-enable once prepareAndEmail calls back');
});

//Regression: while a passphrase-protected password was still locked, savedPassword was null, so
//senderPassInput.value ('' - never populated) could never match it and the "unchanged" check
//always failed. A writer who then typed just a new passphrase (without unlocking) would have
//credentialStore.savePassword('', {passphrase}) silently overwrite their real saved password with
//an empty one. Send should instead refuse and point at Unlock, touching neither the store nor
//prepareAndEmail.
test('sending while a passphrase-protected password is still locked refuses instead of overwriting it', async function(t){
  var project = { title: 'My Novel' };
  var userSettings = makeUserSettings();
  var built = makePlatform(t);
  await seedLockedPassphraseCredential(built);

  var prepareCalls = [];
  var showEmailOptions = freshEmailDisplay({
    prepareAndEmail: function(){ prepareCalls.push(true); },
    showWorkingAndThen: function(status, cb){ cb(); },
    hideWorking: function(){}
  });

  await showEmailOptions(project, userSettings, built.platform, {});

  var newPassphraseInput = document.getElementById('new-passphrase-input');
  var confirmPassphraseInput = document.getElementById('confirm-passphrase-input');
  var unlockInput = document.getElementById('unlock-passphrase-input');

  //Simulate the confused-writer path: typing a new passphrase without ever clicking Unlock.
  newPassphraseInput.value = 'some-new-passphrase';
  confirmPassphraseInput.value = 'some-new-passphrase';

  await sendButton().onclick();

  assert.strictEqual(prepareCalls.length, 0, 'prepareAndEmail must not run while locked');
  assert.strictEqual(document.activeElement, unlockInput, 'focus should move to the passphrase-unlock field');

  //The real saved password must survive untouched, which is only checkable by unlocking it again.
  assert.strictEqual(await built.platform.unlockCredential({ service: 'email', passphrase: 'hunter2' }), true);
  assert.strictEqual(built.storedSecret(), 'the-real-password');
});

//Regression: settingANewPassword was computed from !credentials.locked alone, so right after a
//successful Unlock (which flips credentials.locked to false) it went unconditionally true - the
//New/Confirm Passphrase rows popped back into view even though nothing had changed.
test('unlocking a passphrase-protected password keeps the new-passphrase fields hidden', async function(t){
  var project = { title: 'My Novel' };
  var userSettings = makeUserSettings();
  var built = makePlatform(t);
  await seedLockedPassphraseCredential(built);

  var showEmailOptions = freshEmailDisplay({
    prepareAndEmail: function(){},
    showWorkingAndThen: function(status, cb){ cb(); },
    hideWorking: function(){}
  });

  await showEmailOptions(project, userSettings, built.platform, {});

  var unlockInput = document.getElementById('unlock-passphrase-input');
  var unlockButton = Array.from(document.querySelectorAll('button')).find(function(b){ return b.innerHTML === 'Unlock'; });
  var newPassphraseRow = document.getElementById('new-passphrase-input').closest('tr');
  var confirmPassphraseRow = document.getElementById('confirm-passphrase-input').closest('tr');

  unlockInput.value = 'hunter2';
  await unlockButton.onclick();

  assert.strictEqual(newPassphraseRow.style.display, 'none', 'New Passphrase row should stay hidden right after unlocking');
  assert.strictEqual(confirmPassphraseRow.style.display, 'none', 'Confirm Passphrase row should stay hidden right after unlocking');
});

//Regression: only 'project' and 'chapter' emailType were handled explicitly, so a first run with
//emailType unset left every radio unchecked - Send would silently behave like "Send Chapter" with
//no visible selection.
test('defaults to the Send Chapter radio when userSettings.emailType is unset', async function(t){
  var project = { title: 'My Novel' };
  var userSettings = makeUserSettings({ emailType: undefined });
  var built = makePlatform(t);

  var showEmailOptions = freshEmailDisplay({
    prepareAndEmail: function(){},
    showWorkingAndThen: function(status, cb){ cb(); },
    hideWorking: function(){}
  });

  await showEmailOptions(project, userSettings, built.platform, {});

  assert.strictEqual(document.getElementById('email-radio-chap').checked, true);
  assert.strictEqual(document.getElementById('email-radio-compiled').checked, false);
  assert.strictEqual(document.getElementById('email-radio-project').checked, false);
});

//---------------------------------------------------------------------------
// Phase 7: the saved password stops passing through the DOM
//---------------------------------------------------------------------------

//The point of the whole exercise, stated as an assertion. Before Phase 7 this field held the real
//password, which under contextIsolation is a plaintext credential in the DOM of a webview.
test('a saved password is never put in the password field - the sentinel is', async function(t){
  var built = makePlatform(t);
  await built.platform.storeCredential({ service: 'email', secret: 'the-real-password' });

  var showEmailOptions = freshEmailDisplay(quietMocks());
  await showEmailOptions({ title: 'My Novel' }, makeUserSettings(), built.platform, {});

  assert.strictEqual(passwordField().value, SAVED_SECRET);
  //Not just this field: nowhere in the dialog at all.
  assert.strictEqual(document.querySelector('.popup').innerHTML.indexOf('the-real-password'), -1);
  assert.strictEqual(Array.from(document.querySelectorAll('input'))
    .filter(function(i){ return i.value.indexOf('the-real-password') !== -1; }).length, 0);
});

//The sentinel contains NUL characters, and everything above depends on an <input type=password>
//handing back exactly what was put into it. Chromium does (verified against a real Electron
//BrowserWindow during Phase 7); this pins the behaviour the tests below rely on in jsdom.
test('the sentinel survives a round trip through an input value unchanged', function(){
  const dom = new JSDOM('<!doctype html><html><body><input type="password" id="p"></body></html>');
  const field = dom.window.document.getElementById('p');

  field.value = SAVED_SECRET;

  assert.strictEqual(field.value, SAVED_SECRET);
  assert.strictEqual(field.value.length, SAVED_SECRET.length);
  assert.strictEqual(field.value.charCodeAt(0), 0);
});

test('sending with the field untouched hands the sentinel to the mailer, not a password', async function(t){
  var built = makePlatform(t);
  await built.platform.storeCredential({ service: 'email', secret: 'the-real-password' });

  var prepareCalls = [];
  var showEmailOptions = freshEmailDisplay(quietMocks(function(){
    prepareCalls.push(Array.from(arguments));
  }));

  await showEmailOptions({ title: 'My Novel' }, makeUserSettings(), built.platform, {});
  await sendButton().onclick();

  assert.strictEqual(prepareCalls.length, 1);
  //prepareAndEmail(project, userSettings, editorQuill, platform, sender, pass, ...)
  assert.strictEqual(prepareCalls[0][5], SAVED_SECRET);
});

//Nothing changed, so nothing should be rewritten - the same guard that already existed, now
//expressed against the sentinel instead of against a plaintext the dialog had to fetch first.
test('sending with the field untouched does not rewrite the stored password', async function(t){
  var built = makePlatform(t);
  await built.platform.storeCredential({ service: 'email', secret: 'the-real-password' });
  var before = fs.readFileSync(path.join(built.dir, 'credentials.json'), 'utf8');

  var showEmailOptions = freshEmailDisplay(quietMocks());
  await showEmailOptions({ title: 'My Novel' }, makeUserSettings(), built.platform, {});
  await sendButton().onclick();

  assert.strictEqual(fs.readFileSync(path.join(built.dir, 'credentials.json'), 'utf8'), before);
  assert.strictEqual(built.storedSecret(), 'the-real-password');
});

//Typing over the field is the other branch, and it must still reach storeCredential as a literal.
test('typing a new password over the field replaces the stored one', async function(t){
  var built = makePlatform(t);
  await built.platform.storeCredential({ service: 'email', secret: 'the-real-password' });

  var showEmailOptions = freshEmailDisplay(quietMocks());
  await showEmailOptions({ title: 'My Novel' }, makeUserSettings(), built.platform, {});

  passwordField().value = 'a-brand-new-password';
  await sendButton().onclick();

  assert.strictEqual(built.storedSecret(), 'a-brand-new-password');
  //And the field goes back to referring rather than holding, so a second Send reads as unchanged.
  assert.strictEqual(passwordField().value, SAVED_SECRET);
});

//The case the SAVED_SECRET addition to storeCredential exists for. Unticking "Protect With
//Passphrase" on a password the writer never retyped has to re-seal it - and the dialog does not
//have it to re-seal. Without the sentinel reaching storeCredential this stored the literal
//sentinel string as the password, silently, reporting success.
test('unticking passphrase protection re-seals the saved password without holding it', async function(t){
  var built = makePlatform(t);
  await built.platform.storeCredential({
    service: 'email', secret: 'the-real-password', passphrase: 'hunter2'
  });

  var showEmailOptions = freshEmailDisplay(quietMocks());
  await showEmailOptions({ title: 'My Novel' }, makeUserSettings(), built.platform, {});

  //Saving counted as unlocking, so the dialog opens unlocked with the sentinel in the field.
  assert.strictEqual(passwordField().value, SAVED_SECRET);

  document.getElementById('protect-pass-check').checked = false;
  await sendButton().onclick();

  assert.strictEqual((await built.platform.describeCredential({ service: 'email' })).backend, 'keyfile');
  assert.strictEqual(built.storedSecret(), 'the-real-password');
});

//Unticking "Remember Password?" has always meant "send with it this once, then forget it". The
//dialog no longer holds the password, so it cannot clear the store before the send and still have
//something to send with - the clear waits until the send is over. Getting this wrong is invisible
//in the dialog and shows up as a send that fails for no stated reason.
test('unticking Remember Password sends first and forgets afterwards', async function(t){
  var built = makePlatform(t);
  await built.platform.storeCredential({ service: 'email', secret: 'the-real-password' });

  var capturedSendCallback = null;
  var showEmailOptions = freshEmailDisplay(quietMocks(function(){
    //prepareAndEmail(project, userSettings, editorQuill, platform, sender, pass, receiver, filetype, compileOptions, cback)
    capturedSendCallback = arguments[9];
  }));

  await showEmailOptions({ title: 'My Novel' }, makeUserSettings(), built.platform, {});

  document.getElementById('remember-pass-check').checked = false;
  await sendButton().onclick();

  //Still there while the send is in flight, or the sentinel in the field would resolve to nothing.
  assert.strictEqual((await built.platform.describeCredential({ service: 'email' })).hasPassword, true);

  capturedSendCallback('Email sent successfully.');
  await flush();

  assert.strictEqual((await built.platform.describeCredential({ service: 'email' })).hasPassword, false);
  assert.strictEqual(passwordField().value, '');
});

//A send that never got off the ground still means "forget it" - the writer unticked the box.
test('unticking Remember Password forgets even when the send fails', async function(t){
  var built = makePlatform(t);
  await built.platform.storeCredential({ service: 'email', secret: 'the-real-password' });

  var showEmailOptions = freshEmailDisplay(quietMocks(function(){
    return Promise.reject(new Error('could not build the attachment'));
  }));

  await showEmailOptions({ title: 'My Novel' }, makeUserSettings(), built.platform, {});

  document.getElementById('remember-pass-check').checked = false;
  await sendButton().onclick();
  await flush();

  assert.strictEqual((await built.platform.describeCredential({ service: 'email' })).hasPassword, false);
});

//A locked passphrase-protected password cannot be read, so there is nothing for the field to refer
//to and it must be left empty - the writer either unlocks it or types the password. Filling in the
//sentinel instead shows a password field full of dots for a password that cannot be used, and every
//other guard in the dialog still passes: Send refuses on credentials.locked, so nothing is
//overwritten and no test noticed. What actually breaks is what the writer is told.
test('a locked saved password leaves the password field empty and offers the unlock row', async function(t){
  var built = makePlatform(t);
  await seedLockedPassphraseCredential(built);

  var showEmailOptions = freshEmailDisplay(quietMocks());
  await showEmailOptions({ title: 'My Novel' }, makeUserSettings(), built.platform, {});

  assert.strictEqual(passwordField().value, '');
  assert.strictEqual(document.getElementById('unlock-passphrase-input').closest('tr').style.display, '');
  assert.strictEqual(document.activeElement, document.getElementById('unlock-passphrase-input'));
});

//And once it is unlocked the field refers to it, like any other readable saved password.
test('unlocking fills the field with the sentinel, not with the password', async function(t){
  var built = makePlatform(t);
  await seedLockedPassphraseCredential(built);

  var showEmailOptions = freshEmailDisplay(quietMocks());
  await showEmailOptions({ title: 'My Novel' }, makeUserSettings(), built.platform, {});

  document.getElementById('unlock-passphrase-input').value = 'hunter2';
  await Array.from(document.querySelectorAll('button'))
    .find(function(b){ return b.innerHTML === 'Unlock'; }).onclick();

  assert.strictEqual(passwordField().value, SAVED_SECRET);
  assert.strictEqual(document.querySelector('.popup').innerHTML.indexOf('the-real-password'), -1);
});

//Seeds a passphrase-protected credential and then locks it, which is what a fresh window sees.
//Uses the real scrypt parameters, so it is deliberately one of the slower helpers here.
async function seedLockedPassphraseCredential(built){
  await built.platform.storeCredential({
    service: 'email', secret: 'the-real-password', passphrase: 'hunter2'
  });
  await built.platform.lockCredential({ service: 'email' });
}

//The mocks most of the tests above want: a prepareAndEmail that records or does nothing, and a
//working indicator that runs its callback straight through.
function quietMocks(prepareAndEmail){
  return {
    prepareAndEmail: prepareAndEmail || function(){},
    showWorkingAndThen: function(status, cb){ cb(); },
    hideWorking: function(){}
  };
}

//The dialog's post-send bookkeeping (clearing a credential the writer asked it to forget) runs off
//the send callback rather than off anything the test awaits, so it needs a turn of the loop.
function flush(){
  return new Promise(function(resolve){ setImmediate(resolve); });
}
