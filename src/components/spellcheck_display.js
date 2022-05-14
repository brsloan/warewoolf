function showSpellcheck(startingIndex = 0, wordsToIgnore = []){
    var invalidWord = runSpellcheck(startingIndex, wordsToIgnore);
    if(invalidWord)
      editorQuill.setSelection(invalidWord.index, invalidWord.word.length);

    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

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
      noSugsAlert.innerText = "No suggestions available."
      suggestions.appendChild(noSugsAlert);
    }
    popup.appendChild(suggestions);

    var ignoreBtn = createButton("Ignore");
    ignoreBtn.onclick = function(){
      var nextIndex = invalidWord ? invalidWord.index + invalidWord.word.length : 0;
      showSpellcheck(nextIndex, wordsToIgnore);
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
      if(invalidWord && selectedReplacement != null){
        editorQuill.setSelection(invalidWord.index, invalidWord.word.length);
        replace(selectedReplacement.value);
        ignoreBtn.click();
      }
    }
    popup.appendChild(changeBtn);

    var changeAllBtn = createButton("<span class='access-key'>C</span>hange All");
    changeAllBtn.onclick = function(){
      var selectedReplacement = document.querySelector('input[name="suggestions"]:checked');
      if(invalidWord && selectedReplacement != null){
        replaceAllBackground(invalidWord.word, selectedReplacement.value, true);
        displayChapterByIndex(project.activeChapterIndex);
        ignoreBtn.click();
      }
    };
    changeAllBtn.accessKey = "c";
    popup.appendChild(changeAllBtn);

    popup.appendChild(document.createElement('br'));

    var addToDic = createButton("<span class='access-key'>A</span>dd To Dictionary");
    addToDic.onclick = function(){
      addWordToPersonalDictFile(invalidWord.word);
      ignoreBtn.click();
    }
    addToDic.accessKey = "a";
    popup.appendChild(addToDic);

    popup.appendChild(document.createElement('br'));

    var cancelBtn = createButton("Cancel");
    cancelBtn.onclick = function(){
      popup.remove();
    }
    popup.appendChild(cancelBtn);

    document.body.appendChild(popup);
    var selectedSuggestion = document.querySelector('input[name="suggestions"]:checked');
    if(selectedSuggestion != null)
      selectedSuggestion.focus();
    else {
      ignoreAllBtn.focus();
    }
  }
