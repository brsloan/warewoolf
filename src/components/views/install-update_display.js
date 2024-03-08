const { closePopups, createButton, removeElementsByClass } = require('../../render');
const { installUpdate } = require('../controllers/updates');

function showInstallUpdate(filepath){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var popupTitle = document.createElement('h1');
  popupTitle.innerText = 'Install Update';
  popup.appendChild(popupTitle);

  var pathDisp = document.createElement('p');
  pathDisp.innerText = filepath;
  popup.appendChild(pathDisp);

  var statusDisp = document.createElement('p');
  statusDisp.innerText = '';
  popup.appendChild(statusDisp);

  var passLabel = document.createElement('label');
  passLabel.innerText = "Password: ";
  passLabel.for = 'install-pass';
  popup.appendChild(passLabel);

  var passInput = document.createElement('input');
  passInput.type = 'password';
  passInput.id = "install-pass";
  popup.appendChild(passInput);

  var installBtn = createButton('Install Update');
  installBtn.onclick = function(){
    installUpdate(passInput.value, filepath, statusDisp);
  }
  popup.appendChild(installBtn);

  var close = createButton("Close");
  close.onclick = function(){
    closePopups();
  };
  popup.appendChild(close);

  document.body.appendChild(popup);
  passInput.focus();
}

module.exports = showInstallUpdate;