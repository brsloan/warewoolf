const { logError } = require('./error-log');
const { createPlatform } = require('./platform');
const { createNodeBacking } = require('./platform-node');

//Group E's commands take no injected config at all - every one of them operates purely on the
//path(s) it is given, unlike groups A/D/I which need paths.app/userData wired in. So this module
//holds its own standing instance rather than needing setPlatform() wiring from render.js, the same
//reason corkboard.js does.
var platform = createPlatform(createNodeBacking({}));

//Every path this module is handed is normalized to forward slashes before any string-splitting is
//done on it, the same reason platform-node.js's own normalizePath() does this for group B/C paths -
//it means every helper below can split on '/' alone and still work with a Windows backslash path
//coming from an Electron dialog or a user-typed field.
function normalizeSlashes(p){
  return String(p).replaceAll('\\', '/');
}

function splitPath(fullPath){
  var normalized = normalizeSlashes(fullPath);
  var parts = normalized.split('/');
  var base = parts.pop();
  return { dir: parts.join('/'), base: base };
}

function basename(fullPath){
  return splitPath(fullPath).base;
}

//Splits only the base name's LAST extension - mirroring path.basename/path.extname rather than
//path's whole-path splitting, which is what corrupted a path with a dot in a parent directory's
//name (see the copyFiles regression tests). A name with no dot, or a dotfile with nothing before
//the dot, has no extension.
function extAndStem(base){
  var dot = base.lastIndexOf('.');
  if(dot <= 0)
    return { stem: base, ext: '' };
  return { stem: base.slice(0, dot), ext: base.slice(dot) };
}

//Renderer-side policy built out of the generic pathExists/statEntry primitives, exactly as the
//design note on moveEntry in platform.js describes - the uniqueness scheme itself (append "_copy"
//before the extension, recursing until free) is app behavior, not a filesystem concern.
async function makeFilenameUniqueIfExists(fullpath){
  try{
    var exists = await platform.pathExists({ path: fullpath });
    if(!exists)
      return fullpath;

    var split = splitPath(fullpath);
    var stat = await platform.statEntry({ path: fullpath });
    var extInfo = stat.isDirectory ? { stem: split.base, ext: '' } : extAndStem(split.base);

    return await makeFilenameUniqueIfExists(split.dir + '/' + extInfo.stem + '_copy' + extInfo.ext);
  }
  catch(err){
    logError(err);
    return fullpath;
  }
}

async function copyFiles(filesToCopy, newLocation){
  for(var i = 0; i < filesToCopy.length; i++){
    try{
      var newFileLoc = normalizeSlashes(newLocation) + '/' + basename(filesToCopy[i]);
      newFileLoc = await makeFilenameUniqueIfExists(newFileLoc);

      await platform.copyEntry({ source: filesToCopy[i], destination: newFileLoc, recursive: true });
    }
    catch(err){
      logError(err);
    }
  }
}

async function renameOneFile(location, oldName, newName){
  var source = normalizeSlashes(location) + '/' + oldName;
  var destination = normalizeSlashes(location) + '/' + newName;

  //Renaming to the same name (e.g. a case-only edit on a case-insensitive filesystem, or
  //submitting the input unchanged) isn't a collision - it's a no-op.
  if(source === destination)
    return;

  try{
    await platform.moveEntry({ source: source, destination: destination });
  }
  catch(err){
    //moveEntry refuses rather than overwriting an existing destination - report it the same way
    //this used to (logged, not thrown), rather than destroying the other file.
    if(err.code === 'ALREADY_EXISTS'){
      logError(new Error('Cannot rename "' + oldName + '" to "' + newName + '": "' + newName + '" already exists in ' + location));
      return;
    }
    logError(err);
  }
}

async function renameFiles(filesToRename, newName, location){
  try{
    if(filesToRename.length === 0)
      return;

    if(filesToRename.length === 1){
        await renameOneFile(location, filesToRename[0], newName);
    }
    else {
      var newNameStem = extAndStem(newName).stem;
      for(var i = 0; i < filesToRename.length; i++){
        var fileExt = extAndStem(filesToRename[i]).ext;
        var numberedName = newNameStem + '_' + i + fileExt;

        await renameOneFile(location, filesToRename[i], numberedName);
      }
    }
  }
  catch(err){
    logError(err);
  }
}

async function moveFiles(filesToMove, newLocation){
  for(var i = 0; i < filesToMove.length; i++){
    try{
      var newFileLoc = normalizeSlashes(newLocation) + '/' + basename(filesToMove[i]);
      //Same overwrite risk moveEntry itself refuses on - moveFiles' cut-paste policy is to
      //auto-uniquify instead, computed here the same way copyFiles does, rather than baked into the
      //generic command.
      newFileLoc = await makeFilenameUniqueIfExists(newFileLoc);

      await platform.moveEntry({ source: filesToMove[i], destination: newFileLoc });
    }
    catch(err){
      logError(err);
    }
  }
}

async function createNewDirectory(dirName, dirLoc){
  try{
    await platform.createDirectory({ parent: dirLoc, name: dirName });
  }
  catch(err){
    logError(err);
  }
}

async function deleteFile(fpth){
  try{
    await platform.deleteEntry({ path: fpth, recursive: true });
  }
  catch(err){
    logError(err);
  }
}

//Pure string work - stays synchronous, since it never touches the filesystem.
function getParentDirectory(filepath){
  var normalized = normalizeSlashes(filepath);
  var cutIndex = normalized.lastIndexOf('/');

  if(cutIndex < 0)
    return filepath;

  //A path like "/etc" has its one "/" at index 0 - slicing to that index would return "",
  //not the root, so this used to return the path unchanged instead of climbing to "/".
  return cutIndex === 0 ? '/' : normalized.slice(0, cutIndex);
}

//Dotfile filtering is this module's own policy, not the generic listDirectory command's - see the
//note on that command in platform.js.
async function getFileList(dirPath){
  if(dirPath == '' || dirPath.slice(-1) == ':')
    dirPath += '/';

  try{
    var entries = await platform.listDirectory({ path: dirPath });
    return entries.filter(function(entry){
      return entry.name.charAt(0) !== '.';
    });
  }
  catch(err){
    logError(err);
  }
}

async function thisFileExists(filepath){
  try{
    return await platform.pathExists({ path: filepath });
  }
  catch(err){
    logError(err);
  }
}

//Group F: extractZip. unzipper is Node-stream-only and has no browser path (see the inventory), so
//this stays a thin wrapper around the native command rather than folding into the group E rewrite
//above - the same reason group E's own commands stay generic filesystem primitives.
async function unzipProject(zipPath, callback){
  if(zipPath.toLowerCase().endsWith('.zip')){
    try{
      //Slicing off the trailing ".zip" instead of replace('.zip','') - replace() rewrites the
      //first occurrence anywhere in the path, so a path like ".../myzip.zipfiles/notes.zip"
      //extracted to the wrong directory.
      var extractPath = zipPath.slice(0, -4);

      await platform.extractZip({ zipPath: zipPath, destPath: extractPath });
      callback();
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
