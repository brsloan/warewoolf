function displayExitConfirmation(docPath){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var warning = document.createElement('h1');
  warning.innerText = "WARNING: You have unsaved changes. Would you like to save first?";
  popup.appendChild(warning);

  var save = createButton("Save");
  save.onclick = function(){
    saveProject(docPath);
    exitApp();
  };
  popup.appendChild(save);

  var quit = createButton("Quit");
  quit.onclick = function(){
    exitApp();
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
