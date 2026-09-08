const { closePopups, createButton, removeElementsByClass } = require('../controllers/utils');

//Stub for Phase 4 (menu wiring) - proves File > Dictionaries reaches a popup with nothing to save
//yet. Phase 5 replaces the body with the spellcheck-dictionaries checklist and the two word-list
//editors; the signature (userSettings, project, callback) is already what that version needs.
function showDictionaries(userSettings, project, callback){
  removeElementsByClass('popup');
  var popup = document.createElement('div');
  popup.classList.add('popup');

  var header = document.createElement('h1');
  header.innerText = 'Dictionaries';
  popup.appendChild(header);

  var closeBtn = createButton('Close');
  closeBtn.onclick = function(){
    closePopups();
  };
  popup.appendChild(closeBtn);

  document.body.appendChild(popup);

  closeBtn.focus();
}

module.exports = showDictionaries;
