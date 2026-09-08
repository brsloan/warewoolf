var nspell = require('nspell');
const {
  closePopups, createButton, removeElementsByClass, removeOptions
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

  var available = await platform.listDictionaries();
  var selectedIds = Array.isArray(userSettings.spellcheckDictionaries)
    ? userSettings.spellcheckDictionaries.slice() : [];

  var dictionaryChecklist = buildDictionaryChecklist(available, selectedIds);
  popup.appendChild(dictionaryChecklist.element);

  var personalWords = await platform.loadPersonalDictionary();
  var personalEditor = wordListEditor({ legend: 'Personal Dictionary', words: personalWords });
  popup.appendChild(personalEditor.element);

  var projectEditor = wordListEditor({
    legend: 'Project Dictionary',
    words: project == null ? null : project.projectDictionary,
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

  var saveBtn = createButton('Save');
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

  var closeBtn = createButton('Close');
  closeBtn.onclick = function(){
    closePopups();
  };
  popup.appendChild(closeBtn);

  document.body.appendChild(popup);
  saveBtn.focus();
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

  var filterLabel = document.createElement('label');
  filterLabel.innerText = 'Filter/Word: ';
  fieldset.appendChild(filterLabel);

  var filterInput = document.createElement('input');
  filterInput.type = 'text';
  fieldset.appendChild(filterInput);
  fieldset.appendChild(document.createElement('br'));

  var listbox = document.createElement('select');
  listbox.multiple = true;
  listbox.classList.add('word-list');
  fieldset.appendChild(listbox);

  //Reads as "nothing matched" when it comes out 0 of a non-zero total, and "your dictionary is
  //empty" only when the total itself is 0 - the count line is what tells those two apart.
  var countLine = document.createElement('p');
  countLine.classList.add('sublabel');
  fieldset.appendChild(countLine);

  var addBtn = createButton('Add');
  var editBtn = createButton('Edit');
  var deleteBtn = createButton('Delete');
  var saveWordBtn = createButton('Save Word');
  var cancelEditBtn = createButton('Cancel Edit');
  saveWordBtn.hidden = true;
  cancelEditBtn.hidden = true;

  fieldset.appendChild(addBtn);
  fieldset.appendChild(editBtn);
  fieldset.appendChild(deleteBtn);
  fieldset.appendChild(saveWordBtn);
  fieldset.appendChild(cancelEditBtn);

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

    countLine.innerText = '(' + matches.length + ' of ' + currentWords.length + ')';
    updateAddButton();
    updateSelectionButtons();
  }

  //Enabled when the input is non-empty and no word matches it exactly - typing a word to check
  //whether it is already there and then adding it is one gesture, not two.
  function updateAddButton(){
    var trimmed = filterInput.value.trim();
    addBtn.disabled = trimmed === '' || currentWords.indexOf(forDictionary(trimmed)) > -1;
  }

  function updateSelectionButtons(){
    editBtn.disabled = listbox.selectedOptions.length !== 1;
    deleteBtn.disabled = listbox.selectedOptions.length === 0;
  }

  //Filtering pauses while editing, so the list does not shift under the writer while they retype.
  filterInput.oninput = function(){
    if(editingWord == null)
      render();
    else
      updateAddButton();
  };

  listbox.onchange = updateSelectionButtons;

  addBtn.onclick = function(){
    var word = forDictionary(filterInput.value.trim());
    if(word === '' || currentWords.indexOf(word) > -1)
      return;

    currentWords.push(word);
    filterInput.value = '';
    render();
  };

  editBtn.onclick = function(){
    if(listbox.selectedOptions.length !== 1)
      return;

    editingWord = listbox.selectedOptions[0].value;
    filterInput.value = editingWord;
    setEditingMode(true);
    filterInput.focus();
  };

  function setEditingMode(editing){
    addBtn.hidden = editing;
    editBtn.hidden = editing;
    deleteBtn.hidden = editing;
    saveWordBtn.hidden = !editing;
    cancelEditBtn.hidden = !editing;
  }

  //Renaming a word onto one already in the list drops the entry being edited rather than writing a
  //second copy of the target - the list is a set, and two identical rows are only ever something to
  //go back and delete by hand.
  saveWordBtn.onclick = function(){
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
  };

  cancelEditBtn.onclick = function(){
    endEdit();
  };

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
