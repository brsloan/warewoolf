function showTabOptions(){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");
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
      
      convertMarkedTabsForAllChapters(tabStrInput.value);
      displayChapterByIndex(project.activeChapterIndex);
      closePopups();
    };

    popup.appendChild(tabForm);
    document.body.appendChild(popup);
    tabStrInput.focus();

  }
