function showSpellcheck(startingIndex = 0, wordsToIgnore = []){
    var invalidWord = runSpellcheck(startingIndex, wordsToIgnore);
    if(invalidWord)
      editorQuill.setSelection(invalidWord.index, invalidWord.word.length);

    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var wordDisplay = document.createElement("h2");
    wordDisplay.innerText = invalidWord ? invalidWord.word : "n/a";
    popup.appendChild(wordDisplay);

    var suggestionsHeader = document.createElement("h3");
    suggestionsHeader.innerText = "Suggested Replacements";
    popup.appendChild(suggestionsHeader);

    var suggestions = document.createElement("ul");
    var selectedSuggestion = null;
    if(invalidWord != null && invalidWord.suggestions.length > 0){
      selectedSuggestion = invalidWord.suggestions[0];
      invalidWord.suggestions.forEach(function(sug){
        var sugLi = document.createElement("li");
        sugLi.innerText = sug;
        sugLi.onclick = function(){
          selectedSuggestion = sug;
          console.log("selected: " + selectedSuggestion);
        }
        suggestions.appendChild(sugLi);
      });
    }
    popup.appendChild(suggestions);

    var ignoreBtn = createButton("Ignore");
    ignoreBtn.onclick = function(){
      var nextIndex = invalidWord ? invalidWord.index + invalidWord.word.length : 0;
      showSpellcheck(nextIndex, wordsToIgnore);
    }
    popup.appendChild(ignoreBtn);

    var ignoreAllBtn = createButton("Ignore All");
    ignoreAllBtn.onclick = function(){
      if(invalidWord){
        wordsToIgnore.push(invalidWord.word);
        ignoreBtn.click();
      }
    }
    popup.appendChild(ignoreAllBtn);

    popup.appendChild(document.createElement('br'));

    var changeBtn = createButton("Change");
    changeBtn.onclick = function(){
      if(invalidWord && selectedSuggestion != null){
        editorQuill.setSelection(invalidWord.index, invalidWord.word.length);
        replace(selectedSuggestion);
        ignoreBtn.click();
      }
    }
    popup.appendChild(changeBtn);

    var changeAllBtn = createButton("Change All");
    changeAllBtn.onclick = function(){
      if(invalidWord && selectedSuggestion != null){
        replaceAllBackground(invalidWord.word, selectedSuggestion, true);
        displayChapterByIndex(project.activeChapterIndex);
        ignoreBtn.click();
      }
    };
    popup.appendChild(changeAllBtn);

    popup.appendChild(document.createElement('br'));

    var addToDic = createButton("Add To Dictionary");
    addToDic.onclick = function(){
      addWordToPersonalDictFile(invalidWord.word);
      ignoreBtn.click();
    }
    popup.appendChild(addToDic);

    popup.appendChild(document.createElement('br'));

    var cancelBtn = createButton("Cancel");
    cancelBtn.onclick = function(){
      popup.remove();
    }
    popup.appendChild(cancelBtn);

    document.body.appendChild(popup);
    changeAllBtn.focus();
  }
