function displayExitConfirmation(docPath, continueFunc){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var warning = document.createElement('h1');
  warning.innerText = "WARNING:";
  popup.appendChild(warning);

  var subWarning = document.createElement('p');
  subWarning.innerText = 'You have unsaved changes. Would you like to save first?';
  popup.appendChild(subWarning);

  var save = createButton("Save");
  save.onclick = function(){
    saveProject(docPath);
    closePopups();
    continueFunc(docPath);
  };
  popup.appendChild(save);

  var quit = createButton("Continue");
  quit.onclick = function(){
    closePopups();
    continueFunc(docPath);
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
