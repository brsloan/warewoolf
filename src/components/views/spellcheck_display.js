const { closePopups, createButton, removeElementsByClass, enableSearchView } = require('../controllers/utils');
const { runSpellcheck, addWordToPersonalDictFile } = require('../controllers/spellcheck');
const { replace, replaceAllInAllChapters } = require('../controllers/findreplace');

function showSpellcheck(editorQuill, project, sysDirectories, displayChapterByIndex, startingIndex = 0, wordsToIgnore = []){
    enableSearchView();

    var invalidWord = runSpellcheck(editorQuill, sysDirectories, startingIndex, wordsToIgnore);
    if(invalidWord)
      editorQuill.setSelection(invalidWord.index, invalidWord.word.length);

    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");
    popup.classList.add("popup-search-view");

    var popupTitle = document.createElement('h1');
    popupTitle.innerText = 'Spell Check';
    popup.appendChild(popupTitle);

    var wordDisplay = document.createElement("h2");
    wordDisplay.innerText = invalidWord ? invalidWord.word : "*spellcheck finished*";
    popup.appendChild(wordDisplay);

    var suggestionsHeader = document.createElement("h3");
    suggestionsHeader.innerText = "Suggested Replacements";
    popup.appendChild(suggestionsHeader);

    var suggestions = document.createElement("ul");

    if(invalidWord != null && invalidWord.suggestions.length > 0){
      for(let i=0;i<invalidWord.suggestions.length;i++){
        var sugLi = document.createElement("input");
        sugLi.type = "radio";
        sugLi.name = "suggestions";
        sugLi.value = invalidWord.suggestions[i];
        suggestions.appendChild(sugLi);
        var sugLabel = document.createElement("label");
        sugLabel.innerText = (i + 1) + ": " + invalidWord.suggestions[i];
        if(i==0)
          sugLi.checked = true;
        suggestions.appendChild(sugLabel);
      }
    }
    else {
      var noSugsAlert = document.createElement("p");
      noSugsAlert.innerText = "No suggestions available.";
      suggestions.appendChild(noSugsAlert);
    }
    popup.appendChild(suggestions);

    var customLabel = document.createElement("label");
    customLabel.innerText = "Custom Replacement: ";
    customLabel.for = "custom-input";
    popup.appendChild(customLabel);

    var customInput = document.createElement("input");
    customInput.type = "text";
    customInput.id = "custom-input";
    customInput.onkeyup = function(){
      if(customInput.value == "")
        suggestions.style.opacity = 1;
      else {
        suggestions.style.opacity = 0.5;
      }
    };
    popup.appendChild(customInput);

    popup.appendChild(document.createElement('br'));
    popup.appendChild(document.createElement('br'));

    var ignoreBtn = createButton("Ignore");
    ignoreBtn.onclick = function(){
      var nextIndex = invalidWord ? invalidWord.index + invalidWord.word.length : 0;
      showSpellcheck(editorQuill, project, sysDirectories, displayChapterByIndex, nextIndex, wordsToIgnore);
    }
    popup.appendChild(ignoreBtn);

    var ignoreAllBtn = createButton("<span class='access-key'>I</span>gnore All");
    ignoreAllBtn.onclick = function(){
      if(invalidWord){
        wordsToIgnore.push(invalidWord.word);
        ignoreBtn.click();
      }
    }
    ignoreAllBtn.accessKey = "i";
    popup.appendChild(ignoreAllBtn);

    popup.appendChild(document.createElement('br'));

    var changeBtn = createButton("Change");
    changeBtn.onclick = function(){
      var selectedReplacement = document.querySelector('input[name="suggestions"]:checked');
      if(customInput.value != "")
        selectedReplacement = customInput;

      if(invalidWord && selectedReplacement != null){
        editorQuill.setSelection(invalidWord.index, invalidWord.word.length);
        replace(editorQuill, selectedReplacement.value);
        ignoreBtn.click();
      }
    }
    popup.appendChild(changeBtn);

    var changeAllBtn = createButton("C<span class='access-key'>h</span>ange All");
    changeAllBtn.onclick = function(){
      var selectedReplacement = document.querySelector('input[name="suggestions"]:checked');
      if(customInput.value != "")
        selectedReplacement = customInput;

      if(invalidWord && selectedReplacement != null){
        replaceAllInAllChapters(project, invalidWord.word, selectedReplacement.value, true);
        displayChapterByIndex(project.activeChapterIndex);
        ignoreBtn.click();
      }
    };
    changeAllBtn.accessKey = "h";
    popup.appendChild(changeAllBtn);

    popup.appendChild(document.createElement('br'));

    var addToDic = createButton("<span class='access-key'>A</span>dd To Dictionary");
    addToDic.onclick = function(){
      addWordToPersonalDictFile(invalidWord.word, sysDirectories);
      ignoreBtn.click();
    }
    addToDic.accessKey = "a";
    popup.appendChild(addToDic);

    popup.appendChild(document.createElement('br'));

    var cancelBtn = createButton("Cancel");
    cancelBtn.onclick = function(){
      closePopups();
    }
    popup.appendChild(cancelBtn);

    document.body.appendChild(popup);

    var selectedSuggestion = document.querySelector('input[name="suggestions"]:checked');
    if(selectedSuggestion != null)
      selectedSuggestion.focus();
    else {
      ignoreBtn.focus();
    }
  }

  module.exports = showSpellcheck;