const { closePopups, createButton, removeElementsByClass, generateRow } = require('../controllers/utils');
const { convertSubstitutionsForAllChapters } = require('../controllers/convert-substitutions');
const { getAutocorrectDefs } = require('../models/autocorrect');
const { showWorkingAndThen, hideWorking } = require('./working_display');

function showSubstitutionOptions(project, onFinish){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var popupTitle = document.createElement('h1');
    popupTitle.innerText = 'Convert Straight Quotes Etc.';
    popup.appendChild(popupTitle);

    var undoWarning = document.createElement('p');
    undoWarning.innerText = 'WARNING: This action cannot be undone. Be sure to save first.';
    undoWarning.classList.add('warning-text');
    popup.appendChild(undoWarning);

    var explanation = document.createElement('p');
    explanation.innerText = 'Applies the same substitutions the editor makes as you type, to every chapter at once. Uncheck any you would rather leave alone.';
    popup.appendChild(explanation);

    //Worth saying here rather than only in the Help doc. Typing gives a writer Ctrl+Z the moment
    //they see it happen; a pass over the whole manuscript changes every scene break at once, and
    //cannot be undone.
    var dashNote = document.createElement('p');
    dashNote.innerText = 'Note: a line of three or more hyphens, of the sort used to mark a scene break, will become a dash followed by a hyphen. Uncheck Em Dash if your manuscript uses those.';
    popup.appendChild(dashNote);

    var substitutionForm = document.createElement("form");

    var ruleTbl = document.createElement('table');
    var ruleChecks = {};

    //Every rule starts checked whatever the writer has switched off in Settings. Those settings say
    //what should happen to the next character typed; this is a one-off pass over work already
    //written, and someone who never wanted smart quotes as they type may still want them here.
    getAutocorrectDefs().forEach(function(def){
      var ruleLabel = document.createElement('label');
      ruleLabel.innerText = def.label + ' (' + def.example + '): ';
      ruleLabel.htmlFor = 'convert-' + def.id;

      var ruleCheck = document.createElement('input');
      ruleCheck.type = 'checkbox';
      ruleCheck.id = 'convert-' + def.id;
      ruleCheck.checked = true;

      ruleChecks[def.id] = ruleCheck;
      ruleTbl.appendChild(generateRow(ruleLabel, ruleCheck));
    });

    substitutionForm.appendChild(ruleTbl);

    var convertBtn = document.createElement("input");
    convertBtn.type = "submit";
    convertBtn.value = "Submit";
    substitutionForm.appendChild(convertBtn);

    var cancelBtn = createButton("Cancel");
    cancelBtn.onclick = function(){
      closePopups();
    };
    substitutionForm.appendChild(cancelBtn);

    substitutionForm.onsubmit = function(e){
      e.preventDefault();

      var rules = checkedRules();
      closePopups();
      //Converting can be slow on projects with many/large chapters, so show a working indicator
      //(deferred via showWorkingAndThen) instead of blocking with no feedback - same as
      //convert-tabs-display.js.
      showWorkingAndThen('Converting straight quotes...', async function(){
        await convertSubstitutionsForAllChapters(project, rules);
        hideWorking();
        onFinish();
      });
    };

    popup.appendChild(substitutionForm);

    document.body.appendChild(popup);

    ruleTbl.querySelector('input').focus();

    function checkedRules(){
      var checked = {};

      Object.keys(ruleChecks).forEach(function(id){
        checked[id] = ruleChecks[id].checked;
      });

      return checked;
    }
  }

  module.exports = showSubstitutionOptions;
