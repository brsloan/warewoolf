const { closePopups, createButton, removeElementsByClass, generateRow, describeDialog } = require('../controllers/utils');
const { tabIndentParasInAllChaps, getDoNotIndentAfterDefs } = require('../controllers/tab-indent-paragraphs');
const { showWorkingAndThen, hideWorking } = require('./working_display');

function showTabIndentParagraphs(project, onFinish){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var popupTitle = document.createElement('h1');
    popupTitle.innerText = 'Tab-Indent Paragraphs';
    popup.appendChild(popupTitle);
    describeDialog(popup, popupTitle);

    var undoWarning = document.createElement('p');
    undoWarning.innerText = 'WARNING: This action cannot be undone. Be sure to save first.';
    undoWarning.classList.add('warning-text');
    popup.appendChild(undoWarning);

    //Says "manual tabs" outright because that is what a writer gets and what they may not expect:
    //this is not a paragraph style that can be switched off later, it is a tab character typed into
    //every paragraph of every chapter, and it goes out to every export format as one.
    var explanation = document.createElement('p');
    explanation.innerText = 'Inserts a manual tab at the start of each paragraph in every chapter, the way a printed book indents them. Headings, list items and block quotations are never indented, and a paragraph that already begins with a tab is left alone.';
    popup.appendChild(explanation);

    var indentForm = document.createElement("form");

    var skipSet = document.createElement('fieldset');

    var skipLegend = document.createElement('legend');
    skipLegend.innerText = 'Do Not Indent After';
    skipSet.appendChild(skipLegend);

    //Typography leaves the opening paragraph of a passage flush at the margin: the indent is there
    //to separate a paragraph from the one above it, and these are the paragraphs with nothing above
    //them to be separated from. Every box starts ticked, so the default is the conventional set.
    var skipTbl = document.createElement('table');
    var skipChecks = {};

    getDoNotIndentAfterDefs().forEach(function(def){
      var skipLabel = document.createElement('label');
      skipLabel.innerText = def.label + ': ';
      skipLabel.htmlFor = 'do-not-indent-after-' + def.id;

      var skipCheck = document.createElement('input');
      skipCheck.type = 'checkbox';
      skipCheck.id = 'do-not-indent-after-' + def.id;
      skipCheck.checked = true;

      skipChecks[def.id] = skipCheck;
      skipTbl.appendChild(generateRow(skipLabel, skipCheck));
    });

    skipSet.appendChild(skipTbl);
    indentForm.appendChild(skipSet);

    var optionsTbl = document.createElement('table');

    var correctTabsLabel = document.createElement('label');
    correctTabsLabel.innerText = 'Correct Current Tabs (removes tabs from paragraphs that should not be indented): ';
    correctTabsLabel.htmlFor = 'correct-current-tabs-check';

    var correctTabsCheck = document.createElement('input');
    correctTabsCheck.type = 'checkbox';
    correctTabsCheck.id = 'correct-current-tabs-check';
    correctTabsCheck.checked = true;

    optionsTbl.appendChild(generateRow(correctTabsLabel, correctTabsCheck));

    //Off by default: it deletes lines, which is a larger thing to do to a manuscript than adding
    //tabs, and most projects are not blog-styled.
    var removeBlanksLabel = document.createElement('label');
    removeBlanksLabel.innerText = 'Remove Blank Lines Between Paragraphs (closes up blog-style paragraph spacing; a double blank line becomes a single one): ';
    removeBlanksLabel.htmlFor = 'remove-blank-lines-check';

    var removeBlanksCheck = document.createElement('input');
    removeBlanksCheck.type = 'checkbox';
    removeBlanksCheck.id = 'remove-blank-lines-check';

    optionsTbl.appendChild(generateRow(removeBlanksLabel, removeBlanksCheck));

    indentForm.appendChild(optionsTbl);

    var indentBtn = document.createElement("input");
    indentBtn.type = "submit";
    indentBtn.value = "Add Indents";
    indentForm.appendChild(indentBtn);

    var cancelBtn = createButton("Cancel");
    cancelBtn.onclick = function(){
      closePopups();
    };
    indentForm.appendChild(cancelBtn);

    indentForm.onsubmit = function(e){
      e.preventDefault();

      var options = selectedOptions();
      closePopups();
      //Indenting can be slow on projects with many/large chapters, so show a working indicator
      //(deferred via showWorkingAndThen) instead of blocking with no feedback - same as
      //convert-tabs-display.js.
      showWorkingAndThen('Indenting paragraphs...', async function(){
        await tabIndentParasInAllChaps(project, options);
        hideWorking();
        onFinish();
      });
    };

    popup.appendChild(indentForm);

    document.body.appendChild(popup);

    skipTbl.querySelector('input').focus();

    function selectedOptions(){
      var doNotIndentAfter = {};

      Object.keys(skipChecks).forEach(function(id){
        doNotIndentAfter[id] = skipChecks[id].checked;
      });

      return {
        doNotIndentAfter: doNotIndentAfter,
        correctCurrentTabs: correctTabsCheck.checked,
        removeBlankLinesBetweenParagraphs: removeBlanksCheck.checked
      };
    }
  }

  module.exports = showTabIndentParagraphs;
