const { basename, splitPath, join } = require('./path-utils');
const { logError } = require('./error-log');
const { createPlatform } = require('./platform');
const { createIpcBacking } = require('./platform-ipc');

//Every command this module calls takes a full path and no injected config, so this holds its own
//standing instance, the same reason file-manager.js/corkboard.js do.
var platform = createPlatform(createIpcBacking());

//The message backupProject() sends once it is done. Callers watch for it to know the run has
//finished, so it is named here rather than string-matched at each of them.
const BACKUP_FINISHED = 'Backup finished.';
const TIMESTAMP_LENGTH = 14;
const ARCHIVE_EXTENSION = '.zip';

function backupProject(project, userSettings, docsDir, updatesFunction){
  updatesFunction('Backing up project...');

  ensureBackupDirectory(userSettings, docsDir, updatesFunction)
    .then(function(){
      updatesFunction('Creating project archive...');

      archiveProject(project, userSettings.backupDirectory, function(err, archName){
        if(err){
          logError(err);
          updatesFunction(err);
          return;
        }

        updatesFunction('Archive saved. Deleting old archives...');
        deleteOldBackups(project, userSettings).then(function(){
          updatesFunction(BACKUP_FINISHED);
        }).catch(function(delErr){
          logError(delErr);
          updatesFunction(delErr);
        });
      });
    })
    .catch(function(err){
      logError(err);
      updatesFunction(err);
    });
}

function ensureBackupDirectory(userSettings, docsDir, updatesFunction){
  if(userSettings.backupDirectory == null || userSettings.backupDirectory == ""){
    updatesFunction('Creating backup directory...');

    return createBackupsDirectory(docsDir).then(function(dir){
      userSettings.backupDirectory = dir;
      userSettings.save();
    });
  }

  updatesFunction('Checking if backup directory exists...');

  return platform.pathExists({ path: userSettings.backupDirectory }).then(function(exists){
    if(exists)
      return;

    updatesFunction('Creating backup directory...');
    return platform.createDirectory({
      parent: splitPath(userSettings.backupDirectory).dir,
      name: basename(userSettings.backupDirectory)
    });
  });
}

//"Keep 10" used to mean the ten newest archives, and every close makes one - so a busy day of
//opening and closing could push out a week of backups in an afternoon. backupsToKeep still keeps
//that many of the newest, and on top of them the newest backup of each day for the last
//DAILY_TIER_DAYS days, and the newest of each week before that. 0 still means keep everything.
const DAILY_TIER_DAYS = 30;

async function deleteOldBackups(project, userSettings, now = new Date()){
  if(userSettings.backupsToKeep > 0){
    var entries = await platform.listBackups({ directory: userSettings.backupDirectory });
    var projectName = project.filename.replace('.woolf','');

    var backups = entries.filter(function(entry){
      return !entry.isDirectory && backupProjectName(entry.name) == projectName;
    }).map(function(entry){
      return entry.name;
    });

    var keep = selectBackupsToKeep(backups, userSettings.backupsToKeep, now);
    var backupsToDel = backups.filter(function(fn){ return !keep.includes(fn); });

    if(backupsToDel.length > 0){
      await platform.pruneBackups({
        paths: backupsToDel.map(function(fn){ return join(userSettings.backupDirectory, fn); })
      });
    }
  }
}

//Returns the filenames to keep, oldest first. The timestamp in each name sorts chronologically, so
//walking the sorted list from the end visits newest first, and the first backup seen in a day (or
//week) is the one that bucket keeps.
function selectBackupsToKeep(filenames, recentCount, now){
  var sorted = filenames.slice().sort();
  var keep = new Set(recentCount > 0 ? sorted.slice(-recentCount) : sorted);
  var dailyCutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - DAILY_TIER_DAYS);
  var bucketsSeen = new Set();

  for(var i = sorted.length - 1; i >= 0; i--){
    var date = backupDate(sorted[i]);
    var bucket = date >= dailyCutoff ? 'day ' + dayKey(date) : 'week ' + dayKey(startOfWeek(date));
    if(!bucketsSeen.has(bucket)){
      bucketsSeen.add(bucket);
      keep.add(sorted[i]);
    }
  }

  return sorted.filter(function(fn){ return keep.has(fn); });
}

//The project a backup belongs to: its filename with the 14-digit timestamp and extension taken off,
//or null for anything in the directory that is not one of our archives (a folder a writer unzipped
//there, a stray file).
function backupProjectName(filename){
  if(!filename.toLowerCase().endsWith(ARCHIVE_EXTENSION))
    return null;
  var stem = filename.slice(0, -ARCHIVE_EXTENSION.length);
  if(stem.length <= TIMESTAMP_LENGTH || !/^\d+$/.test(stem.slice(-TIMESTAMP_LENGTH)))
    return null;
  return stem.slice(0, -TIMESTAMP_LENGTH);
}

//The timestamp is the local time the archive was made (platform-node.js's archiveTimestamp).
function backupDate(filename){
  var ts = filename.slice(-(ARCHIVE_EXTENSION.length + TIMESTAMP_LENGTH), -ARCHIVE_EXTENSION.length);
  return new Date(Number(ts.slice(0, 4)), Number(ts.slice(4, 6)) - 1, Number(ts.slice(6, 8)),
    Number(ts.slice(8, 10)), Number(ts.slice(10, 12)), Number(ts.slice(12, 14)));
}

function dayKey(date){
  return date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate();
}

//Weeks start on Monday.
function startOfWeek(date){
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - (date.getDay() + 6) % 7);
}

//Every backup in the directory, newest first - only `projectFilename`'s when one is given. Feeds
//the Restore Backup dialog.
async function listProjectBackups(backupDirectory, projectFilename){
  var projectName = projectFilename ? projectFilename.replace('.woolf','') : null;
  var entries = await platform.listBackups({ directory: backupDirectory });

  return entries.filter(function(entry){
    var name = entry.isDirectory ? null : backupProjectName(entry.name);
    return name != null && (projectName == null || name == projectName);
  }).map(function(entry){
    return {
      filename: entry.name,
      path: join(backupDirectory, entry.name),
      project: backupProjectName(entry.name),
      date: backupDate(entry.name)
    };
  }).sort(function(a, b){
    return b.date - a.date;
  });
}

//Unzips a backup beside itself - the same place the File Manager's Unzip button puts it - into a
//folder no earlier restore is using, so restoring twice never writes over a copy someone has since
//edited. Resolves to the restored .woolf file's path.
async function restoreBackup(backupPath){
  var filename = basename(backupPath);
  var projectName = backupProjectName(filename);
  if(projectName == null)
    throw new Error('Not a WareWoolf backup: ' + filename);

  var base = backupPath.slice(0, -ARCHIVE_EXTENSION.length);
  var destPath = base;
  for(var n = 2; await platform.pathExists({ path: destPath }); n++)
    destPath = base + ' (' + n + ')';

  await platform.extractZip({ zipPath: backupPath, destPath: destPath });

  var projectPath = join(destPath, projectName + '.woolf');
  if(!(await platform.pathExists({ path: projectPath })))
    throw new Error('The backup was unzipped to ' + destPath + ', but it has no ' + projectName + '.woolf in it.');
  return projectPath;
}

//The create is used only for its side effect; the path handed back is built here rather than taken
//from the command's own return value, so this function's answer does not depend on what group E
//chooses to normalize.
//
//(Phase 9b) This is the one place the separator visibly changed. It used to be path.join(), which
//on Windows rewrote docsDir - already forward-slashed by index.js:517-522 - into backslashes, and
//that backslash form is what got persisted into userSettings.backupDirectory and shown in the
//settings field. join() here composes with '/' like the rest of the renderer, so a newly created
//backup directory now matches the convention every other path in the app already follows. Existing
//settings keep whatever they hold: splitPath/basename above normalize on the way in, so a stored
//backslash path is read exactly as it was before.
function createBackupsDirectory(docsDir){
  return platform.createDirectory({ parent: docsDir, name: 'backups' }).then(function(){
    return join(docsDir, 'backups');
  });
}

//Kept as a callback-style function (project, archiveDir, callback(err, archName)) rather than
//returning a promise - email-doc.js (group K, not yet converted) calls this directly and its own
//temp-file handling is deliberately left untouched until Phase 8.
function archiveProject(project, archiveDir, callback){
  if(project.filename == null || project.filename == ""){
    callback(new Error('Cannot back up a project with no filename.'));
    return;
  }

  platform.archiveProject({
    projectDir: project.directory,
    chapsDir: project.chapsDirectory,
    filename: project.filename,
    destDir: archiveDir
  }).then(function(result){
    callback(null, result.filename);
  }).catch(function(err){
    callback(err);
  });
}

module.exports = {
  BACKUP_FINISHED,
  backupProject,
  archiveProject,
  deleteOldBackups,
  selectBackupsToKeep,
  listProjectBackups,
  restoreBackup
}