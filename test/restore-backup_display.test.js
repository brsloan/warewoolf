const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JSDOM } = require('jsdom');
const { assertDialogDescribed, assertControlsNamed } = require('./helpers');
const { installBridge, uninstallBridge } = require('./fake-bridge');
const { normalizeSlashes } = require('../src/components/controllers/path-utils');

const restoreDisplayPath = require.resolve('../src/components/views/restore-backup_display');

//closePopups() also calls disableSearchView()/focusEditor(), which reach for this fixed shell by id.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

test.before(function(){ installBridge(); });
test.after(uninstallBridge);

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[restoreDisplayPath];
  delete global.window;
  delete global.document;
});

function makeBackupDir(t, filenames){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wwrestore-'));
  t.after(function(){ fs.rmSync(dir, { recursive: true, force: true }); });
  filenames.forEach(function(fn){ fs.writeFileSync(path.join(dir, fn), ''); });
  return normalizeSlashes(dir);
}

function optionTexts(){
  return Array.from(document.querySelectorAll('#restore-backup-select option')).map(function(o){ return o.innerText; });
}

test('lists only the open project\'s backups, newest first, and is described', async function(t){
  const dir = makeBackupDir(t, ['novel20250101093000.zip', 'novel20250301170000.zip', 'other20250201000000.zip']);
  const showRestoreBackup = require(restoreDisplayPath);

  const popup = await showRestoreBackup({ filename: 'novel.woolf' }, { backupDirectory: dir }, function(){});

  assertDialogDescribed(popup);
  assertControlsNamed(popup);
  const values = Array.from(document.querySelectorAll('#restore-backup-select option')).map(function(o){ return o.value; });
  assert.deepStrictEqual(values, [dir + '/novel20250301170000.zip', dir + '/novel20250101093000.zip']);
  assert.match(optionTexts()[0], /2025/);
  assert.strictEqual(document.getElementById('restore-backup-select').selectedIndex, 0);
});

test('the checkbox widens the list to every project, naming each', async function(t){
  const dir = makeBackupDir(t, ['novel20250101093000.zip', 'other20250201000000.zip']);
  const showRestoreBackup = require(restoreDisplayPath);
  await showRestoreBackup({ filename: 'novel.woolf' }, { backupDirectory: dir }, function(){});

  const check = document.getElementById('restore-all-projects-check');
  check.checked = true;
  await check.onchange();

  const texts = optionTexts();
  assert.strictEqual(texts.length, 2);
  assert.match(texts[0], / - other$/);
  assert.match(texts[1], / - novel$/);
});

test('says so, and disables Restore, when there are no backups', async function(t){
  const showRestoreBackup = require(restoreDisplayPath);
  await showRestoreBackup({ filename: 'novel.woolf' }, { backupDirectory: null }, function(){});

  assert.strictEqual(optionTexts().length, 0);
  assert.match(document.querySelector('.warning-text').innerText, /no backups yet/);
  const restore = Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent === 'Restore'; });
  assert.strictEqual(restore.disabled, true);
});

test('Restore unzips the chosen backup, closes, and hands over the restored project', async function(t){
  const { archiveProject } = require('../src/components/controllers/backup-project');
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'wwrestore-src-'));
  t.after(function(){ fs.rmSync(src, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(src, 'novel.woolf'), '{}');
  fs.mkdirSync(path.join(src, 'chapters'));
  const dir = makeBackupDir(t, []);
  const archiveName = await new Promise(function(resolve, reject){
    archiveProject({ filename: 'novel.woolf', directory: src, chapsDirectory: 'chapters' }, dir, function(err, name){
      err ? reject(err) : resolve(name);
    });
  });

  const showRestoreBackup = require(restoreDisplayPath);
  let opened = null;
  await showRestoreBackup({ filename: 'novel.woolf' }, { backupDirectory: dir }, function(p){ opened = p; });

  const restore = Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent === 'Restore'; });
  await restore.onclick();

  assert.strictEqual(opened, dir + '/' + archiveName.slice(0, -4) + '/novel.woolf');
  assert.ok(fs.existsSync(opened));
  assert.strictEqual(document.querySelector('.popup'), null);
});
