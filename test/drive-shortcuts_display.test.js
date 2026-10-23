const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const fileDialogDisplayPath = require.resolve('../src/components/views/file-dialog_display');
const driveShortcutsPath = require.resolve('../src/components/views/drive-shortcuts_display');
const fileManagerPath = require.resolve('../src/components/controllers/file-manager');
const drivesPath = require.resolve('../src/components/controllers/drives');

function primeModule(modulePath, exports){
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: exports };
}

//Driven through the real file dialog, so what is checked is the Drives list as a writer meets it,
//including that the dialog's own Enter handler leaves drive entries alone.
function freshFileDialog(mocks){
  delete require.cache[fileDialogDisplayPath];
  delete require.cache[driveShortcutsPath];
  primeModule(fileManagerPath, {
    getFileList: mocks.getFileList || async function(){ return []; },
    getParentDirectory: function(p){ return p.slice(0, p.lastIndexOf('/')) || '/'; }
  });
  primeModule(drivesPath, {
    listDrives: mocks.listDrives,
    mountDrive: mocks.mountDrive || async function(){ throw new Error('unexpected mount'); },
    ejectDrive: mocks.ejectDrive || async function(){ throw new Error('unexpected eject'); }
  });
  return require(fileDialogDisplayPath);
}

function flush(){
  return new Promise(function(resolve){ setImmediate(resolve); });
}

async function press(target, key, init){
  target.dispatchEvent(new window.KeyboardEvent('keydown', Object.assign({ key: key, bubbles: true, cancelable: true }, init)));
  await flush();
  await flush();
}

function options(){
  return {
    title: 'Choose a folder',
    defaultPath: '/home/pi/Documents',
    filters: [],
    bookmarkedPaths: ['/home/pi/Documents', '/home/pi'],
    projectDirectory: '',
    dialogType: 'chooseDirectory'
  };
}

const STICK = { id: '/dev/sda1', name: 'STICK', path: '/media/pi/STICK', mounted: true, removable: true };

async function openDialog(mocks){
  const showFileDialog = freshFileDialog(mocks);
  await showFileDialog(options(), mocks.callback || function(){});
  await flush();
  return {
    shortcuts: document.querySelector('.file-dir-shortcuts'),
    currentDir: document.querySelector('.popup-dialog p'),
    status: document.querySelector('.drive-status')
  };
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body><div id="editor-container"><div class="ql-editor"></div></div></body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  [fileDialogDisplayPath, driveShortcutsPath, fileManagerPath, drivesPath].forEach(function(p){ delete require.cache[p]; });
  delete global.window;
  delete global.document;
});

test('drives are listed under the folder shortcuts, an unmounted one marked as such', async function(){
  const dialog = await openDialog({
    listDrives: async function(){ return [STICK, { id: '/dev/sdb1', name: 'BACKUP', path: null, mounted: false, removable: true }]; }
  });

  const labels = Array.from(dialog.shortcuts.options).map(function(o){ return o.innerText; });
  assert.deepStrictEqual(labels, ['> Documents', '> pi', '-- Drives --', '> STICK', '+ BACKUP (not mounted)']);
  assert.ok(dialog.shortcuts.options[2].disabled, 'the heading is not selectable');
});

test('no Drives heading appears when there are no drives to offer', async function(){
  const dialog = await openDialog({ listDrives: async function(){ return []; } });

  assert.strictEqual(dialog.shortcuts.querySelector('.drive-heading'), null);
});

test('Enter on a mounted drive browses it, once', async function(){
  const listed = [];
  const dialog = await openDialog({
    listDrives: async function(){ return [STICK]; },
    getFileList: async function(p){ listed.push(p); return []; }
  });
  listed.length = 0;

  dialog.shortcuts.value = '/dev/sda1';
  await press(dialog.shortcuts, 'Enter');

  assert.deepStrictEqual(listed, ['/media/pi/STICK']);
  assert.strictEqual(dialog.currentDir.innerText, '/media/pi/STICK');
});

test('Enter on an unmounted drive mounts it and then browses where it landed', async function(){
  const mounted = [];
  const dialog = await openDialog({
    listDrives: async function(){ return [{ id: '/dev/sda1', name: 'STICK', path: null, mounted: false, removable: true }]; },
    mountDrive: async function(id){ mounted.push(id); return '/media/pi/STICK'; }
  });

  dialog.shortcuts.value = '/dev/sda1';
  await press(dialog.shortcuts, 'Enter');

  assert.deepStrictEqual(mounted, ['/dev/sda1']);
  assert.strictEqual(dialog.currentDir.innerText, '/media/pi/STICK');
  assert.strictEqual(dialog.shortcuts.selectedOptions[0].innerText, '> STICK');
});

test("a failed mount says why and stays where it was", async function(){
  const dialog = await openDialog({
    listDrives: async function(){ return [{ id: '/dev/sda1', name: 'STICK', path: null, mounted: false, removable: true }]; },
    mountDrive: async function(){ throw new Error('udisksctl is not installed'); }
  });

  dialog.shortcuts.value = '/dev/sda1';
  await press(dialog.shortcuts, 'Enter');

  assert.match(dialog.status.innerText, /Could not mount STICK: udisksctl is not installed/);
  assert.strictEqual(dialog.currentDir.innerText, '/home/pi/Documents');
});

test('Ctrl+E ejects the drive, moves off it if it was showing, and drops it from the list', async function(){
  var attached = [STICK];
  const ejected = [];
  const dialog = await openDialog({
    listDrives: async function(){ return attached; },
    ejectDrive: async function(id){ ejected.push(id); attached = []; }
  });

  dialog.shortcuts.value = '/dev/sda1';
  await press(dialog.shortcuts, 'Enter');
  assert.strictEqual(dialog.currentDir.innerText, '/media/pi/STICK');

  await press(dialog.shortcuts, 'e', { ctrlKey: true });

  assert.deepStrictEqual(ejected, ['/dev/sda1']);
  assert.match(dialog.status.innerText, /STICK can be removed safely/);
  assert.strictEqual(dialog.currentDir.innerText, '/home/pi/Documents');
  assert.strictEqual(dialog.shortcuts.querySelector('.drive-shortcut'), null);
});

test('a refused eject says why and keeps the drive listed', async function(){
  const dialog = await openDialog({
    listDrives: async function(){ return [STICK]; },
    ejectDrive: async function(){ throw new Error('target is busy'); }
  });

  dialog.shortcuts.value = '/dev/sda1';
  await press(dialog.shortcuts, 'e', { ctrlKey: true });

  assert.match(dialog.status.innerText, /Could not eject STICK: target is busy/);
  assert.ok(dialog.shortcuts.querySelector('.drive-shortcut'));
});

test('Ctrl+E on a folder shortcut does nothing', async function(){
  const dialog = await openDialog({ listDrives: async function(){ return [STICK]; } });

  dialog.shortcuts.selectedIndex = 0;
  await press(dialog.shortcuts, 'e', { ctrlKey: true });

  assert.ok(!dialog.status.innerText);
});

test('a drive plugged in while the dialog is open shows up when the shortcuts list takes focus', async function(){
  var attached = [];
  const dialog = await openDialog({ listDrives: async function(){ return attached; } });
  assert.strictEqual(dialog.shortcuts.querySelector('.drive-shortcut'), null);

  attached = [STICK];
  dialog.shortcuts.dispatchEvent(new window.FocusEvent('focus'));
  await flush();

  assert.ok(dialog.shortcuts.querySelector('.drive-shortcut'));
});
