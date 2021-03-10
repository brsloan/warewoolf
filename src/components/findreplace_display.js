function showFindReplace(){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");
  
    var findForm = document.createElement("form");
  
    var findIn = document.createElement("input");
    findIn.type = "text";
    findIn.placeholder = "Find...";
    findIn.id = "find-input";
    findForm.appendChild(findIn);
  
    findForm.appendChild(document.createElement('br'));
  
    var caseSensitive = document.createElement("input");
    caseSensitive.type = "checkbox";
    findForm.appendChild(caseSensitive);
  
    var caseSensLabel = document.createElement("label");
    caseSensLabel.innerText = "Case Sensitive";
    findForm.appendChild(caseSensLabel);
  
    findForm.appendChild(document.createElement('br'));
  
    var inAllChapters = document.createElement("input");
    inAllChapters.type = "checkbox";
    findForm.appendChild(inAllChapters)
  
    var inAllChapLabel = document.createElement("label");
    inAllChapLabel.innerText = "In All Chapters";
    findForm.appendChild(inAllChapLabel);
  
    findForm.appendChild(document.createElement('br'));
  
    var replaceIn = document.createElement("input");
    replaceIn.type = "text";
    replaceIn.placeholder = "Replace...";
    replaceIn.id = "replace-input";
    findForm.appendChild(replaceIn);
  
    findForm.appendChild(document.createElement('br'));
  
    var findBtn = createButton("Find");
    findBtn.onclick = function(){
      replacementCount.innerText = "";
      find(findIn.value, caseSensitive.checked, editorQuill.getSelection(true).index, inAllChapters.checked);
    };
    findForm.appendChild(findBtn);
  
    var replaceBtn = createButton("Replace");
    replaceBtn.id = "replace-btn";
    replaceBtn.onclick = function(){
      replacementCount.innerText = "";
      replace(replaceIn.value);
    };
    findForm.appendChild(replaceBtn);
  
    findForm.appendChild(document.createElement('br'));
  
    var replaceAllBtn = createButton("Replace All");
    replaceAllBtn.id = "replace-all-btn";
    replaceAllBtn.onclick = function(){
      replacementCount.innerText = "";
      var numReplaced = replaceAll(findIn.value, replaceIn.value, caseSensitive.checked, inAllChapters.checked);
      replacementCount.innerText = numReplaced + " instances replaced!";
    };
    findForm.appendChild(replaceAllBtn);
  
    findForm.appendChild(document.createElement('br'));
  
    var cancel = createButton("Cancel");
    cancel.onclick = function(){
      popup.remove();
    };
    findForm.appendChild(cancel);
  
    findForm.appendChild(document.createElement('br'));
  
    var replacementCount = document.createElement('label');
    replacementCount.innerText = "";
    findForm.appendChild(replacementCount);
  
    findIn.addEventListener("keyup", function(event){
      event.preventDefault();
      if (event.key == "Enter") {
          findBtn.click();
      }
    });
  
    popup.appendChild(findForm);
    document.body.appendChild(popup);
    findIn.focus();
  }