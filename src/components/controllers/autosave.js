var autosaveInterval = null;

function initiateAutosave(minutes, save){
    if(autosaveInterval != null){
        clearInterval(autosaveInterval);
        autosaveInterval = null;
    }
    if(minutes > 0)
      autosaveInterval = setInterval(save, minutes * 60000);
}


function updateAutosave(minutes, save){
    initiateAutosave(minutes, save);
}

module.exports = {
    initiateAutosave,
    updateAutosave
};