const path = require('path');
const { logError } = require('./error-log');
const { createPlatform } = require('./platform');
const { createNodeBacking } = require('./platform-node');

//Every command this module calls takes a full path and no injected config, so this holds its own
//standing instance, the same reason file-manager.js/corkboard.js do.
var platform = createPlatform(createNodeBacking({}));

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
      parent: path.dirname(userSettings.backupDirectory),
      name: path.basename(userSettings.backupDirectory)
    });
  });
}

async function deleteOldBackups(project, userSettings){
  if(userSettings.backupsToKeep > 0){
    var entries = await platform.listBackups({ directory: userSettings.backupDirectory });

    var backups = entries.map(function(ob){
      return ob.name;
    }).filter(function(filename){
      //remove the file extension and the 14-digit timestamp from filenames to filter to only this project's backups
      return filename.slice(0, -(ARCHIVE_EXTENSION.length + TIMESTAMP_LENGTH)) == project.filename.replace('.woolf','');
    }).sort();

    if(backups.length > userSettings.backupsToKeep){
      var backupsToDel = backups.slice(0, userSettings.backupsToKeep * -1);

      await platform.pruneBackups({
        paths: backupsToDel.map(function(fn){ return path.join(userSettings.backupDirectory, fn); })
      });
    }
  }
}

//createDirectory (group E) normalizes its returned path to forward slashes, which would not match
//a caller comparing against path.join(docsDir, 'backups') on Windows even though both name the same
//directory - the create is used only for its side effect, and the path handed back is built the
//same way the original createBackupsDirectory built it.
function createBackupsDirectory(docsDir){
  return platform.createDirectory({ parent: docsDir, name: 'backups' }).then(function(){
    return path.join(docsDir, 'backups');
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
  deleteOldBackups
}