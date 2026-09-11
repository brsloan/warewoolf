const { describeDialog } = require('../controllers/utils');
//A minimal "here's why not" popup, in the same hand-built-DOM style as working_display.js's
//showBackupAlert - no dependency on markup already present in index.html, since this is the only
//caller and the whole popup is three elements. Reused rather than duplicated per caller: calling it
//again while one is already showing just replaces the message, the same way showWorking() does.
function showBlockedActionAlert(message){
  var popup = document.getElementById('blocked-action-alert');

  if(popup == null){
    popup = document.createElement('div');
    popup.id = 'blocked-action-alert';
    popup.classList.add('popup');

    var text = document.createElement('p');
    text.id = 'blocked-action-alert-text';
    popup.appendChild(text);
    describeDialog(popup, text, 'alertdialog');

    var okBtn = document.createElement('button');
    okBtn.innerText = 'OK';
    okBtn.onclick = function(){ popup.remove(); };
    popup.appendChild(okBtn);

    document.body.appendChild(popup);
  }

  document.getElementById('blocked-action-alert-text').innerText = message;
}

module.exports = showBlockedActionAlert;
