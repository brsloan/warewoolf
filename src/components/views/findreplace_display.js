const { closePopups, createButton, removeElementsByClass, enableSearchView } = require('../controllers/utils');
const { find, replace, replaceAllInChapter, replaceAllInAllChapters } = require('../controllers/findreplace');

function showFindReplace(project, editorQuill, displayChapterByIndex){
    enableSearchView();
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");
    popup.classList.add("popup-search-view");

    var popupTitle = document.createElement('h1');
    popupTitle.innerText = 'Find / Replace';
    popup.appendChild(popupTitle);

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

    var findBtn = createButton("<span class='access-key'>F</span>ind");
    findBtn.onclick = function(){
      replacementCount.innerText = "";
      var found = find(editorQuill, project, findIn.value, caseSensitive.checked, editorQuill.getSelection(true).index, inAllChapters.checked, displayChapterByIndex);
      if(found < 0)
        replacementCount.innerText = "None Found.";
      findBtn.focus();
    };
    findBtn.accessKey = "f";
    findForm.appendChild(findBtn);

    var replaceBtn = createButton("<span class='access-key'>R</span>eplace");
    replaceBtn.id = "replace-btn";
    replaceBtn.onclick = function(){
      replacementCount.innerText = "";
      replace(editorQuill, replaceIn.value);
      findBtn.click();
      replaceBtn.focus();
    };
    replaceBtn.accessKey = "r";
    findForm.appendChild(replaceBtn);

    findForm.appendChild(document.createElement('br'));

    var replaceAllBtn = createButton("Replace <span class='access-key'>A</span>ll");
    replaceAllBtn.id = "replace-all-btn";
    replaceAllBtn.onclick = function(){
      replacementCount.innerText = "";
      var numReplaced = 0;

      if(inAllChapters.checked)
        numReplaced = replaceAllInAllChapters(project, findIn.value, replaceIn.value, caseSensitive.checked);
      else {
        numReplaced = replaceAllInChapter(findIn.value, replaceIn.value, caseSensitive.checked, project.getActiveChapter());
      }
      displayChapterByIndex(project.activeChapterIndex);
      replacementCount.innerText = numReplaced + " instances replaced!";
    };
    replaceAllBtn.accessKey = "a";
    findForm.appendChild(replaceAllBtn);

    findForm.appendChild(document.createElement('br'));

    var cancel = createButton("Cancel");
    cancel.onclick = function(){
      closePopups();
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

  module.exports = showFindReplace;