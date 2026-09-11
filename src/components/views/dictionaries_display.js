var nspell = require('nspell');
const {
  closePopups, createButton, removeElementsByClass, removeOptions, describeDialog
} = require('../controllers/utils');
const showFileDialog = require('./file-dialog_display');
const showBlockedActionAlert = require('./blocked-action_display');
const displayDeleteConfirmation = require('./delete-confirmation_display');
const { createPlatform } = require('../controllers/platform');
const { createIpcBacking } = require('../controllers/platform-ipc');
const { forDictionary } = require('../controllers/spellcheck');

//readDictionaryFiles/importDictionary/etc. take no injected config - every path is a full path -
//so this holds its own standing instance, the same reason import.js/docx-import.js do.
var platform = createPlatform(createIpcBacking());

//Mirrors platform-node.js's SHARED_DICT_BASENAME. There is no command that hands this id back -
//it is loadDictionaries' own fallback on the native side, not a setting this dialog reads - so
//ticking it visually when nothing else is selected is a UI convenience only. getSpellchecker()
//falls back to the same dictionary either way, whatever this dialog shows.
var DEFAULT_DICTIONARY_ID = 'en_US-large';

//Standard popup, in the same edits-in-memory-until-Save model as settings_display.js: Close has to
//mean something, and a word list that saved on every keystroke would rewrite the file dozens of
//times while a writer is just looking.
async function showDictionaries(userSettings, project, callback){
  removeElementsByClass('popup');
  var popup = document.createElement('div');
  popup.classList.add('popup');

  var header = document.createElement('h1');
  header.innerText = 'Dictionaries';
  popup.appendChild(header);
  describeDialog(popup, header);

  var available = await platform.listDictionaries();
  var selectedIds = Array.isArray(userSettings.spellcheckDictionaries)
    ? userSettings.spellcheckDictionaries.slice() : [];

  var dictionaryChecklist = buildDictionaryChecklist(available, selectedIds);
  popup.appendChild(dictionaryChecklist.element);

  //An accessKey has to be unique across the whole page to be reachable at all, so the two Delete
  //buttons cannot both answer to Alt+D - hence the second one marking its 't'. Add and Edit carry
  //none deliberately: Enter in the field already does what Add does, and Edit is meaningless
  //without first picking a row out of the list beside it.
  var personalWords = await platform.loadPersonalDictionary();
  var personalEditor = wordListEditor({
    id: 'personal',
    legend: 'Personal Dictionary',
    words: personalWords,
    deleteLabel: "<span class='access-key'>D</span>elete",
    deleteAccessKey: 'd'
  });
  popup.appendChild(personalEditor.element);

  var projectEditor = wordListEditor({
    id: 'project',
    legend: 'Project Dictionary',
    words: project == null ? null : project.projectDictionary,
    deleteLabel: "Dele<span class='access-key'>t</span>e",
    deleteAccessKey: 't',
    emptyNote: 'Open a project to give it its own word list of character and place names.'
  });
  popup.appendChild(projectEditor.element);

  //Bulk-adding two hundred names from a series bible one at a time through Add is not a thing
  //anyone would do. Disabled with no project open - projectEditor.getWords() is null in that case,
  //and there is nothing to import words into.
  if(project != null){
    var importWordsBtn = createButton('Import Word List...');
    importWordsBtn.onclick = function(){
      importProjectWordList(projectEditor);
    };
    projectEditor.element.appendChild(importWordsBtn);
  }

  var saveBtn = createButton("<span class='access-key'>S</span>ave");
  saveBtn.accessKey = 's';
  saveBtn.onclick = async function(){
    await platform.savePersonalDictionary({ words: personalEditor.getWords() });

    var projectWords = projectEditor.getWords();
    if(project != null && projectWords != null){
      project.projectDictionary = projectWords;
      project.hasUnsavedChanges = true;
    }

    userSettings.spellcheckDictionaries = dictionaryChecklist.getSelectedIds();
    await userSettings.save();

    callback();
    closePopups();
  };
  popup.appendChild(saveBtn);

  var closeBtn = createButton("<span class='access-key'>C</span>lose");
  closeBtn.accessKey = 'c';
  closeBtn.onclick = function(){
    closePopups();
  };
  popup.appendChild(closeBtn);

  document.body.appendChild(popup);
  //The top of the dialog rather than the bottom: the checklist is what this is for, and Import is
  //the first thing in it a writer can act on. Landing on Save would put the caret past everything
  //the dialog exists to change.
  dictionaryChecklist.focusImport();
}

//Checkboxes rather than a <select multiple> - multi-selecting in a listbox needs Ctrl+arrow, a
//poor fit for an app whose stated goal is being usable without a mouse, while a checkbox takes
//Space and carries a real <label>. The list is short by nature - this is not the word list, which
//is why that one below is a listbox instead.
function buildDictionaryChecklist(initialAvailable, selectedIds){
  var fieldset = document.createElement('fieldset');
  var legend = document.createElement('legend');
  legend.innerText = 'Spellcheck Dictionaries';
  fieldset.appendChild(legend);

  var usingFallback = selectedIds.length === 0;
  var effectiveSelected = usingFallback ? [DEFAULT_DICTIONARY_ID] : selectedIds;
  //An empty selection does not mean "en_US-large", it means "whatever this version of the app
  //ships as its default" - which is what lets a default changed in a later release reach a writer
  //who never opened this dialog. Ticking the fallback below is a display convenience, so saving it
  //back as a literal id would quietly destroy that property for anyone who opened the dialog once
  //and clicked Save. This records whether the writer actually changed anything; if they did not,
  //getSelectedIds() hands back the empty selection it was given.
  var touched = false;

  var list = document.createElement('div');
  list.classList.add('dictionary-checklist');
  fieldset.appendChild(list);

  var checkboxes = {};
  var rows = {};
  var removableFlags = {};
  var highlightedId = null;

  if(usingFallback){
    var fallbackNote = document.createElement('p');
    fallbackNote.classList.add('sublabel');
    fallbackNote.innerText = 'No dictionaries selected - using ' + DEFAULT_DICTIONARY_ID + ' by default.';
    fieldset.appendChild(fallbackNote);
  }

  var importBtn = createButton('Import...');
  var removeBtn = createButton('Remove');
  removeBtn.disabled = true;
  fieldset.appendChild(importBtn);
  fieldset.appendChild(removeBtn);

  function refreshRemoveButton(){
    removeBtn.disabled = highlightedId == null || !removableFlags[highlightedId];
  }

  //Shared between the initial listing and a dictionary this dialog just imported, so the two never
  //drift into building a row two different ways.
  function addRow(dict, ticked){
    removableFlags[dict.id] = dict.removable;

    var row = document.createElement('div');
    row.classList.add('dictionary-row');
    row.tabIndex = 0;

    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'dictionary-checkbox-' + dict.id;
    checkbox.checked = ticked;
    checkbox.addEventListener('change', function(){ touched = true; });
    checkboxes[dict.id] = checkbox;

    var label = document.createElement('label');
    label.htmlFor = checkbox.id;
    label.innerText = dict.id + ' (' + dict.source + ')';

    row.appendChild(checkbox);
    row.appendChild(label);

    //Highlighting (for Remove) is deliberately independent of the checkbox's own ticked state -
    //clicking anywhere in the row selects it for Remove, whether or not that click landed on the
    //checkbox and toggled it too.
    row.addEventListener('click', function(){
      highlightedId = dict.id;
      Array.prototype.forEach.call(list.children, function(r){ r.classList.remove('selected'); });
      row.classList.add('selected');
      refreshRemoveButton();
    });

    rows[dict.id] = row;
    list.appendChild(row);
  }

  initialAvailable.forEach(function(dict){
    addRow(dict, effectiveSelected.indexOf(dict.id) > -1);
  });

  removeBtn.onclick = function(){
    if(removeBtn.disabled || highlightedId == null)
      return;

    var idToRemove = highlightedId;

    displayDeleteConfirmation(async function(){
      try{
        await platform.removeDictionary({ id: idToRemove });

        rows[idToRemove].remove();
        delete rows[idToRemove];
        delete checkboxes[idToRemove];
        delete removableFlags[idToRemove];
        highlightedId = null;
        //Importing or removing a dictionary is a change to the selection as much as ticking a box
        //is, so neither one may be mistaken for an untouched dialog and saved back as the empty
        //"use the shipped default" selection.
        touched = true;
        refreshRemoveButton();
      }
      catch(err){
        showBlockedActionAlert('Could not remove the dictionary: ' + err.message);
      }
    });
  };

  importBtn.onclick = function(){
    return importDictionaryFlow().catch(function(err){
      showBlockedActionAlert('Could not import the dictionary: ' + err.message);
    });
  };

  //Import is validate-then-commit: nothing is written until nspell has actually parsed the pair,
  //and a failure at any step reports the reason and writes nothing.
  async function importDictionaryFlow(){
    var appPaths = await platform.getAppPaths();

    var dialogOptions = {
      title: 'Import Dictionary...',
      defaultPath: appPaths.docs,
      filters: [{ name: 'Dictionary files', extensions: ['dic', 'aff', 'txt'] }],
      bookmarkedPaths: [appPaths.docs, appPaths.home],
      dialogType: 'open'
    };

    return new Promise(function(resolve, reject){
      showFileDialog(dialogOptions, function(filepaths){
        completeImport(filepaths).then(resolve, reject);
      });
    });
  }

  async function completeImport(filepaths){
    if(filepaths == null || filepaths.length === 0)
      return;

    var resolvedPaths = await resolveDictionaryPaths(filepaths[0]);
    var read = await platform.readDictionaryFiles(resolvedPaths);

    //A .dic that parses to zero usable words is the common failure for a file that is actually an
    //.oxt or an HTML error page - checking one known word from it catches that before anything is
    //written.
    var testSpell = nspell({ aff: read.aff, dic: read.dic });
    var knownWord = firstWordOf(read.dic);
    if(knownWord == null || !testSpell.correct(knownWord))
      throw new Error('That file does not look like a usable dictionary.');

    await platform.importDictionary({ id: read.id, aff: read.aff, dic: read.dic });

    addRow({ id: read.id, source: 'imported', removable: true }, true);
    touched = true;
  }

  return {
    element: fieldset,
    focusImport: function(){ importBtn.focus(); },
    getSelectedIds: function(){
      if(usingFallback && !touched)
        return [];

      return Object.keys(checkboxes).filter(function(id){ return checkboxes[id].checked; });
    }
  };
}

//From the file the writer picks, the sibling with the other extension and the same basename is
//inferred. A missing .aff means a bare word list (fine - readDictionaryFiles generates one); a
//missing .dic is reported by name, since there is nothing to import without a word list.
async function resolveDictionaryPaths(picked){
  var extIndex = picked.lastIndexOf('.');
  var base = extIndex > -1 ? picked.substring(0, extIndex) : picked;
  var ext = extIndex > -1 ? picked.substring(extIndex + 1).toLowerCase() : '';

  if(ext === 'aff'){
    var dicPath = base + '.dic';
    if(!(await platform.pathExists({ path: dicPath })))
      throw new Error('No matching .dic file was found for "' + picked + '".');

    return { affPath: picked, dicPath: dicPath };
  }

  var affPath = base + '.aff';
  var hasAff = await platform.pathExists({ path: affPath });

  return { affPath: hasAff ? affPath : null, dicPath: picked };
}

//The .dic format is a count on the first line, one "word" or "word/flags" entry per line after
//that.
function firstWordOf(dicText){
  var lines = dicText.split('\n');

  for(var i = 1; i < lines.length; i++){
    var line = lines[i].trim();
    if(line !== '')
      return line.split('/')[0];
  }

  return null;
}

async function importProjectWordList(projectEditor){
  try{
    var appPaths = await platform.getAppPaths();

    var dialogOptions = {
      title: 'Import Word List...',
      defaultPath: appPaths.docs,
      filters: [{ name: 'Text files', extensions: ['txt'] }],
      bookmarkedPaths: [appPaths.docs, appPaths.home],
      dialogType: 'open'
    };

    await new Promise(function(resolve, reject){
      showFileDialog(dialogOptions, function(filepaths){
        importWordsFrom(filepaths).then(resolve, reject);
      });
    });
  }
  catch(err){
    showBlockedActionAlert('Could not import the word list: ' + err.message);
  }

  async function importWordsFrom(filepaths){
    if(filepaths == null || filepaths.length === 0)
      return;

    var text = await platform.readTextFile({ path: filepaths[0] });
    var lines = text.split('\n').map(function(line){ return line.trim(); })
      .filter(function(line){ return line !== ''; });

    projectEditor.addWords(lines);
  }
}

//Factored out of the personal/project fieldsets into one shared editor, because two hand-written
//copies of a filter-and-edit list is two places for the filtering to drift. `words: null` (no
//project open) replaces the whole editor with a single explanatory line instead - the word list is
//not a document, and there is nothing to edit when there is no project to hold it.
function wordListEditor(options){
  var fieldset = document.createElement('fieldset');
  var legend = document.createElement('legend');
  legend.innerText = options.legend;
  fieldset.appendChild(legend);

  if(options.words == null){
    var note = document.createElement('p');
    note.innerText = options.emptyNote;
    fieldset.appendChild(note);

    return {
      element: fieldset,
      getWords: function(){ return null; },
      addWords: function(){}
    };
  }

  var currentWords = options.words.slice();
  var editingWord = null;
  //What the filter is currently showing. Enter adds a word only when this is 0 - see the keydown
  //handler below for why that is the line rather than "no exact match".
  var visibleCount = 0;

  //The filter and the count share a row above the list: the count is a fact about what the filter
  //just did, and reads as one line with it rather than as a caption stranded under the listbox.
  var header = document.createElement('div');
  header.classList.add('word-list-header');
  fieldset.appendChild(header);

  var filterLabel = document.createElement('label');
  filterLabel.innerText = 'Filter/Word: ';
  filterLabel.htmlFor = 'word-filter-' + options.id;
  header.appendChild(filterLabel);

  var filterInput = document.createElement('input');
  filterInput.type = 'text';
  filterInput.id = filterLabel.htmlFor;
  header.appendChild(filterInput);

  //Reads as "nothing matched" when it comes out 0 of a non-zero total, and "your dictionary is
  //empty" only when the total itself is 0 - the count is what tells those two apart.
  var countLine = document.createElement('span');
  countLine.classList.add('sublabel');
  countLine.classList.add('word-list-count');
  header.appendChild(countLine);

  var body = document.createElement('div');
  body.classList.add('word-list-body');
  fieldset.appendChild(body);

  var listbox = document.createElement('select');
  listbox.multiple = true;
  listbox.classList.add('word-list');
  listbox.setAttribute('aria-label', 'Words');
  body.appendChild(listbox);

  var buttonColumn = document.createElement('div');
  buttonColumn.classList.add('word-list-buttons');
  body.appendChild(buttonColumn);

  //One button, two jobs, because they are the same job: commit whatever is in the input. It says
  //Add while the input is a new word and Save while it is a word being edited, so there is never a
  //Save sitting next to an Add for the writer to choose between.
  var primaryBtn = createButton('Add');
  var editBtn = createButton('Edit');
  var deleteBtn = createButton(options.deleteLabel);
  deleteBtn.accessKey = options.deleteAccessKey;

  buttonColumn.appendChild(primaryBtn);
  buttonColumn.appendChild(editBtn);
  buttonColumn.appendChild(deleteBtn);

  function render(){
    var filterText = filterInput.value.trim().toLowerCase();
    removeOptions(listbox);

    var matches = currentWords.filter(function(word){
      return filterText === '' || word.toLowerCase().indexOf(filterText) > -1;
    }).slice().sort(function(a, b){ return a.localeCompare(b); });

    matches.forEach(function(word){
      var opt = document.createElement('option');
      opt.value = word;
      opt.textContent = word;
      listbox.appendChild(opt);
    });

    visibleCount = matches.length;
    countLine.innerText = '(' + matches.length + ' of ' + currentWords.length + ')';
    updatePrimaryButton();
    updateSelectionButtons();
  }

  //Adding: enabled when the input is non-empty and no word matches it exactly - typing a word to
  //check whether it is already there and then adding it is one gesture, not two. Editing: enabled
  //for anything non-empty, since the writer is replacing a word rather than proposing a new one.
  function updatePrimaryButton(){
    var trimmed = filterInput.value.trim();

    primaryBtn.disabled = trimmed === ''
      || (editingWord == null && currentWords.indexOf(forDictionary(trimmed)) > -1);
  }

  //Both act on the listbox selection, which is not what the writer is looking at mid-edit. Disabled
  //rather than hidden: they sit in a fixed column beside the list now, and hiding them would shuffle
  //the remaining buttons under the pointer.
  function updateSelectionButtons(){
    editBtn.disabled = editingWord != null || listbox.selectedOptions.length !== 1;
    deleteBtn.disabled = editingWord != null || listbox.selectedOptions.length === 0;
  }

  //Filtering pauses while editing, so the list does not shift under the writer while they retype.
  filterInput.oninput = function(){
    if(editingWord == null)
      render();
    else
      updatePrimaryButton();
  };

  //Enter commits whatever the button would: the edit in progress, or - when the filter has matched
  //nothing at all - the word just typed. "No matches" rather than "no exact match" is the line
  //deliberately: with "dor" typed and Dorset in the list the writer is still narrowing, and Enter
  //adding "dor" there would be an entry nobody asked for. An empty result means there is nothing
  //left to narrow to, so the text can only be a new word.
  //
  //Escape cancels an edit and must not travel any further - keybindings.js closes every popup on
  //Escape, so without stopping it here the dialog would go with the edit.
  filterInput.addEventListener('keydown', function(e){
    if(e.key === 'Enter'){
      e.preventDefault();
      e.stopPropagation();

      if(editingWord != null)
        commitEdit();
      else if(visibleCount === 0)
        addTypedWord();

      return;
    }

    if(e.key === 'Escape' && editingWord != null){
      e.preventDefault();
      e.stopPropagation();
      endEdit();
    }
  });

  //Leaving the field abandons the edit, which is what makes Cancel Edit unnecessary as a button.
  //The one departure that is not an abandonment is the button that commits it - reached by Tab
  //(relatedTarget) or by click (activeElement, for browsers that leave relatedTarget null).
  filterInput.addEventListener('blur', function(e){
    if(editingWord == null)
      return;
    if(e.relatedTarget === primaryBtn || document.activeElement === primaryBtn)
      return;

    endEdit();
  });

  //And a click on it must not blur the input first: the blur above would abandon the edit before
  //the click that meant to commit it ever ran. Suppressing the mousedown's default keeps focus
  //where it is; the click still fires.
  primaryBtn.addEventListener('mousedown', function(e){
    e.preventDefault();
  });

  listbox.onchange = updateSelectionButtons;

  primaryBtn.onclick = function(){
    if(editingWord != null)
      commitEdit();
    else
      addTypedWord();
  };

  function addTypedWord(){
    var word = forDictionary(filterInput.value.trim());
    if(word === '' || currentWords.indexOf(word) > -1)
      return;

    currentWords.push(word);
    filterInput.value = '';
    render();
  }

  editBtn.onclick = function(){
    if(listbox.selectedOptions.length !== 1)
      return;

    editingWord = listbox.selectedOptions[0].value;
    filterInput.value = editingWord;
    setEditingMode(true);
    filterInput.focus();
  };

  function setEditingMode(editing){
    primaryBtn.textContent = editing ? 'Save' : 'Add';
    updatePrimaryButton();
    updateSelectionButtons();
  }

  //Renaming a word onto one already in the list drops the entry being edited rather than writing a
  //second copy of the target - the list is a set, and two identical rows are only ever something to
  //go back and delete by hand.
  function commitEdit(){
    var newWord = forDictionary(filterInput.value.trim());
    var idx = currentWords.indexOf(editingWord);

    if(newWord !== '' && idx > -1){
      //Compared by index, not by presence: a writer who opens Edit and saves the word unchanged
      //finds it already in the list at its own position, which is not a duplicate to collapse.
      var existing = currentWords.indexOf(newWord);

      if(existing > -1 && existing !== idx)
        currentWords.splice(idx, 1);
      else
        currentWords[idx] = newWord;
    }

    endEdit();
  }

  function endEdit(){
    editingWord = null;
    filterInput.value = '';
    setEditingMode(false);
    render();
  }

  //`multiple` is on, so a writer can clear out a run of typos from an over-eager Add To Dictionary
  //in one go.
  deleteBtn.onclick = function(){
    var selected = Array.prototype.map.call(listbox.selectedOptions, function(opt){ return opt.value; });
    currentWords = currentWords.filter(function(word){ return selected.indexOf(word) === -1; });
    render();
  };

  render();

  return {
    element: fieldset,
    getWords: function(){ return currentWords.slice(); },
    addWords: function(words){
      words.forEach(function(word){
        var normalized = forDictionary(String(word).trim());
        if(normalized !== '' && currentWords.indexOf(normalized) === -1)
          currentWords.push(normalized);
      });
      render();
    }
  };
}

module.exports = showDictionaries;
