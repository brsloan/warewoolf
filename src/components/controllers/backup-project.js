const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const { logError } = require('./error-log');

//The message backupProject() sends once it is done. Callers watch for it to know the run has
//finished, so it is named here rather than string-matched at each of them.
const BACKUP_FINISHED = 'Backup finished.';
const TIMESTAMP_LENGTH = 14;
const ARCHIVE_EXTENSION = '.zip';

function backupProject(project, userSettings, docsDir, updatesFunction){
  updatesFunction('Backing up project...');
  try{
    if(userSettings.backupDirectory == null || userSettings.backupDirectory == ""){
      updatesFunction('Creating backup directory...');
      userSettings.backupDirectory = createBackupsDirectory(docsDir);
      userSettings.save();
    }
    else{
      updatesFunction('Checking if backup directory exists...');
      if(!fs.existsSync(userSettings.backupDirectory)){
        updatesFunction('Creating backup directory...');
        fs.mkdirSync(userSettings.backupDirectory);
      }
    }

    updatesFunction('Creating project archive...');
    archiveProject(project, userSettings.backupDirectory, function(err, archName){
      if(err){
        logError(err);
        updatesFunction(err);
        return;
      }
      updatesFunction('Archive saved. Deleting old archives...');
      deleteOldBackups(project, userSettings);
      updatesFunction(BACKUP_FINISHED);
    });
  }
  catch(err){
    logError(err);
    updatesFunction(err);
  }
}

function deleteOldBackups(project, userSettings){
  if(userSettings.backupsToKeep > 0){
    var backups = getFileList(userSettings.backupDirectory).map(function(ob){
      return ob.name;
    }).filter(function(filename){
      //remove the file extension and the 14-digit timestamp from filenames to filter to only this project's backups
      return filename.slice(0, -(ARCHIVE_EXTENSION.length + TIMESTAMP_LENGTH)) == project.filename.replace('.woolf','');
    }).sort();

    if(backups.length > userSettings.backupsToKeep){
      var backupsToDel = backups.slice(0,userSettings.backupsToKeep * -1);
      backupsToDel.forEach(fn => {
        deleteFile(path.join(userSettings.backupDirectory, fn));
      });
    }
  }
}

function createBackupsDirectory(docsDir){
  const backupsDir = path.join(docsDir, "backups");
  if(!fs.existsSync(backupsDir))
    fs.mkdirSync(backupsDir);
  return backupsDir;
}

function archiveProject(project, archiveDir, callback){
  if(project.filename == null || project.filename == ""){
    callback(new Error('Cannot back up a project with no filename.'));
    return;
  }

  const archiveName = project.filename.replace('.woolf','') + getTimeStamp() + ARCHIVE_EXTENSION;
  const output = fs.createWriteStream(path.join(archiveDir, archiveName));
  const archive = archiver('zip', {
    zlib: { level: 9 }
  });

  archive.on('warning', function(err) {
    logError(err);
  });

  archive.on('error', function(err) {
    callback(err);
  });

  archive.on('finish', function(){
    callback(null, archiveName);
  })

  archive.pipe(output);

  archive.file(path.join(project.directory, project.filename), { name: project.filename });
  archive.directory(path.join(project.directory, project.chapsDirectory), project.chapsDirectory);

  archive.finalize();
}

function getTimeStamp(){
  const d = new Date();

  return d.getFullYear().toString().concat(ldZero(d.getMonth() + 1),
    ldZero(d.getDate()), ldZero(d.getHours()),
    ldZero(d.getMinutes()), ldZero(d.getSeconds()));

  function ldZero(num){
    num = num.toString();
    if(num.length < 2)
      num = "0" + num;
    return num;
  }
}

function deleteFile(fpth){
  try {
    if(fs.existsSync(fpth))
      fs.rmSync(fpth, { recursive: true, force: true });
  }
  catch(err){
    logError(err);
  }
}

function getFileList(dirPath){
  try {
      return fs.readdirSync(dirPath, {withFileTypes: true});
  } catch (err) {
      logError(err);
      return [];
  }
}

module.exports = {
  BACKUP_FINISHED,
  backupProject,
  archiveProject,
  deleteOldBackups
}