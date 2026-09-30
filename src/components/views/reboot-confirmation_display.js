const { createButton, describeDialog } = require('../controllers/utils');

//File > Reboot (Linux only) restarts the machine, which is easy to mistake for restarting the app.
//So it asks first, before the unsaved-work prompt and the backup, and starts on No: two presses of
//Enter from the menu should not be enough to take the machine down by accident.
function displayRebootConfirmation(onConfirm){
  if(document.querySelector('.reboot-confirm-popup'))
    return null;

  var popup = document.createElement("div");
  popup.classList.add("popup");
  popup.classList.add("reboot-confirm-popup");

  var warningTitle = document.createElement('h1');
  warningTitle.innerText = 'WARNING:';
  popup.appendChild(warningTitle);
  describeDialog(popup, warningTitle, 'alertdialog');

  var message = document.createElement("p");
  message.innerText = "This will reboot your computer, not the program. Continue?";
  message.classList.add('warning-text');
  popup.appendChild(message);

  var yesButton = createButton("Yes");
  yesButton.onclick = function(){
    popup.remove();
    return onConfirm();
  }
  var noButton = createButton("No");
  noButton.onclick = function(){
    popup.remove();
  }

  popup.appendChild(yesButton);
  popup.appendChild(noButton);
  document.body.appendChild(popup);
  noButton.focus();

  return popup;
}

module.exports = displayRebootConfirmation;
