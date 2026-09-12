const { closePopups, createButton, removeElementsByClass, enableSearchView, describeDialog } = require('../controllers/utils');
const { compileSearch, find, matchEntireText, replace, replaceAllInChapter, replaceAllInAllChapters } = require('../controllers/findreplace');

function showFindReplace(project, editorQuill, displayChapterByIndex){
    enableSearchView();
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");
    popup.classList.add("popup-search-view");

    var popupTitle = document.createElement('h1');
    popupTitle.innerText = 'Find / Replace';
    popup.appendChild(popupTitle);
    describeDialog(popup, popupTitle);

    var findForm = document.createElement("form");

    var findIn = document.createElement("input");
    findIn.type = "text";
    findIn.placeholder = "Find...";
    findIn.id = "find-input";
    findIn.setAttribute('aria-label', 'Find');
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

    var useRegex = document.createElement("input");
    useRegex.type = "checkbox";
    useRegex.id = "use-regex-check";
    findForm.appendChild(useRegex);

    var useRegexLabel = document.createElement("label");
    useRegexLabel.htmlFor = "use-regex-check";
    useRegexLabel.innerText = "Use Regex";
    findForm.appendChild(useRegexLabel);

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
    replaceIn.setAttribute('aria-label', 'Replace with');
    findForm.appendChild(replaceIn);

    findForm.appendChild(document.createElement('br'));

    //The checkboxes that say how to search, read fresh on each click and handed to the controller
    //as one object - so Find, Replace and Replace All cannot drift apart in how they read them.
    function searchOptions(){
      return {
        caseSensitive: caseSensitive.checked,
        wholeWordOnly: wholeWordOnly.checked,
        useRegex: useRegex.checked
      };
    }

    //Half a regular expression - "(", "[a-", "*" - is what the Find box holds for most of the time
    //a writer is typing one, and it will not compile. Every button asks first, so that the answer is
    //"this is not a pattern yet" rather than a silent "None Found." or a Replace All that visits
    //every chapter in the project to no purpose. Returns true when there is nothing to do.
    function patternIsBroken(){
      var search = compileSearch(findIn.value, searchOptions());

      if(!search.error)
        return false;

      replacementCount.innerText = "Invalid pattern: " + search.error;
      return true;
    }

    //The search itself, apart from the button that usually starts it, so that Replace can run it
    //and wait for it too. Awaited throughout: an In All Chapters search reads chapters off disk, so
    //both the "None Found." and the focus() that follow it have to come after it has finished - the
    //focus() in particular, since the search moves the focus into the editor when it selects a
    //match, and taking it back before that has happened would not take it back at all.
    async function runFind(){
      replacementCount.innerText = "";
      if(patternIsBroken())
        return;
      //Search from the end of the current selection rather than its start, so a repeat Find
      //advances past the match that's currently selected instead of re-finding it, while a fresh
      //click with no selection (length 0) still searches from the cursor itself.
      var selection = editorQuill.getSelection(true);
      var found = await find(editorQuill, project, findIn.value, selection.index + selection.length, inAllChapters.checked, displayChapterByIndex, searchOptions());
      if(found < 0)
        replacementCount.innerText = "None Found.";
    }

    var findBtn = createButton("<span class='access-key'>F</span>ind");
    findBtn.onclick = async function(){
      await runFind();
      findBtn.focus();
    };
    findBtn.accessKey = "f";
    findForm.appendChild(findBtn);

    var replaceBtn = createButton("<span class='access-key'>R</span>eplace");
    replaceBtn.id = "replace-btn";
    replaceBtn.onclick = async function(){
      replacementCount.innerText = "";
      if(patternIsBroken())
        return replaceBtn.focus();
      //Only replace if the current selection is still the match Find highlighted - the editor
      //stays interactive while this popup is open, so the user can click/select elsewhere in it
      //between Find and Replace, and Replace must not clobber whatever ends up selected. Asking the
      //search itself rather than comparing strings: a pattern's match is not the pattern, and even
      //a plain search for "don't" highlights the curly-quoted "don’t", which no comparison with
      //what was typed will ever equal.
      var selection = editorQuill.getSelection(true);
      var selectedText = editorQuill.getText(selection.index, selection.length);
      var match = matchEntireText(findIn.value, selectedText, searchOptions());
      if(match)
        replace(editorQuill, replaceIn.value, match, searchOptions());
      //runFind() rather than findBtn.click(), which would hand back a promise nothing could wait
      //for and leave the focus below racing the search for it.
      await runFind();
      replaceBtn.focus();
    };
    replaceBtn.accessKey = "r";
    findForm.appendChild(replaceBtn);

    findForm.appendChild(document.createElement('br'));

    var replaceAllBtn = createButton("Replace <span class='access-key'>A</span>ll");
    replaceAllBtn.id = "replace-all-btn";
    //Awaited so the count and the redraw below describe a finished pass rather than one still
    //reading chapters off disk.
    replaceAllBtn.onclick = async function(){
      replacementCount.innerText = "";
      //Checked before the first chapter is touched, not per chapter: this pass rewrites the whole
      //project, and the count printed at the end would otherwise paper over the error.
      if(patternIsBroken())
        return replaceAllBtn.focus();

      var numReplaced = 0;

      if(inAllChapters.checked)
        numReplaced = await replaceAllInAllChapters(project, findIn.value, replaceIn.value, searchOptions());
      else {
        numReplaced = await replaceAllInChapter(findIn.value, replaceIn.value, project.getActiveChapter(), searchOptions());
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