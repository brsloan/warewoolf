const { closePopups, createButton, removeElementsByClass, displayChapterByIndex } = require('../../render');
const { convertMarkedItalicsForAllChapters } = require('../controllers/convert-italics');

function showItalicsOptions(){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var popupTitle = document.createElement('h1');
    popupTitle.innerText = 'Convert Marked Italics';
    popup.appendChild(popupTitle);

    var undoWarning = document.createElement('p');
    undoWarning.innerText = 'WARNING: This action cannot be undone. Be sure to save first.';
    undoWarning.classList.add('warning-text');
    popup.appendChild(undoWarning);

    var italicsForm = document.createElement("form");

    var italicsStrLabel = document.createElement("label");
    italicsStrLabel.innerText = "Marker character: ";
    italicsStrLabel.for = "italics-str-input";
    italicsForm.appendChild(italicsStrLabel);

    var italicsStrInput = document.createElement("input");
    italicsStrInput.type = "text";
    italicsStrInput.value = "*";
    italicsStrInput.id = "italics-str-input";
    italicsForm.appendChild(italicsStrInput);

    italicsForm.appendChild(document.createElement('br'));

    var italicsBtn = document.createElement("input");
    italicsBtn.type = "submit";
    italicsBtn.value = "Submit";
    italicsForm.appendChild(italicsBtn);

    var cancelBtn = createButton("Cancel");
    cancelBtn.onclick = function(){
      closePopups();
    };
    italicsForm.appendChild(cancelBtn);

    italicsForm.onsubmit = function(e){
      e.preventDefault();
      convertMarkedItalicsForAllChapters(project, italicsStrInput.value);
      displayChapterByIndex(project.activeChapterIndex);
      closePopups();
    };

    popup.appendChild(italicsForm);

    document.body.appendChild(popup);
    italicsStrInput.focus();

  }

  module.exports = showItalicsOptions;