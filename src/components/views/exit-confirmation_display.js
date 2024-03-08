const { closePopups, createButton, removeElementsByClass, saveProject } = require('../../render');


function displayExitConfirmation(continueFunc){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var warning = document.createElement('h1');
  warning.innerText = "WARNING:";
  popup.appendChild(warning);

  var subWarning = document.createElement('p');
  subWarning.innerText = 'You have unsaved changes. Would you like to save first?';
  subWarning.classList.add('warning-text');
  popup.appendChild(subWarning);

  var save = createButton("Save");
  save.onclick = function(){
    saveProject();
    closePopups();
    continueFunc();
  };
  popup.appendChild(save);

  var quit = createButton("Continue Without Saving");
  quit.onclick = function(){
    closePopups();
    continueFunc();
  };
  popup.appendChild(quit);

  var cancel = createButton("Cancel");
  cancel.onclick = function(){
    closePopups();
  };
  popup.appendChild(cancel);

  document.body.appendChild(popup);
  save.focus();
}

module.exports = displayExitConfirmation;