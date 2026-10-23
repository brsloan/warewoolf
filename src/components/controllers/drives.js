const { logError } = require('./error-log');
const { createPlatform } = require('./platform');
const { createIpcBacking } = require('./platform-ipc');

//The file dialogs' Drives list. A standing instance for the same reason wifi-manager.js keeps one:
//nothing here takes injected config.
var platform = createPlatform(createIpcBacking());

//UNAVAILABLE is the ordinary case somewhere (no lsblk, no udisksctl, no bridge in a test) and every
//file dialog asks, so only a genuine failure is logged.
function reportUnlessUnavailable(err){
  if(err == null || err.code !== 'UNAVAILABLE')
    logError(err);
}

//Never rejects: a dialog that cannot list drives still has its folders.
async function listDrives(){
  try{
    return await platform.listDrives();
  }
  catch(err){
    reportUnlessUnavailable(err);
    return [];
  }
}

//Resolves the path to browse. Rejects with the OS's own message, which the dialog shows the writer.
async function mountDrive(id){
  try{
    return (await platform.mountDrive({ id: id })).path;
  }
  catch(err){
    reportUnlessUnavailable(err);
    throw err;
  }
}

async function ejectDrive(id){
  try{
    await platform.ejectDrive({ id: id });
  }
  catch(err){
    reportUnlessUnavailable(err);
    throw err;
  }
}

module.exports = {
  listDrives,
  mountDrive,
  ejectDrive
}
