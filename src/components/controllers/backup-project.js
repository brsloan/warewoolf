const archiver = require('archiver');
const unzipper = require('unzipper');
const fs = require('fs');
const { logError } = require('./error-log');

function backupProject(project, userSettings, docsDir, callback){
  console.log('backing up project...');
  try{
    if(userSettings.backupDirectory == null || userSettings.backupDirectory == ""){
      userSettings.backupDirectory = createBackupsDirectory(docsDir);
      userSettings.save();
    }
    else{
      if(!fs.existsSync(userSettings.backupDirectory))
        fs.mkdirSync(userSettings.backupDirectory);
    }

    archiveProject(project, userSettings.backupDirectory, function(archName){
      deleteOldBackups();
      callback(archName);
    });
  }
  catch(err){
    logError(err);
    callback(err);
  }
}

function deleteOldBackups(){
  if(userSettings.backupsToKeep > 0){
    var backups = getFileList(userSettings.backupDirectory).map(function(ob){
      return ob.name;
    }).filter(function(filename){
      //remove the file extension and the 14-digit timestamp from filenames to filter to only this project's backups
      return filename.split('.')[0].slice(0,-14) == project.filename.replace('.woolf','');
    }).sort();

    if(backups.length > userSettings.backupsToKeep){
      var backupsToDel = backups.slice(0,userSettings.backupsToKeep * -1);
      backupsToDel.forEach(fn => {
        deleteFile(userSettings.backupDirectory + '/' + fn);
      });
    }
  }
}

function createBackupsDirectory(docsDir){
  const backupsDir = docsDir + "/backups";
  try{
    if(!fs.existsSync(backupsDir))
    fs.mkdirSync(backupsDir);
  }
  catch(err){
    logError(err);
  }
  return backupsDir;
}

function archiveProject(project, archiveDir, callback){
  if(project.filename != null && project.filename != ""){
    const archiveName = project.filename.replace('.woolf','') + getTimeStamp() + '.zip';
    const output = fs.createWriteStream(archiveDir + "/" + archiveName);
    const archive = archiver('zip', {
      zlib: { level: 9 }
    });

    archive.on('warning', function(err) {
      if (err.code === 'ENOENT') {
        logError(err);
      } else {
        throw err;
      }
    });

    archive.on('error', function(err) {
      callback('error');
      throw err;
    });

    archive.on('finish', function(){
      callback(archiveName);
    })

    archive.pipe(output);

    archive.file(project.directory + project.filename, { name: project.filename });
    archive.directory(project.directory + project.chapsDirectory, project.chapsDirectory);

    archive.finalize();
  }
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

function unzipProject(zipPath, callback){
  if(zipPath.includes('.zip')){
    try{
      fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: zipPath.replace('.zip','') }))
      .on('close', callback);
    }
    catch(err){
      logError(err);
    }
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
  }
}

module.exports = {
  backupProject, 
  archiveProject,
  unzipProject
}