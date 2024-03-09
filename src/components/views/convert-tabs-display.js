const { closePopups, createButton, removeElementsByClass } = require('../controllers/utils');
const { convertMarkedTabsForAllChapters } = require('../controllers/convert-tabs');

function showTabOptions(project, onFinish){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var popupTitle = document.createElement('h1');
    popupTitle.innerText = 'Convert Marked Tabs';
    popup.appendChild(popupTitle);

    var undoWarning = document.createElement('p');
    undoWarning.innerText = 'WARNING: This action cannot be undone. Be sure to save first.';
    undoWarning.classList.add('warning-text');
    popup.appendChild(undoWarning);

    var tabForm = document.createElement("form");

    var tabStrLabel = document.createElement("label");
    tabStrLabel.innerText = "Marker string (default 4 spaces): ";
    tabStrLabel.for = "tab-str-input";
    tabForm.appendChild(tabStrLabel);

    var tabStrInput = document.createElement("input");
    tabStrInput.type = "text";
    tabStrInput.value = "    ";
    tabStrInput.id = "tab-str-input";
    tabForm.appendChild(tabStrInput);

    tabForm.appendChild(document.createElement('br'));

    var tabBtn = document.createElement("input");
    tabBtn.type = "submit";
    tabBtn.value = "Submit";
    tabForm.appendChild(tabBtn);

    var cancelBtn = createButton("Cancel");
    cancelBtn.onclick = function(){
      closePopups();
    };
    tabForm.appendChild(cancelBtn);

    tabForm.onsubmit = function(e){
      e.preventDefault();

      convertMarkedTabsForAllChapters(project, tabStrInput.value);
      closePopups();
      onFinish();
    };

    popup.appendChild(tabForm);

    document.body.appendChild(popup);
    tabStrInput.focus();

  }

  module.exports = showTabOptions;