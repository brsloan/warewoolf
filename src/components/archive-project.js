const archiver = require('archiver');

function backupProject(docsDir){
  try{
    docsDir = convertFilepath(docsDir);
    if(userSettings.backupDirectory == null || userSettings.backupDirectory == ""){
      userSettings.backupDirectory = createBackupsDirectory(docsDir);
      userSettings.save();
    }

    const archive = archiveProject(userSettings.backupDirectory);
  }
  catch(err){
    logError(err);
  }
}

function createBackupsDirectory(docsDir){
  const backupsDir = docsDir + "/backups";
  if(!fs.existsSync(backupsDir))
    fs.mkdirSync(backupsDir);
  return backupsDir;
}

function archiveProject(archiveDir){
  var result = null;
  if(project.filename != ""){
    const archiveName = project.filename.replace('.woolf','') + getTimeStamp() + '.zip';
    const output = fs.createWriteStream(archiveDir + "/" + archiveName);
    const archive = archiver('zip', {
      zlib: { level: 9 } // Sets the compression level.
    });

      // good practice to catch warnings (ie stat failures and other non-blocking errors)
    archive.on('warning', function(err) {
      if (err.code === 'ENOENT') {
        // log warning
        logError(err);
      } else {
        // throw error
        throw err;
      }
    });

    // good practice to catch this error explicitly
    archive.on('error', function(err) {
      throw err;
    });

    // pipe archive data to the file
    archive.pipe(output);

    // append a file
    archive.file(project.directory + project.filename, { name: project.filename });
    archive.directory(project.directory + project.chapsDirectory, project.chapsDirectory);

    archive.finalize();
    result = archiveName;
  }
  return result;
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
