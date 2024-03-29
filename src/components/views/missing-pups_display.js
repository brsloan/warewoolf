const { closePopups, createButton, removeElementsByClass } = require('../controllers/utils');

function promptForMissingPups(project, changeChapsDirectory){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var warningTitle = document.createElement("h1");
  warningTitle.innerText = "Oops! This Woolf's Pups Are Missing!";
  warningTitle.classList.add('warning-text');
  popup.appendChild(warningTitle);

  var warning = document.createElement("p");
  warning.innerText = "They are not in their expected directory: " + project.chapsDirectory +
    ". Can you hear them howling? Find the first pup and we'll round up the rest. This project should have " +
    project.chapters.length + " .pup files.";
  popup.appendChild(warning);

  var find = createButton("Awooo! I'll Find Them");
  find.onclick = function(){
    changeChapsDirectory();
    closePopups();
  };
  popup.appendChild(find);

  popup.appendChild(document.createElement('br'));

  var cancel = createButton("Let them starve for now.");
  cancel.onclick = function(){
    closePopups();
  };
  popup.appendChild(cancel);

  document.body.appendChild(popup);
  find.focus();
}

module.exports = promptForMissingPups;