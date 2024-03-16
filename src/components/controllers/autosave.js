var autosaveInterval;

function initiateAutosave(minutes, save){
    if(minutes > 0)
      autosaveInterval = setInterval(save, minutes * 60000);
}
  

function updateAutosave(minutes, save){
    if(autosaveInterval == null)
        initiateAutosave(minutes, save);
    else {
        clearInterval(autosaveInterval);
        initiateAutosave(minutes, save);
    }
}

module.exports = {
    initiateAutosave,
    updateAutosave
};