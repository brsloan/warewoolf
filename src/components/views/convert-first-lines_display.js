const { closePopups, createButton, removeElementsByClass } = require('../controllers/utils');
const { convertFirstLinesToTitles } = require('../controllers/convert-first-lines');

function showConvertFirstLines(project, cback){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var cflTitle = document.createElement('h1');
  cflTitle.innerText = "Convert First Lines To Titles";
  popup.appendChild(cflTitle);

  var undoWarning = document.createElement('p');
  undoWarning.innerText = 'WARNING: This action cannot be undone. Be sure to save first.';
  undoWarning.classList.add('warning-text');
  popup.appendChild(undoWarning);

  var convertBtn = createButton('Convert');
  convertBtn.onclick = function(){
    convertFirstLinesToTitles(project);
    closePopups();
    cback();
  };
  popup.appendChild(convertBtn);

  var close = createButton("Close");
  close.onclick = function(){
    closePopups();
  };
  popup.appendChild(close);

  document.body.appendChild(popup);
  convertBtn.focus();

}

module.exports = showConvertFirstLines;