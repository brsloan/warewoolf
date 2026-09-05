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
    caseSensitive.id = "case-sensitive-check";
    findForm.appendChild(caseSensitive);

    var caseSensLabel = document.createElement("label");
    caseSensLabel.htmlFor = "case-sensitive-check";
    caseSensLabel.innerText = "Case Sensitive";
    findForm.appendChild(caseSensLabel);

    findForm.appendChild(document.createElement('br'));

    var wholeWordOnly = document.createElement("input");
    wholeWordOnly.type = "checkbox";
    wholeWordOnly.id = "whole-word-check";
    findForm.appendChild(wholeWordOnly);

    var wholeWordLabel = document.createElement("label");
    wholeWordLabel.htmlFor = "whole-word-check";
    wholeWordLabel.innerText = "Whole Word Only";
    findForm.appendChild(wholeWordLabel);

    findForm.appendChild(document.createElement('br'));

    var inAllChapters = document.createElement("input");
    inAllChapters.type = "checkbox";
    inAllChapters.id = "in-all-chapters-check";
    findForm.appendChild(inAllChapters)

    var inAllChapLabel = document.createElement("label");
    inAllChapLabel.htmlFor = "in-all-chapters-check";
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
      //Search from the end of the current selection rather than its start, so a repeat Find
      //advances past the match that's currently selected instead of re-finding it, while a fresh
      //click with no selection (length 0) still searches from the cursor itself.
      var selection = editorQuill.getSelection(true);
      var found = find(editorQuill, project, findIn.value, caseSensitive.checked, selection.index + selection.length, inAllChapters.checked, displayChapterByIndex, wholeWordOnly.checked);
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
      //Only replace if the current selection is still the match Find highlighted - the editor
      //stays interactive while this popup is open, so the user can click/select elsewhere in it
      //between Find and Replace, and Replace must not clobber whatever ends up selected.
      var selection = editorQuill.getSelection(true);
      var selectedText = editorQuill.getText(selection.index, selection.length);
      var isMatch = caseSensitive.checked
        ? selectedText === findIn.value
        : selectedText.toLowerCase() === findIn.value.toLowerCase();
      if(findIn.value && isMatch)
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
        numReplaced = replaceAllInAllChapters(project, findIn.value, replaceIn.value, caseSensitive.checked, wholeWordOnly.checked);
      else {
        numReplaced = replaceAllInChapter(findIn.value, replaceIn.value, caseSensitive.checked, project.getActiveChapter(), wholeWordOnly.checked);
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
      if (event.key == "Enter") {
          event.preventDefault();
          findBtn.click();
      }
    });

    replaceIn.addEventListener("keyup", function(event){
      if (event.key == "Enter") {
          event.preventDefault();
          replaceBtn.click();
      }
    });

    popup.appendChild(findForm);
    document.body.appendChild(popup);
    findIn.focus();
  }

  module.exports = showFindReplace;