var autosaveInterval;

function initiateAutosave(){
    if(userSettings.autosaveIntMinutes > 0)
      autosaveInterval = setInterval(autoSave, userSettings.autosaveIntMinutes * 60000);
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