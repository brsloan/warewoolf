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
        paths: backupsToDel.map(function(fn){ return join(userSettings.backupDirectory, fn); })
      });
    }
  }
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
  deleteOldBackups
}