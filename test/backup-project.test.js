const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const unzipper = require('unzipper');

const BACKSLASH = String.fromCharCode(92);

const { backupProject, archiveProject, deleteOldBackups, selectBackupsToKeep, listProjectBackups, restoreBackup } = require('../src/components/controllers/backup-project');
const { normalizeSlashes } = require('../src/components/controllers/path-utils');

//The modules under test hold their own createPlatform(createIpcBacking()) instance and reach the
//machine through window.warewoolf, exactly as they do in the app. This puts a bridge there, with a
//real node backing (and a real structured-clone boundary) behind it - so these tests still assert
//against real files in real temp directories, and now also prove the arguments and results survive
//being sent somewhere.
const { installBridge, uninstallBridge } = require('./fake-bridge');

test.before(function(){ installBridge(); });
test.after(uninstallBridge);

function makeTempDir(t, prefix){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(function(){
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

//filename deliberately contains a dot beyond the .woolf extension - this is what the old
//split('.')[0] filename parsing in deleteOldBackups got wrong (see that test below).
function makeProjectFixture(t){
  const sourceDir = makeTempDir(t, 'wwbackup-src-');
  const filename = 'notes.final.woolf';
  fs.writeFileSync(path.join(sourceDir, filename), '{"title":"test"}', 'utf8');
  const chapsDirectory = 'chapters';
  fs.mkdirSync(path.join(sourceDir, chapsDirectory));
  fs.writeFileSync(path.join(sourceDir, chapsDirectory, 'chap1.txt'), 'chapter one', 'utf8');

  return {
    filename: filename,
    directory: sourceDir,
    chapsDirectory: chapsDirectory
  };
}

test('archiveProject zips the project file and chapters directory', async function(t){
  const project = makeProjectFixture(t);
  const archiveDir = makeTempDir(t, 'wwbackup-out-');

  const archiveName = await new Promise(function(resolve, reject){
    archiveProject(project, archiveDir, function(err, name){
      if(err) reject(err);
      else resolve(name);
    });
  });

  assert.match(archiveName, /^notes\.final\d{14}\.zip$/);

  const archivePath = path.join(archiveDir, archiveName);
  assert.ok(fs.existsSync(archivePath));

  const dir = await unzipper.Open.file(archivePath);
  const entryPaths = dir.files.map(f => f.path);
  assert.ok(entryPaths.includes(project.filename), 'zip is missing the project file');
  assert.ok(entryPaths.includes(project.chapsDirectory + '/chap1.txt'), 'zip is missing the chapters directory');
});

test('archiveProject reports an error instead of hanging when the project has no filename', async function(t){
  const archiveDir = makeTempDir(t, 'wwbackup-out-');
  const project = { filename: '', directory: archiveDir, chapsDirectory: 'chapters' };

  const err = await new Promise(function(resolve){
    archiveProject(project, archiveDir, function(err){
      resolve(err);
    });
  });

  assert.ok(err instanceof Error);
  assert.strictEqual(fs.readdirSync(archiveDir).length, 0, 'no archive should have been written');
});

test('backupProject creates the backup directory on first run, persists it, and writes an archive', async function(t){
  const project = makeProjectFixture(t);
  const docsDir = makeTempDir(t, 'wwbackup-docs-');

  let saveCalls = 0;
  const userSettings = {
    backupDirectory: null,
    backupsToKeep: 0,
    save: function(){ saveCalls++; }
  };

  const messages = [];
  const finalMessage = await new Promise(function(resolve){
    backupProject(project, userSettings, docsDir, function(update){
      messages.push(update);
      if(update === 'Backup finished.' || update instanceof Error)
        resolve(update);
    });
  });

  assert.strictEqual(finalMessage, 'Backup finished.');
  //(Phase 9b) Asserted as a forward-slash composition rather than as path.join(docsDir, 'backups'),
  //which is what this said before and what it had to stop saying. createBackupsDirectory used to
  //build this with path.join, so on Windows it persisted 'C:\...\Documents\backups' into
  //user-settings.json even though docsDir arrived forward-slashed from index.js - and a test
  //written with path.join agreed with it on both hosts while pinning two different answers. The
  //renderer composes with '/' everywhere now (path-utils.js), so this states the one answer.
  assert.strictEqual(userSettings.backupDirectory, normalizeSlashes(docsDir) + '/backups');
  assert.strictEqual(saveCalls, 1, 'userSettings.save() should be called once the backup directory is created');

  const backups = fs.readdirSync(userSettings.backupDirectory);
  assert.strictEqual(backups.length, 1);
  assert.match(backups[0], /^notes\.final\d{14}\.zip$/);
});

test('backupProject reports the error instead of silently finishing when archiving fails', async function(t){
  const docsDir = makeTempDir(t, 'wwbackup-docs-');
  const project = { filename: '', directory: docsDir, chapsDirectory: 'chapters' };
  const userSettings = { backupDirectory: null, backupsToKeep: 0, save: function(){} };

  const messages = [];
  const result = await new Promise(function(resolve){
    backupProject(project, userSettings, docsDir, function(update){
      messages.push(update);
      if(update instanceof Error || update === 'Backup finished.')
        resolve(update);
    });
  });

  assert.ok(result instanceof Error);
  assert.ok(!messages.includes('Backup finished.'));
});

test('deleteOldBackups keeps only the most recent N backups, matching filenames that contain extra dots', async function(t){
  const backupDir = makeTempDir(t, 'wwbackup-prune-');
  //Regression for the old `filename.split('.')[0]` parsing, which truncated at the first dot
  //and so never matched real backups for a project whose name contains a dot.
  const project = { filename: 'notes.final.woolf' };
  const userSettings = { backupDirectory: backupDir, backupsToKeep: 2 };

  const projectTimestamps = ['20250101000001', '20250101000002', '20250101000003', '20250101000004'];
  projectTimestamps.forEach(function(ts){
    fs.writeFileSync(path.join(backupDir, 'notes.final' + ts + '.zip'), '');
  });

  //Unrelated project's backups, also with a dot in the name, should be left alone.
  ['20250101000001', '20250101000002'].forEach(function(ts){
    fs.writeFileSync(path.join(backupDir, 'other.project' + ts + '.zip'), '');
  });

  await deleteOldBackups(project, userSettings);

  const remaining = fs.readdirSync(backupDir).sort();
  assert.deepStrictEqual(remaining, [
    'notes.final20250101000003.zip',
    'notes.final20250101000004.zip',
    'other.project20250101000001.zip',
    'other.project20250101000002.zip'
  ]);
});

//The other half of the change above: a settings file written by an earlier version holds a
//backslash backupDirectory, and 9b must not have stranded it. splitPath/basename/join all
//normalize on the way in, so the stored form still resolves - both for the prune paths built off
//it and for the directory itself.
test('deleteOldBackups still works from a backslash backupDirectory left by an older version', async function(t){
  const backupDir = makeTempDir(t, 'wwbackup-legacy-');
  const project = { filename: 'notes.final.woolf' };
  //The exact shape path.join() used to persist on Windows.
  const userSettings = {
    backupDirectory: backupDir.split('/').join(BACKSLASH),
    backupsToKeep: 1
  };

  ['20250101000001', '20250101000002'].forEach(function(ts){
    fs.writeFileSync(path.join(backupDir, 'notes.final' + ts + '.zip'), '');
  });

  await deleteOldBackups(project, userSettings);

  assert.deepStrictEqual(fs.readdirSync(backupDir), ['notes.final20250101000002.zip']);
});

test('deleteOldBackups does nothing when backupsToKeep is 0', async function(t){
  const backupDir = makeTempDir(t, 'wwbackup-prune-');
  const project = { filename: 'notes.final.woolf' };
  const userSettings = { backupDirectory: backupDir, backupsToKeep: 0 };

  fs.writeFileSync(path.join(backupDir, 'notes.final20250101000001.zip'), '');

  await deleteOldBackups(project, userSettings);

  assert.strictEqual(fs.readdirSync(backupDir).length, 1);
});

function backupName(project, date){
  function pad(n){ return String(n).padStart(2, '0'); }
  return project + date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate())
    + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds()) + '.zip';
}

//The reason the tiers exist: a busy day used to push out everything older than its own closes.
test('selectBackupsToKeep keeps a busy day\'s backups without losing the days before it', function(){
  const now = new Date(2026, 9, 23, 18, 0, 0);
  const names = [];
  for(let d = 1; d <= 7; d++)
    names.push(backupName('novel', new Date(2026, 9, 23 - d, 12, 0, 0)));
  for(let h = 0; h < 15; h++)
    names.push(backupName('novel', new Date(2026, 9, 23, 8, h, 0)));

  const kept = selectBackupsToKeep(names, 10, now);

  //The ten newest closes of today, plus one for each of the seven days before.
  assert.strictEqual(kept.length, 17);
  for(let d = 1; d <= 7; d++)
    assert.ok(kept.includes(backupName('novel', new Date(2026, 9, 23 - d, 12, 0, 0))), 'lost day -' + d);
});

test('selectBackupsToKeep keeps the newest of each day for 30 days, then the newest of each week', function(){
  const now = new Date(2026, 9, 23, 18, 0, 0); //a Friday
  const names = [];
  //Two backups a day for 90 days.
  for(let d = 0; d < 90; d++){
    names.push(backupName('novel', new Date(2026, 9, 23 - d, 9, 0, 0)));
    names.push(backupName('novel', new Date(2026, 9, 23 - d, 17, 0, 0)));
  }

  const kept = selectBackupsToKeep(names, 1, now);

  //Inside the month: only the evening backup of each day survives.
  assert.ok(kept.includes(backupName('novel', new Date(2026, 9, 10, 17, 0, 0))));
  assert.ok(!kept.includes(backupName('novel', new Date(2026, 9, 10, 9, 0, 0))));

  //Past it: one per Monday-to-Sunday week - the Sunday evening one, the newest in its week. The
  //newest of them is the exception: the week the cutoff falls in only has its days before the
  //cutoff in this tier, so its newest is the last day before the month began.
  const old = kept.filter(function(fn){ return fn < backupName('novel', new Date(2026, 8, 23)); });
  assert.strictEqual(old[old.length - 1], backupName('novel', new Date(2026, 8, 22, 17, 0, 0)));
  old.slice(0, -1).forEach(function(fn){
    const ts = fn.slice(5, 13);
    assert.strictEqual(new Date(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8)).getDay(), 0, fn + ' is not a Sunday');
  });
  //And no two of those in the same week.
  assert.strictEqual(new Set(old).size, old.length);
  assert.ok(old.length >= 8 && old.length <= 10, 'expected about nine weekly backups, got ' + old.length);
});

test('deleteOldBackups ignores folders and stray files in the backup directory', async function(t){
  const backupDir = makeTempDir(t, 'wwbackup-prune-');
  const project = { filename: 'novel.woolf' };
  const userSettings = { backupDirectory: backupDir, backupsToKeep: 1 };

  fs.writeFileSync(path.join(backupDir, 'novel20250101000001.zip'), '');
  fs.writeFileSync(path.join(backupDir, 'novel20250101000002.zip'), '');
  fs.mkdirSync(path.join(backupDir, 'novel20250101000001'));
  fs.writeFileSync(path.join(backupDir, 'novel-notes.txt'), '');

  await deleteOldBackups(project, userSettings, new Date(2026, 9, 23));

  assert.deepStrictEqual(fs.readdirSync(backupDir).sort(), [
    'novel-notes.txt', 'novel20250101000001', 'novel20250101000002.zip'
  ]);
});

test('listProjectBackups lists one project\'s backups or every project\'s, newest first', async function(t){
  const backupDir = makeTempDir(t, 'wwbackup-list-');
  ['novel20250101000001.zip', 'novel20250301000001.zip', 'other20250201000001.zip', 'readme.txt'].forEach(function(fn){
    fs.writeFileSync(path.join(backupDir, fn), '');
  });
  fs.mkdirSync(path.join(backupDir, 'novel20250101000001'));

  const mine = await listProjectBackups(backupDir, 'novel.woolf');
  assert.deepStrictEqual(mine.map(b => b.filename), ['novel20250301000001.zip', 'novel20250101000001.zip']);
  assert.strictEqual(mine[0].project, 'novel');
  assert.strictEqual(mine[0].date.getMonth(), 2);

  const all = await listProjectBackups(backupDir, null);
  assert.deepStrictEqual(all.map(b => b.filename), [
    'novel20250301000001.zip', 'other20250201000001.zip', 'novel20250101000001.zip'
  ]);
});

test('restoreBackup unzips beside the archive, never over an earlier restore, and returns the project path', async function(t){
  const project = makeProjectFixture(t);
  const archiveDir = makeTempDir(t, 'wwbackup-restore-');

  const archiveName = await new Promise(function(resolve, reject){
    archiveProject(project, archiveDir, function(err, name){ err ? reject(err) : resolve(name); });
  });
  const archivePath = normalizeSlashes(path.join(archiveDir, archiveName));
  const folder = archivePath.slice(0, -4);

  const first = await restoreBackup(archivePath);
  assert.strictEqual(first, folder + '/' + project.filename);
  assert.strictEqual(fs.readFileSync(path.join(folder, 'chapters', 'chap1.txt'), 'utf8'), 'chapter one');

  const second = await restoreBackup(archivePath);
  assert.strictEqual(second, folder + ' (2)/' + project.filename);
  assert.ok(fs.existsSync(second));
});

test('restoreBackup refuses a file that is not a backup', async function(t){
  await assert.rejects(restoreBackup('/somewhere/notes.zip'), /Not a WareWoolf backup/);
});
