const { createButton } = require('../controllers/utils');

//Permanent deletion is the one action in the app with nothing behind it - the chapter is already
//in the trash, and this removes its file from disk. So it asks first, and defaults focus to Yes
//the way exit-confirmation_display.js defaults to Save.
function displayDeleteConfirmation(onConfirm){
  //Holding the delete shortcut, or clicking through twice, used to stack a second popup on top of
  //the first, leaving one behind after the visible one was answered.
  if(document.querySelector('.delete-confirm-popup'))
    return null;

  var popup = document.createElement("div");
  popup.classList.add("popup");
  popup.classList.add("delete-confirm-popup");

  var warningTitle = document.createElement('h1');
  warningTitle.innerText = 'WARNING:'
  popup.appendChild(warningTitle);

  var message = document.createElement("p");
  message.innerText = "Are you sure you want to delete this file? This is permanent.";
  message.classList.add('warning-text');
  popup.appendChild(message);

  var yesButton = createButton("Yes");
  yesButton.onclick = function(){
    popup.remove();
    onConfirm();
  }
  var noButton = createButton("No");
  noButton.onclick = function(){
    popup.remove();
  }

  popup.appendChild(yesButton);
  popup.appendChild(noButton);
  document.body.appendChild(popup);
  yesButton.focus();

  return popup;
}

module.exports = displayDeleteConfirmation;
