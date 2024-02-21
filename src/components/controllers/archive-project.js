const archiver = require('archiver');
const unzipper = require('unzipper');

function backupProject(docsDir, callback){
  try{
    docsDir = convertFilepath(docsDir);
    if(userSettings.backupDirectory == null || userSettings.backupDirectory == ""){
      userSettings.backupDirectory = createBackupsDirectory(docsDir);
      userSettings.save();
    }
    else{
      if(!fs.existsSync(userSettings.backupDirectory))
        fs.mkdirSync(userSettings.backupDirectory);
    }

    archiveProject(userSettings.backupDirectory, function(archName){
      deleteOldBackups();
      callback(archName);
    });
  }
  catch(err){
    logError(err);
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

function archiveProject(archiveDir, callback){
  if(project.filename != ""){
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
