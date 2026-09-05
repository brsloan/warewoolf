const { closePopups, createButton, removeElementsByClass } = require('../controllers/utils');

//Shown when a .woolf file cannot be read at all - truncated by a power loss part-way through a
//save, or not a project file in the first place. Distinct from missing-pups_display.js, which
//handles a project that loaded fine but whose individual chapter files have gone astray: there is
//nothing to repair here, so this only says which file failed and reassures the reader that their
//chapters (kept as separate files alongside the project) have not been touched.
//The app is left sitting on an empty project behind this popup.
function reportProjectLoadFailure(filepath, err){
  removeElementsByClass('popup');
  var popup = document.createElement('div');
  popup.classList.add('popup');

  var title = document.createElement('h1');
  title.innerText = 'Could Not Open Project';
  popup.appendChild(title);

  var warning = document.createElement('h1');
  warning.innerText = 'This project file could not be read.';
  warning.classList.add('warning-text');
  popup.appendChild(warning);

  var pathLabel = document.createElement('h2');
  pathLabel.innerText = 'File:';
  popup.appendChild(pathLabel);

  var pathText = document.createElement('p');
  pathText.innerText = filepath;
  pathText.classList.add('popup-text-small');
  popup.appendChild(pathText);

  var explanation = document.createElement('p');
  explanation.innerText = 'The file may be damaged - this can happen if the machine loses power ' +
    'while a project is being saved - or it may not be a WareWoolf project at all. Your chapters ' +
    'are stored as separate files and have not been touched, and nothing has been overwritten. ' +
    'Try a backup, or use File > Open to pick another project.';
  popup.appendChild(explanation);

  if(err && err.message){
    var detailLabel = document.createElement('h2');
    detailLabel.innerText = 'Details:';
    popup.appendChild(detailLabel);

    var detail = document.createElement('p');
    detail.innerText = err.message;
    detail.classList.add('popup-text-small');
    popup.appendChild(detail);
  }

  var close = createButton('Close');
  close.onclick = function(){
    closePopups();
  };
  popup.appendChild(close);

  document.body.appendChild(popup);
  close.focus();
}

module.exports = reportProjectLoadFailure;
