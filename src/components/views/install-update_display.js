const { closePopups, createButton, removeElementsByClass } = require('../controllers/utils');
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
  statusDisp.style.whiteSpace = 'pre-line';
  popup.appendChild(statusDisp);

  var passLabel = document.createElement('label');
  passLabel.innerText = "Password: ";
  passLabel.htmlFor = 'install-pass';
  popup.appendChild(passLabel);

  var passInput = document.createElement('input');
  passInput.type = 'password';
  passInput.id = "install-pass";
  passInput.autocomplete = 'new-password';
  popup.appendChild(passInput);

  var installBtn = createButton('Install Update');

  function submitInstall(){
    if(installBtn.disabled)
      return;

    if(passInput.value === ''){
      statusDisp.innerText = 'Password is required.';
      return;
    }

    installBtn.disabled = true;
    var pass = passInput.value;
    passInput.value = '';
    installUpdate(pass, filepath, statusDisp, function(exitCode){
      if(exitCode !== 0){
        installBtn.disabled = false;
        passInput.focus();
      }
    });
  }

  installBtn.onclick = submitInstall;
  popup.appendChild(installBtn);

  passInput.addEventListener('keydown', function(e){
    if(e.key === 'Enter'){
      e.preventDefault();
      submitInstall();
    }
  });

  var close = createButton("Close");
  close.onclick = function(){
    closePopups();
  };
  popup.appendChild(close);

  document.body.appendChild(popup);
  passInput.focus();
}

module.exports = showInstallUpdate;