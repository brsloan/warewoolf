const fs = require('fs');
const path = require('path');
const { logError } = require('./error-log');

function copyFiles(filesToCopy, newLocation){
    filesToCopy.forEach((ftc) => {
      try {
        var newFileLoc = newLocation + "/" + path.basename(ftc);
        newFileLoc = makeFilenameUniqueIfExists(newFileLoc);

        fs.cpSync(ftc, newFileLoc, { recursive: true });
      }
      catch(err){
        logError(err);
      }
    });
}

//Splits only the basename's last extension (via path.basename/extname), not every "." in the
//full path - splitting the whole path broke on any parent directory name containing a dot
//(e.g. "C:/Users/John.Doe/notes" produced "C:/Users/John_copy.Doe/notes"), and multi-dot
//filenames lost everything between the first and last dot (e.g. "archive.tar.gz" -> "archive_copy.gz").
function makeFilenameUniqueIfExists(fullpath){
  try{
    var uniqueName = fullpath;

    if(fs.existsSync(fullpath)){
      var dir = path.dirname(fullpath);
      var base = path.basename(fullpath);
      var isDirectory = fs.statSync(fullpath).isDirectory();
      var ext = isDirectory ? '' : path.extname(base);
      var nameWithoutExt = ext ? base.slice(0, -ext.length) : base;

      uniqueName = makeFilenameUniqueIfExists(dir + "/" + nameWithoutExt + "_copy" + ext);
    }

    return uniqueName;
  }
  catch(err){
    logError(err);
    return fullpath;
  }
}

function renameOneFile(location, oldName, newName){
  var source = location + "/" + oldName;
  var destination = location + "/" + newName;

  //Renaming to the same name (e.g. a case-only edit on a case-insensitive filesystem, or
  //submitting the input unchanged) isn't a collision - it's a no-op.
  if(path.resolve(source) === path.resolve(destination))
    return;

  //fs.renameSync silently overwrites an existing destination - refuse instead of destroying
  //another file, rather than clobbering it the way this used to.
  if(fs.existsSync(destination)){
    logError(new Error('Cannot rename "' + oldName + '" to "' + newName + '": "' + newName + '" already exists in ' + location));
    return;
  }

  fs.renameSync(source, destination);
}

function renameFiles(filesToRename, newName, location){
  try{
    if(filesToRename.length === 0)
      return;

    if(filesToRename.length === 1){
        renameOneFile(location, filesToRename[0], newName);
    }
    else {
      for(var i=0;i<filesToRename.length;i++){
        var fileExt = path.extname(filesToRename[i]);
        var newNameExt = path.extname(newName);
        var newNameBase = newNameExt ? newName.slice(0, -newNameExt.length) : newName;
        var numberedName = newNameBase + "_" + i + fileExt;

        renameOneFile(location, filesToRename[i], numberedName);
      }
    }
  }
  catch(err){
    logError(err);
  }
}

function moveFiles(filesToMove, newLocation){
  filesToMove.forEach((ftm) => {
    try{
      var newFileLoc = newLocation + "/" + path.basename(ftm);
      //Same overwrite risk as renameFiles - without this, cutting and pasting onto a file with
      //the same name used to silently destroy it, unlike copyFiles which already protects against it.
      newFileLoc = makeFilenameUniqueIfExists(newFileLoc);

      fs.renameSync(ftm, newFileLoc);
    }
    catch(err){
      logError(err);
    }
  });
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

    if(cutIndex < 0)
      return filepath;

    //A path like "/etc" has its one "/" at index 0 - slicing to that index would return "",
    //not the root, so this used to return the path unchanged instead of climbing to "/".
    return cutIndex === 0 ? '/' : filepath.slice(0,cutIndex);
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

function unzipProject(zipPath, callback){
  const unzipper = require('unzipper');
  if(zipPath.toLowerCase().endsWith('.zip')){
    try{
      //Slicing off the trailing ".zip" instead of replace('.zip','') - replace() rewrites the
      //first occurrence anywhere in the path, so a path like ".../myzip.zipfiles/notes.zip"
      //extracted to the wrong directory.
      var extractPath = zipPath.slice(0, -4);

      fs.createReadStream(zipPath)
      .on('error', logError)
      .pipe(unzipper.Extract({ path: extractPath }))
      .on('error', logError)
      .on('close', callback);
    }
    catch(err){
      logError(err);
    }
  }
  else {
    //Previously a non-.zip path was a silent no-op: callback never fired and nothing was logged,
    //which could leave a caller waiting on the callback to refresh its UI.
    logError(new Error('unzipProject called with a non-zip path: ' + zipPath));
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
  thisFileExists,
  unzipProject
}
