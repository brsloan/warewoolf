const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const installUpdateDisplayPath = require.resolve('../src/components/views/install-update_display');
const updatesControllerPath = require.resolve('../src/components/controllers/updates');

//install-update_display.js destructures installUpdate from the updates controller at
//require-time, so mocking it only takes effect if the cache is primed before
//install-update_display.js is (re-)required - same pattern as import_display.test.js.
function freshInstallUpdateDisplay(mocks){
  delete require.cache[installUpdateDisplayPath];
  require.cache[updatesControllerPath] = {
    id: updatesControllerPath,
    filename: updatesControllerPath,
    loaded: true,
    exports: {
      installUpdate: mocks.installUpdate
    }
  };
  return require(installUpdateDisplayPath);
}

//closePopups() (run by the Close button) also calls disableSearchView()/focusEditor(), which
//reach for this fixed shell by id - same shell used in import_display.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div><div id="project-notes"></div><div id="writing-field"></div>';
}

function keydown(target, key){
  target.dispatchEvent(new window.KeyboardEvent('keydown', { key: key, bubbles: true, cancelable: true }));
}

function getInstallBtn(){
  return Array.from(document.querySelectorAll('button')).find(function(b){ return b.innerHTML === 'Install Update'; });
}

function getCloseBtn(){
  return Array.from(document.querySelectorAll('button')).find(function(b){ return b.innerHTML === 'Close'; });
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[installUpdateDisplayPath];
  delete require.cache[updatesControllerPath];
  delete global.window;
  delete global.document;
});

test('renders the given filepath and focuses the password field', function(t){
  var showInstallUpdate = freshInstallUpdateDisplay({ installUpdate: function(){} });

  showInstallUpdate('/tmp/warewoolf_2.0.0_amd64.deb');

  assert.strictEqual(document.querySelector('.popup p').innerText, '/tmp/warewoolf_2.0.0_amd64.deb');
  assert.strictEqual(document.activeElement.id, 'install-pass');
});

test('the password field does not offer to autofill/save the sudo password', function(t){
  var showInstallUpdate = freshInstallUpdateDisplay({ installUpdate: function(){} });

  showInstallUpdate('/tmp/pkg.deb');

  assert.strictEqual(document.getElementById('install-pass').autocomplete, 'new-password');
});

//Regression: the status paragraph had no white-space override, and .popup p in index.css uses
//the default "normal", which collapses the "\n"-separated lines installUpdate writes into one
//run-on line.
test('regression: the status display preserves line breaks from multi-line install output', function(t){
  var showInstallUpdate = freshInstallUpdateDisplay({ installUpdate: function(){} });

  showInstallUpdate('/tmp/pkg.deb');

  var statusDisp = document.querySelectorAll('.popup p')[1];
  assert.strictEqual(statusDisp.style.whiteSpace, 'pre-line');
});

test('clicking Install Update with a password submits it to installUpdate along with the filepath and status element', function(t){
  var capturedArgs;
  var showInstallUpdate = freshInstallUpdateDisplay({
    installUpdate: function(pass, filepath, statusElement, onDone){
      capturedArgs = { pass: pass, filepath: filepath, statusElement: statusElement, onDone: onDone };
    }
  });

  showInstallUpdate('/tmp/pkg.deb');
  document.getElementById('install-pass').value = 'hunter2';
  getInstallBtn().onclick();

  assert.strictEqual(capturedArgs.pass, 'hunter2');
  assert.strictEqual(capturedArgs.filepath, '/tmp/pkg.deb');
  assert.strictEqual(capturedArgs.statusElement, document.querySelectorAll('.popup p')[1]);
  assert.strictEqual(typeof capturedArgs.onDone, 'function');
  assert.strictEqual(getInstallBtn().disabled, true);
});

//Regression: the password value was left sitting in the input after submission.
test('regression: the password field is cleared immediately after submitting', function(t){
  var showInstallUpdate = freshInstallUpdateDisplay({ installUpdate: function(){} });

  showInstallUpdate('/tmp/pkg.deb');
  var passInput = document.getElementById('install-pass');
  passInput.value = 'hunter2';
  getInstallBtn().onclick();

  assert.strictEqual(passInput.value, '');
});

test('clicking Install Update with an empty password shows a message and does not call installUpdate', function(t){
  var called = false;
  var showInstallUpdate = freshInstallUpdateDisplay({
    installUpdate: function(){ called = true; }
  });

  showInstallUpdate('/tmp/pkg.deb');
  getInstallBtn().onclick();

  assert.strictEqual(called, false);
  assert.strictEqual(getInstallBtn().disabled, false);
  assert.strictEqual(document.querySelectorAll('.popup p')[1].innerText, 'Password is required.');
});

//Regression: the password field had no keydown handler at all, so Enter did nothing and the
//only way to submit was reaching for the mouse.
test('regression: pressing Enter in the password field submits, the same as clicking Install Update', function(t){
  var capturedArgs;
  var showInstallUpdate = freshInstallUpdateDisplay({
    installUpdate: function(pass, filepath, statusElement, onDone){
      capturedArgs = { pass: pass, filepath: filepath };
    }
  });

  showInstallUpdate('/tmp/pkg.deb');
  var passInput = document.getElementById('install-pass');
  passInput.value = 'hunter2';
  keydown(passInput, 'Enter');

  assert.strictEqual(capturedArgs.pass, 'hunter2');
  assert.strictEqual(capturedArgs.filepath, '/tmp/pkg.deb');
});

test('clicking Install Update a second time before the first attempt finishes does not submit twice', function(t){
  var callCount = 0;
  var showInstallUpdate = freshInstallUpdateDisplay({
    installUpdate: function(){ callCount++; }
  });

  showInstallUpdate('/tmp/pkg.deb');
  document.getElementById('install-pass').value = 'hunter2';
  var installBtn = getInstallBtn();
  installBtn.onclick();
  installBtn.onclick();

  assert.strictEqual(callCount, 1);
});

//Regression: the Install Update button was disabled unconditionally on click and never
//re-enabled, so a failed install (e.g. a wrong password) permanently bricked the popup with no
//way to retry.
test('regression: a failed install (non-zero exit code) re-enables the Install Update button', function(t){
  var doneCallback;
  var showInstallUpdate = freshInstallUpdateDisplay({
    installUpdate: function(pass, filepath, statusElement, onDone){
      doneCallback = onDone;
    }
  });

  showInstallUpdate('/tmp/pkg.deb');
  document.getElementById('install-pass').value = 'wrong-password';
  getInstallBtn().onclick();
  assert.strictEqual(getInstallBtn().disabled, true);

  doneCallback(1);

  assert.strictEqual(getInstallBtn().disabled, false);
  assert.strictEqual(document.activeElement.id, 'install-pass');
});

test('a successful install (exit code 0) leaves the Install Update button disabled', function(t){
  var doneCallback;
  var showInstallUpdate = freshInstallUpdateDisplay({
    installUpdate: function(pass, filepath, statusElement, onDone){
      doneCallback = onDone;
    }
  });

  showInstallUpdate('/tmp/pkg.deb');
  document.getElementById('install-pass').value = 'hunter2';
  getInstallBtn().onclick();

  doneCallback(0);

  assert.strictEqual(getInstallBtn().disabled, true);
});

test('clicking Close removes the popup', function(t){
  var showInstallUpdate = freshInstallUpdateDisplay({ installUpdate: function(){} });

  showInstallUpdate('/tmp/pkg.deb');
  getCloseBtn().onclick();

  assert.strictEqual(document.querySelector('.popup'), null);
});
