var autosaveInterval;

function initiateAutosave(){
    if(userSettings.autosaveInterval > 0)
      autosaveInterval = setInterval(autoSave, userSettings.autosaveInterval * 60000);
}
  
function updateAutosave(){
    if(autosaveInterval == null)
        initiateAutosave();
    else {
        clearInterval(autosaveInterval);
        initiateAutosave();
    }
}
  
function autoSave(){
    console.log('autosaving...');
    saveProject(convertFilepath(__dirname));
}