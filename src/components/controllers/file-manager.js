const fs = require('fs');
const { logError } = require('./error-log');

function copyFiles(filesToCopy, newLocation){
    try {
      filesToCopy.forEach((ftc, i) => {
        var newFileLoc = newLocation + "/" + ftc.split('/').pop();
        newFileLoc = makeFilenameUniqueIfExists(newFileLoc);

        fs.cpSync(ftc, newFileLoc, { recursive: true });
      });
    }
    catch(err){
      logError(err);
    }
}

function makeFilenameUniqueIfExists(fullpath){
  console.log('make this unique: ' + fullpath);
  try{
    var uniqueName = fullpath;

    if(fs.existsSync(fullpath)){
      if(fullpath.includes(".")){
        var fullpathSegs = fullpath.split('.');
        uniqueName = makeFilenameUniqueIfExists(fullpathSegs[0] + "_copy" + "." + fullpathSegs[fullpathSegs.length - 1]);
      }
      else {
        uniqueName = makeFilenameUniqueIfExists(fullpath + "_copy");
      }
    }

    return uniqueName;
  }
  catch(err){
    logError(err);
  }
}

function renameFiles(filesToRename, newName, location){
  try{
    if(filesToRename.length < 2){
        fs.renameSync(location + '/' + filesToRename[0], location + '/' + newName);
    }
    else {
      for(i=0;i<filesToRename.length;i++){
        var numberedName = '';
        var fileExt = '';

        if(filesToRename[i].includes('.')){
          var oldNameSegs = filesToRename[i].split('.');
          fileExt = "." + oldNameSegs[oldNameSegs.length - 1];
        }

        if (newName.includes('.')){
          var newNameSegs = newName.split('.');
          numberedName = newNameSegs[0] + "_" + i + fileExt;
        }
        else {
          numberedName = newName + "_" + i + fileExt;
        }

        fs.renameSync(location + '/' + filesToRename[i], location + '/' + numberedName);
      }
    }
  }
  catch(err){
    logError(err);
  }
}

function moveFiles(filesToMove, newLocation){
  try{
    filesToMove.forEach((ftm, i) => {
      var newFileLoc = newLocation + "/" + ftm.split('/').pop();

      fs.renameSync(ftm, newFileLoc);
    });
  }
  catch(err){
    logError(err);
  }
}

function createNewDirectory(dirName, dirLoc){
  try{
    if(fs.existsSync(dirLoc + "/" + dirName) == false)
      fs.mkdirSync(dirLoc + "/" + dirName);
  }
  catch(err){
    logError(err);
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

function getParentDirectory(filepath){
    var cutIndex = filepath.lastIndexOf('/');

    return cutIndex > 0 ? filepath.slice(0,cutIndex) : filepath;
}

function getFileList(dirPath){
  if(dirPath == '' || dirPath.slice(-1) == ':')
    dirPath += '/';

  try {
      return fs.readdirSync(dirPath, {withFileTypes: true}).filter(function(dirent){
        return dirent.name.charAt(0) !== '.';
      });
  } catch (err) {
      logError(err);
  }
}

function thisFileExists(filepath){
  try{
    return fs.existsSync(filepath);
  }
  catch(err){
    logError(err);
  }
}

module.exports = {
  copyFiles,
  renameFiles,
  moveFiles,
  createNewDirectory,
  deleteFile,
  getParentDirectory,
  getFileList,
  thisFileExists
}
