const {
  closePopups, createButton, removeElementsByClass, removeOptions, describeDialog
} = require('../controllers/utils');
const { nameCounts, mergeNames, renameName } = require('../controllers/screenplay-editor');
const showRenameConfirmation = require('./rename-confirmation_display');

//Tools > Characters/Locations, for a screenplay project only: the two lists autocomplete completes
//a cue and a scene heading from, shown as one dialog with a list each.
//
//The lists are not a store the script is copied into. What they show is the names the script itself
//is written with - every cue, every heading, read by the same spans autocomplete uses
//(screenplay-editor.js's cueNameSpan/headingNameSpan) - together with the project's own two
//changes to that list, which live in `project.screenplayNames` and travel with the .woolf: names
//`added` that the script has not reached yet, and names `removed` that it uses but is not to offer.
//That is what makes what is written beside each name the whole story - the lines of the script it
//is in, or "added", and "removed" when it is not being offered.
//
//So the four things a writer can do to a list are each about one of those three:
//
//  Add      a name the script has not reached yet - a character due in act three - so it completes
//           from the first cue that is typed for them.
//  Rename   every use of a name in the script at once - for a character that is his cues and every
//           other line he is named in. This is the one that touches the script, so it is the one
//           that asks first: renameName is run once to describe the change, the writer is told how
//           far it reaches and what it can get wrong, and only then is it made. `script.rename`
//           writes it, and the editor's own undo puts it back, since a rename made from a dialog is
//           still an edit to the script.
//  Remove   a name from the list, which is a change to the list and to nothing else: the script
//           keeps every line the name is in, and only stops offering it. This is what a one-off DAN
//           in scene one needs - he cannot be unwritten, and while he is offered every attempt at
//           DANIELLE is met with him first. A removed name keeps its row, marked, so it can be seen
//           and put back: the same button reads Restore when the selection is one.
//  Refresh  undoes both, leaving the list as the script itself writes it. Nothing has to be
//           refreshed for a name just typed into the script to be offered; this is for the
//           additions and removals that turned out not to be wanted.
//
//Every change is made as it is asked for rather than gathered up behind a Save, because a rename
//is an edit to the script and belongs in the editor's history with the writer's own - a dialog
//holding one back would put it there at a moment the writer had stopped thinking about it.
//
//`script` is { getDelta(), rename(type, from, to) -> lines changed }, which render.js builds around
//whichever copy of the script is the live one - the editor's, when the script is the document being
//edited, and the chapter's contents when it is not.
function showScreenplayNames(project, script){
  removeElementsByClass('popup');
  var popup = document.createElement('div');
  popup.classList.add('popup', 'popup-names');

  var header = document.createElement('h1');
  header.innerText = 'Characters/Locations';
  popup.appendChild(header);
  describeDialog(popup, header);

  var note = document.createElement('p');
  note.classList.add('sublabel');
  note.innerText = 'Remove eliminates names from autofill, but does not change the script. Rename rewrites every line of the script that uses a name.';
  popup.appendChild(note);

  //Side by side where there is width for it, one above the other where there is not - a screen the
  //size of a writerDeck's cannot hold two lists across, and a dialog that has to be scrolled to
  //reach its second half is the worse answer of the two only when it did not have to be.
  var lists = document.createElement('div');
  lists.classList.add('name-lists');
  popup.appendChild(lists);

  var characters = nameListEditor({
    project: project,
    script: script,
    id: 'characters',
    legend: 'Characters',
    type: 'character',
    listKey: 'characters',
    listLabel: 'Character names',
    //What the count beside a name counts, and what the warning before a rename says it is rewriting.
    nameNoun: 'cue'
  });
  lists.appendChild(characters.element);

  var locations = nameListEditor({
    project: project,
    script: script,
    id: 'locations',
    legend: 'Locations',
    type: 'location',
    listKey: 'locations',
    listLabel: 'Location names',
    nameNoun: 'scene heading'
  });
  lists.appendChild(locations.element);

  //No Save: every change is already made. Close is the only way out, and it is the only button.
  var closeBtn = createButton("<span class='access-key'>C</span>lose");
  closeBtn.accessKey = 'c';
  closeBtn.onclick = function(){
    closePopups();
  };
  popup.appendChild(closeBtn);

  document.body.appendChild(popup);
  characters.focus();

  return popup;
}

//One list, built twice - once for the characters and once for the locations, which differ only in
//what they are called and which lines of the script they are read from. Two hand-written copies of
//this would be two places for the rules about what can be removed to drift apart.
function nameListEditor(config){
  var project = config.project;
  var script = config.script;

  var rows = [];
  var renaming = null;
  var statusFromSelection = false;
  //What the filter is currently showing, which is what says whether Enter in the field can only
  //mean "add this" - the same line the Dictionaries word list draws. See its keydown handler.
  var visibleCount = 0;

  var fieldset = document.createElement('fieldset');
  var legend = document.createElement('legend');
  legend.innerText = config.legend;
  fieldset.appendChild(legend);

  var header = document.createElement('div');
  header.classList.add('word-list-header');
  fieldset.appendChild(header);

  var filterLabel = document.createElement('label');
  filterLabel.innerText = 'Filter/Name: ';
  filterLabel.htmlFor = 'name-filter-' + config.id;
  header.appendChild(filterLabel);

  var filterInput = document.createElement('input');
  filterInput.type = 'text';
  filterInput.id = filterLabel.htmlFor;
  header.appendChild(filterInput);

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
  listbox.setAttribute('aria-label', config.listLabel);
  body.appendChild(listbox);

  var buttonColumn = document.createElement('div');
  buttonColumn.classList.add('word-list-buttons');
  body.appendChild(buttonColumn);

  //One button for Add and Save, the way the Dictionaries word list does it: both commit whatever is
  //in the field, and a Save sitting permanently beside an Add would be a choice to make rather than
  //a state to be in.
  var primaryBtn = createButton('Add');
  var renameBtn = createButton('Rename');
  var removeBtn = createButton('Remove');
  var refreshBtn = createButton('Refresh');

  buttonColumn.appendChild(primaryBtn);
  buttonColumn.appendChild(renameBtn);
  buttonColumn.appendChild(removeBtn);
  buttonColumn.appendChild(refreshBtn);

  //Says what the buttons cannot: why Remove is off for the name that is selected, and what the last
  //rename or refresh actually did to the script. A live region, so a reader who cannot see it
  //hears the answer rather than finding a button that appears to have done nothing.
  var status = document.createElement('p');
  status.classList.add('sublabel');
  status.classList.add('name-list-status');
  status.setAttribute('role', 'status');
  fieldset.appendChild(status);

  //This list's `{ added, removed }` on the project, made safe to push onto: a project from an older
  //build, or one whose .woolf was hand-edited into a shape sanitizeNameLists never saw, still gets
  //two arrays back. Both lists are repaired rather than only the one being asked for, so what is
  //written back out is a whole `screenplayNames` and not half of one.
  function stored(){
    if(!project.screenplayNames || typeof project.screenplayNames !== 'object')
      project.screenplayNames = {};

    ['characters', 'locations'].forEach(function(key){
      var list = project.screenplayNames[key];
      if(!list || typeof list !== 'object')
        list = project.screenplayNames[key] = {};
      if(!Array.isArray(list.added))
        list.added = [];
      if(!Array.isArray(list.removed))
        list.removed = [];
    });

    return project.screenplayNames[config.listKey];
  }

  //Every name in the list, how many lines of the script it is in, and whether it has been removed.
  //Read from the script each time rather than kept and patched, so what the dialog shows is what
  //the script says - including the lines a rename has just rewritten.
  //
  //Built without the removals applied, deliberately: this is the one place a removed name has to
  //stay visible. A row the writer cannot see is a row they cannot put back, and removing DAN by
  //mistake would otherwise be a thing only a hand-edited .woolf could undo.
  function reload(){
    var counts = nameCounts(script ? script.getDelta() : null)[config.listKey];
    var list = stored();

    rows = mergeNames(Object.keys(counts), list.added).map(function(name){
      return { name: name, count: counts[name] || 0, removed: list.removed.indexOf(name) > -1 };
    });

    render();
  }

  function render(){
    var filterText = filterInput.value.trim().toLowerCase();
    removeOptions(listbox);

    var matches = rows.filter(function(row){
      return filterText === '' || row.name.toLowerCase().indexOf(filterText) > -1;
    });

    matches.forEach(function(row){
      var opt = document.createElement('option');
      opt.value = row.name;
      //Where the name comes from and whether it is being offered, both on the row rather than in a
      //column a reader has to look across at: "BOB  (2)", "ZELDA  (added)", "DAN  (1, removed)".
      opt.textContent = row.name + '  (' + (row.count > 0 ? row.count : 'added')
        + (row.removed ? ', removed' : '') + ')';
      if(row.removed)
        opt.classList.add('name-removed');
      listbox.appendChild(opt);
    });

    visibleCount = matches.length;
    countLine.innerText = '(' + matches.length + ' of ' + rows.length + ')';
    updateButtons();

    //Rebuilding the rows drops the selection with them, so a line that was about the selection has
    //to be asked again - it comes back empty, and the reason Remove was off goes with the row it
    //was about. What the last rename or refresh reported is not about the selection and stands.
    if(statusFromSelection)
      say(describeSelection(), true);
  }

  function selectedNames(){
    return Array.prototype.map.call(listbox.selectedOptions, function(opt){ return opt.value; });
  }

  function rowFor(name){
    return rows.filter(function(row){ return row.name === name; })[0];
  }

  function selectedRows(){
    return selectedNames().map(rowFor).filter(Boolean);
  }

  //Whether the button below the list is Restore rather than Remove: it is, when everything selected
  //has already been removed. A selection that reaches over one of each is a Remove, which is what
  //it says, and the rows in it that are already removed are left as they are.
  function restoring(){
    var selected = selectedRows();
    return selected.length > 0 && selected.every(function(row){ return row.removed; });
  }

  function normalized(text){
    return String(text || '').trim().toUpperCase();
  }

  function counted(n, noun){
    return n + ' ' + noun + (n === 1 ? '' : 's');
  }

  function updateButtons(){
    var typed = normalized(filterInput.value);
    var selected = selectedNames();
    var list = stored();

    //Adding: a name that is already in the list is not a name to add, whether the script wrote it,
    //the writer did, or it is sitting there removed - a removed name comes back through Restore,
    //which is the row in front of them rather than a second way in. Renaming: anything non-empty,
    //since it replaces a name rather than proposing a new one.
    primaryBtn.disabled = typed === ''
      || (renaming == null && rows.some(function(row){ return row.name === typed; }));

    renameBtn.disabled = renaming != null || selected.length !== 1;
    removeBtn.disabled = renaming != null || selected.length === 0;
    removeBtn.textContent = restoring() ? 'Restore' : 'Remove';
    refreshBtn.disabled = renaming != null || (list.added.length === 0 && list.removed.length === 0);
  }

  //Only ever about the selection, and only while nothing else has something to say - the line a
  //rename or a refresh left there is the answer to the click that has just happened, and it stands
  //until the writer does something else. What it is for is the one thing about this dialog that is
  //not obvious from the buttons: that removing a name leaves the script exactly as it is.
  function describeSelection(){
    var selected = selectedRows();

    if(renaming != null || selected.length === 0)
      return '';

    if(restoring())
      return selected.length === 1
        ? selected[0].name + ' is not being offered. Restore puts it back.'
        : selected.length + ' removed names. Restore puts them back.';

    if(selected.length === 1 && selected[0].count > 0)
      return selected[0].name + ' has ' + counted(selected[0].count, config.nameNoun)
        + ' in the script. Remove stops it being offered and leaves them as they are.';

    return '';
  }

  //`fromSelection` marks the line as an answer about what is selected rather than a report of
  //something that happened, which is what render() needs to know to clear it - see there.
  function say(text, fromSelection){
    status.innerText = text;
    statusFromSelection = fromSelection === true;
  }

  filterInput.oninput = function(){
    if(renaming == null)
      render();
    else
      updateButtons();
  };

  //Enter commits what the button would: the rename in progress, or - when the filter has matched
  //nothing at all - the name just typed. "Nothing matched" rather than "no exact match" for the
  //reason the Dictionaries list gives: with "DOR" typed and DORSET in the list the writer is still
  //narrowing, and adding DOR there would be an entry nobody asked for.
  //
  //Escape abandons a rename and must not travel further: keybindings.js closes every popup on
  //Escape, so without stopping it here the dialog would go with the rename.
  filterInput.addEventListener('keydown', function(e){
    if(e.key === 'Enter'){
      e.preventDefault();
      e.stopPropagation();

      if(renaming != null)
        commitRename();
      else if(visibleCount === 0)
        addTypedName();

      return;
    }

    if(e.key === 'Escape' && renaming != null){
      e.preventDefault();
      e.stopPropagation();
      endRename();
    }
  });

  //Leaving the field abandons the rename, which is what makes a Cancel button unnecessary. The one
  //departure that is not an abandonment is the button that commits it - reached by Tab
  //(relatedTarget) or by click (activeElement, for browsers that leave relatedTarget null).
  filterInput.addEventListener('blur', function(e){
    if(renaming == null)
      return;
    if(e.relatedTarget === primaryBtn || document.activeElement === primaryBtn)
      return;

    endRename();
  });

  //And a click on it must not blur the field first: the blur above would abandon the rename before
  //the click meant to commit it ever ran. Suppressing the mousedown keeps the focus where it is;
  //the click still fires.
  primaryBtn.addEventListener('mousedown', function(e){
    e.preventDefault();
  });

  listbox.onchange = function(){
    updateButtons();
    say(describeSelection(), true);
  };

  primaryBtn.onclick = function(){
    if(renaming != null)
      commitRename();
    else
      addTypedName();
  };

  function addTypedName(){
    var name = normalized(filterInput.value);
    if(name === '' || rows.some(function(row){ return row.name === name; }))
      return;

    stored().added.push(name);
    project.hasUnsavedChanges = true;
    filterInput.value = '';
    say(name + ' will be offered from now on, whether or not the script uses it yet.');
    reload();
  }

  renameBtn.onclick = function(){
    if(selectedNames().length !== 1)
      return;

    renaming = selectedNames()[0];
    filterInput.value = renaming;
    primaryBtn.textContent = 'Save';
    say('Renaming ' + renaming + '. Every line of the script that uses it will be rewritten.');
    updateButtons();
    filterInput.focus();
  };

  //A rename that reaches the script is described to the writer and asked about before it is made;
  //one that does not - a name only ever in the project's own list, in no line of the script - has
  //nothing to warn about and is simply done. Saying which of the two happened is the difference
  //between a rename that quietly did nothing and one that had nothing to do.
  //
  //The edit in the field is ended before the question is asked, so the dialog behind can be left in
  //a settled state while the writer reads it - and so the field's own blur, which abandons an edit,
  //has nothing left to abandon when the focus moves to the buttons. Cancelling therefore leaves the
  //name as it was rather than the rename half-made.
  function commitRename(){
    var from = renaming;
    var to = normalized(filterInput.value);

    if(to === '' || to === from){
      endRename();
      return;
    }

    //Run for what it describes, not for its ops: script.rename runs it again to make the change.
    //Cheap enough for a dialog, and it means the writer is shown the script as it stands rather
    //than a change worked out earlier and held.
    var change = script ? renameName(script.getDelta(), config.type, from, to) : null;
    endRename();

    if(!change){
      renameStored(from, to);
      say('Renamed ' + from + ' to ' + to + '. The script has no line using that name.');
      //endRename() above rebuilt the rows from the lists as they were, so they have to be read
      //again now the project's own entry has moved.
      reload();
      return;
    }

    showRenameConfirmation({
      from: from,
      to: to,
      nameNoun: config.nameNoun,
      nameLines: change.nameLines,
      otherLines: change.otherLines
    }, function(){
      var lines = script.rename(config.type, from, to);
      renameStored(from, to);
      say('Renamed ' + from + ' to ' + to + ' in ' + lines + (lines === 1 ? ' line' : ' lines') + ' of the script.');
      reload();
    });

    say('Renaming ' + from + ' to ' + to + '. Nothing is written until you confirm it.');
  }

  //The project's own entry for the name follows the rename, in whichever of its two lists it is in:
  //a character added before they were written stays added under the new name, and one the writer
  //took out of the list stays out of it. Renaming onto a name the list already holds drops the
  //entry rather than writing a second copy of it - each list is a set, and two identical entries
  //are only ever something to come back and delete by hand.
  function renameStored(from, to){
    var list = stored();
    var changed = false;

    ['added', 'removed'].forEach(function(key){
      var at = list[key].indexOf(from);
      if(at === -1)
        return;

      if(list[key].indexOf(to) > -1)
        list[key].splice(at, 1);
      else
        list[key][at] = to;

      changed = true;
    });

    if(changed)
      project.hasUnsavedChanges = true;
  }

  function endRename(){
    renaming = null;
    filterInput.value = '';
    primaryBtn.textContent = 'Add';
    reload();
  }

  removeBtn.onclick = function(){
    if(removeBtn.disabled)
      return;

    if(restoring())
      restoreSelected();
    else
      removeSelected();
  };

  //Taking a name out of the list is a change to the list and to nothing else. The script keeps every
  //line the name is in; it is only no longer offered - which is the whole point of it, since the
  //one-off DAN in scene one cannot be unwritten and answers every attempt at DANIELLE while he is
  //there.
  function removeSelected(){
    var list = stored();
    var going = selectedRows();

    going.forEach(function(row){
      var at = list.added.indexOf(row.name);
      if(at > -1)
        list.added.splice(at, 1);

      //Only a name the script itself writes has to be recorded as removed. One that was never in
      //the script is gone the moment it leaves the added list, and an entry for it would be a note
      //about a name nothing can produce - which Refresh would then report as a change to undo.
      if(row.count > 0 && list.removed.indexOf(row.name) === -1)
        list.removed.push(row.name);
    });

    project.hasUnsavedChanges = true;
    say(going.length === 1
      ? going[0].name + ' is no longer offered. Every line of the script it is in is untouched.'
      : going.length + ' names are no longer offered. Every line of the script they are in is untouched.');
    reload();
  }

  function restoreSelected(){
    var list = stored();
    var coming = selectedNames();

    list.removed = list.removed.filter(function(name){
      return coming.indexOf(name) === -1;
    });
    project.hasUnsavedChanges = true;

    say(coming.length === 1
      ? coming[0] + ' is offered again.'
      : coming.length + ' names are offered again.');
    reload();
  }

  //"Rebuilt from the script itself": both of the project's own changes to the list go, and what is
  //left is the names the script is written with - which is what the list would have been had nobody
  //touched it. Disabled when there is nothing to undo, so it is never a button that looks like it
  //did nothing.
  refreshBtn.onclick = function(){
    if(refreshBtn.disabled)
      return;

    var list = stored();
    var undone = list.added.length + list.removed.length;
    list.added = [];
    list.removed = [];
    project.hasUnsavedChanges = true;

    say('Rebuilt from the script, undoing ' + undone + (undone === 1 ? ' change to this list.' : ' changes to this list.'));
    reload();
  };

  reload();

  return {
    element: fieldset,
    focus: function(){ filterInput.focus(); }
  };
}

module.exports = showScreenplayNames;
