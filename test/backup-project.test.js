const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const unzipper = require('unzipper');

const { backupProject, archiveProject, deleteOldBackups } = require('../src/components/controllers/backup-project');

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
  assert.strictEqual(userSettings.backupDirectory, path.join(docsDir, 'backups'));
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

test('deleteOldBackups keeps only the most recent N backups, matching filenames that contain extra dots', function(t){
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

  deleteOldBackups(project, userSettings);

  const remaining = fs.readdirSync(backupDir).sort();
  assert.deepStrictEqual(remaining, [
    'notes.final20250101000003.zip',
    'notes.final20250101000004.zip',
    'other.project20250101000001.zip',
    'other.project20250101000002.zip'
  ]);
});

test('deleteOldBackups does nothing when backupsToKeep is 0', function(t){
  const backupDir = makeTempDir(t, 'wwbackup-prune-');
  const project = { filename: 'notes.final.woolf' };
  const userSettings = { backupDirectory: backupDir, backupsToKeep: 0 };

  fs.writeFileSync(path.join(backupDir, 'notes.final20250101000001.zip'), '');

  deleteOldBackups(project, userSettings);

  assert.strictEqual(fs.readdirSync(backupDir).length, 1);
});
