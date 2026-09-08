const { closePopups, createButton, removeElementsByClass, enableSearchView } = require('../controllers/utils');
const { runSpellcheck, addWordToPersonalDictFile, addWordToProjectDictionary } = require('../controllers/spellcheck');
const { replace, replaceAllInAllChapters } = require('../controllers/findreplace');

//Async now that loading the dictionaries goes through the platform facade.
async function showSpellcheck(editorQuill, project, displayChapterByIndex, startingIndex = 0, wordsToIgnore = []){
    enableSearchView();

    var invalidWord = await runSpellcheck(editorQuill, startingIndex, wordsToIgnore);
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
        sugLi.id = "suggestion-" + i;
        sugLi.value = invalidWord.suggestions[i];
        suggestions.appendChild(sugLi);
        var sugLabel = document.createElement("label");
        sugLabel.htmlFor = sugLi.id;
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
    customLabel.htmlFor = "custom-input";
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
      return showSpellcheck(editorQuill, project, displayChapterByIndex, nextIndex, wordsToIgnore);
    }
    popup.appendChild(ignoreBtn);

    var ignoreAllBtn = createButton("<span class='access-key'>I</span>gnore All");
    ignoreAllBtn.onclick = function(){
      if(invalidWord){
        wordsToIgnore.push(invalidWord.word);
        return ignoreBtn.onclick();
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
        return ignoreBtn.onclick();
      }
    }
    popup.appendChild(changeBtn);

    var changeAllBtn = createButton("C<span class='access-key'>h</span>ange All");
    //Awaited so the redraw below shows a finished pass rather than one still reading chapters off
    //disk.
    changeAllBtn.onclick = async function(){
      var selectedReplacement = document.querySelector('input[name="suggestions"]:checked');
      if(customInput.value != "")
        selectedReplacement = customInput;

      if(invalidWord && selectedReplacement != null){
        const caseSensitive = true;
        const wholeWordOnly = true;
        await replaceAllInAllChapters(project, invalidWord.word, selectedReplacement.value, caseSensitive, wholeWordOnly);
        displayChapterByIndex(project.activeChapterIndex);
        return ignoreBtn.onclick();
      }
    };
    changeAllBtn.accessKey = "h";
    popup.appendChild(changeAllBtn);

    popup.appendChild(document.createElement('br'));

    var addToDic = createButton("<span class='access-key'>A</span>dd To Dictionary");
    addToDic.onclick = async function(){
      if(invalidWord){
        await addWordToPersonalDictFile(invalidWord.word);
        return ignoreBtn.onclick();
      }
    }
    addToDic.accessKey = "a";
    popup.appendChild(addToDic);

    //The answer for a character name and the answer for a word the writer will use in every book
    //are different, and only the writer knows which they are looking at. Keeping 'a' on the
    //personal dictionary is deliberate even though Add To Project is the more common action for a
    //novelist - silently repointing a key a writer already has in their fingers is worse than a
    //suboptimal default.
    var addToProject = createButton("Add To <span class='access-key'>P</span>roject");
    addToProject.onclick = async function(){
      if(invalidWord){
        addWordToProjectDictionary(project, invalidWord.word);
        return ignoreBtn.onclick();
      }
    }
    addToProject.accessKey = "p";
    //A project that cannot be saved (the read-only Help doc) has nothing to add the word to that
    //would survive - see project.saveFile()'s own isReadOnly guard.
    addToProject.disabled = project == null || project.isReadOnly;
    popup.appendChild(addToProject);

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