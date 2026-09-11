const { closePopups, createButton, removeElementsByClass, describeDialog } = require('../controllers/utils');
const {
  SECTIONS,
  getShortcutDefs,
  getDefaultBindings,
  diffFromDefaults,
  bindingFromEvent,
  isModifierKeyEvent,
  describeKeyEvent,
  formatBinding,
  validateBinding
} = require('../models/shortcuts');

//The Shortcuts popup, which is both the list of what the keys do and the place they are changed.
//It reads its rows from models/shortcuts.js rather than from a copy of its own - the copy is how it
//used to end up documenting shortcuts the app did not actually implement.
//
//Changes are held here until Save, the way the Settings dialog holds its own. That is what makes
//Restore Defaults safe to offer without a confirmation of its own: nothing has happened yet, and
//Close walks away from it.
//
//  options.isMac    - whether to write the platform modifier as Cmd or Ctrl.
//  options.bindings - the shortcuts currently in force. Defaults when not given, which is what a
//                     caller wanting the list rather than the editor passes.
//  options.onSave   - called with only what differs from the defaults (see diffFromDefaults), or
//                     absent to show the list without offering to change it.
function showShortcutsHelp(options){
  options = options || {};

  var isMac = Boolean(options.isMac);
  var onSave = typeof options.onSave === 'function' ? options.onSave : null;
  var bindings = copyBindings(options.bindings || getDefaultBindings());

  //The button showing each shortcut's keys, so a rebind (and Restore Defaults, which changes all of
  //them at once) can rewrite the ones it affects without rebuilding the table.
  var keyButtons = {};
  //A row under each shortcut, empty and hidden until that shortcut has something to say. The list
  //is longer than the popup, so a message about the shortcut a writer is looking at has to appear
  //where they are looking - a single message line under the buttons at the end was regularly off
  //the bottom of the screen, saying why a key had been refused to nobody.
  var messageRows = {};
  //Which shortcut's message row is currently showing, so it can be taken down again without
  //walking all of them.
  var shownMessageId = null;
  //The rebind in progress, if any: which shortcut, which button, and what the button said before it
  //started asking - so cancelling can put it back.
  var capturing = null;

  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup", "popup-shortcuts");
  describeDialog(popup, 'Keyboard Shortcuts');

  SECTIONS.forEach(function(section){
    appendSection(section, getShortcutDefs().filter(function(def){
      return def.section === section;
    }));

    //Kept where it has always been in the list. These are the app's own structural keys rather
    //than shortcuts - Escape has to keep closing the dialog a rebind happens in - so they are
    //printed rather than offered.
    if(section === 'Formatting')
      appendStaticSection('Tool/Menu Navigation', [
        ['Open/Navigate File Menu', isMac ? 'Cmd + M, then arrow keys and Escape' : 'Alt, then arrow keys and Escape'],
        ['Close Tool Dialog', "Escape"],
        ['Any Button With A Bold/\rUnderlined Letter', 'Alt + (that letter)'],
        ['Move Between Inputs', 'Tab']
      ]);
  });

  //Restore Defaults is about the whole list rather than any one shortcut, and its button is right
  //here, so its message goes here too.
  var listMessage = document.createElement('p');
  listMessage.classList.add('shortcut-message');
  popup.appendChild(listMessage);

  if(onSave){
    var hint = document.createElement('p');
    hint.innerText = 'Choose a shortcut to change it, then press the keys you want. ' +
      'Escape cancels; Backspace clears.';
    popup.appendChild(hint);
  }

  popup.appendChild(document.createElement('br'));

  if(onSave){
    var saveBtn = createButton("<span class='access-key'>S</span>ave");
    saveBtn.accessKey = 's';
    saveBtn.onclick = function(){
      cancelCapture();
      onSave(diffFromDefaults(bindings));
      closePopups();
    };
    popup.appendChild(saveBtn);

    var restoreBtn = createButton("<span class='access-key'>R</span>estore Defaults");
    restoreBtn.accessKey = 'r';
    restoreBtn.onclick = function(){
      cancelCapture();
      bindings = getDefaultBindings();
      Object.keys(keyButtons).forEach(function(id){
        showBinding(id);
      });
      showMessage('Defaults restored. Choose Save to keep them.', false);
    };
    popup.appendChild(restoreBtn);
  }

  var closeBtn = createButton("Close");
  closeBtn.onclick = function(){
    closePopups();
  };
  popup.appendChild(closeBtn);

  popup.addEventListener('keydown', function(e){
    if(e.key === "Escape"){
      e.preventDefault();
      e.stopPropagation();
      closePopups();
    }
  });

  document.body.appendChild(popup);
  closeBtn.focus();
  popup.scrollTop = 0;

  function appendSection(title, defs){
    if(defs.length === 0)
      return;

    appendHeading(title);
    var table = newTable();

    defs.forEach(function(def){
      table.appendChild(shortcutRow(def));

      if(onSave)
        table.appendChild(messageRowFor(def));
    });

    popup.appendChild(table);
  }

  function appendStaticSection(title, rows){
    appendHeading(title);
    var table = newTable();

    rows.forEach(function(row){
      var keys = document.createElement('td');
      keys.innerText = row[1];
      table.appendChild(labelledRow(row[0], keys));
    });

    popup.appendChild(table);
  }

  function appendHeading(text){
    var heading = document.createElement('h2');
    heading.innerText = text;
    popup.appendChild(heading);
  }

  function newTable(){
    var table = document.createElement('table');
    table.classList.add('shortcuts-table');
    return table;
  }

  function labelledRow(label, keysCell){
    var row = document.createElement('tr');

    var labelCell = document.createElement('td');
    labelCell.innerText = label;
    row.appendChild(labelCell);
    row.appendChild(keysCell);

    return row;
  }

  //Without somewhere to save to, a shortcut is printed rather than offered - the same table either
  //way, so the list reads identically whether or not it can be changed.
  function shortcutRow(def){
    var keysCell = document.createElement('td');

    if(onSave){
      var button = createButton(formatBinding(bindings[def.id], isMac));
      button.classList.add('shortcut-key');
      button.title = 'Change the shortcut for ' + def.label;
      button.onclick = function(){
        beginCapture(def, button);
      };
      button.addEventListener('blur', function(){
        if(capturing != null && capturing.button === button)
          cancelCapture();
      });

      keyButtons[def.id] = button;
      keysCell.appendChild(button);
    }
    else{
      keysCell.innerText = formatBinding(bindings[def.id], isMac);
    }

    return labelledRow(def.label, keysCell);
  }

  //An empty row per shortcut, rather than one built when there is something to show: inserting a
  //row into the table mid-rebind would move every row below it, including the one the writer is
  //looking at.
  function messageRowFor(def){
    var row = document.createElement('tr');
    row.classList.add('shortcut-message-row');
    row.hidden = true;

    var cell = document.createElement('td');
    cell.colSpan = 2;
    cell.classList.add('shortcut-message');
    row.appendChild(cell);

    messageRows[def.id] = row;
    return row;
  }

  function beginCapture(def, button){
    cancelCapture();

    capturing = { def: def, button: button, previousText: button.textContent };
    button.textContent = 'Press keys...';
    button.classList.add('capturing');
    clearMessages();

    //On `document`, in the capture phase, so it runs before anything else in the app can act on the
    //keypress: the popup's own Escape handler, keybindings.js's listeners, and Quill's. A writer
    //rebinding a shortcut is pressing keys that still mean something everywhere else, and none of
    //that may happen while the app is asking which keys they want.
    document.addEventListener('keydown', handleCaptureKeydown, true);
  }

  function handleCaptureKeydown(e){
    e.preventDefault();
    e.stopImmediatePropagation();

    var pressed = bindingFromEvent(e);

    if(pressed == null){
      //Two different nulls. A modifier held on its own is the writer part-way through a combination,
      //and waiting in silence is the right answer. A key this app cannot name is not - saying
      //nothing is what left a writer on an unusual keyboard with no way to tell a key that had been
      //refused from one the app had not noticed at all, so the readout says what did arrive.
      if(!isModifierKeyEvent(e)){
        showMessage('That key cannot be used in a shortcut. ' + describeKeyEvent(e),
          true, capturing.def.id);
      }

      return;
    }

    if(pressed.key === 'Escape'){
      cancelCapture();
      return;
    }

    if(pressed.key === 'Backspace' || pressed.key === 'Delete'){
      assign(null);
      return;
    }

    var result = validateBinding(pressed, capturing.def.id, bindings);
    if(!result.valid){
      //Still capturing: a refused combination leaves the writer where they were, free to press
      //another rather than having to start the rebind again.
      showMessage(result.message, true, capturing.def.id);
      return;
    }

    assign(pressed);
  }

  function assign(binding){
    var id = capturing.def.id;
    var label = capturing.def.label;

    bindings[id] = binding;
    endCapture();
    showBinding(id);

    showMessage(binding == null
      ? label + ' is now unassigned. Choose Save to keep the change.'
      : label + ' is now ' + formatBinding(binding, isMac) + '. Choose Save to keep the change.',
      false, id);
  }

  function cancelCapture(){
    if(capturing == null)
      return;

    var button = capturing.button;
    var previousText = capturing.previousText;

    endCapture();
    button.textContent = previousText;
  }

  function endCapture(){
    if(capturing == null)
      return;

    document.removeEventListener('keydown', handleCaptureKeydown, true);
    capturing.button.classList.remove('capturing');
    capturing = null;
  }

  function showBinding(id){
    if(keyButtons[id])
      keyButtons[id].textContent = formatBinding(bindings[id], isMac);
  }

  //Shown under `actionId`'s own row where there is one - which is every message about a particular
  //shortcut - and under the buttons at the end otherwise. Only ever one at a time, so a message
  //cannot be left behind under a shortcut a writer has moved on from.
  function showMessage(text, isWarning, actionId){
    clearMessages();

    if(!text)
      return;

    var row = actionId ? messageRows[actionId] : null;

    if(row == null){
      listMessage.innerText = text;
      listMessage.classList.toggle('warning-text', Boolean(isWarning));
      return;
    }

    row.hidden = false;
    row.cells[0].innerText = text;
    row.cells[0].classList.toggle('warning-text', Boolean(isWarning));
    shownMessageId = actionId;
  }

  function clearMessages(){
    listMessage.innerText = '';
    listMessage.classList.remove('warning-text');

    var row = shownMessageId ? messageRows[shownMessageId] : null;
    shownMessageId = null;

    if(row == null)
      return;

    row.hidden = true;
    row.cells[0].innerText = '';
    row.cells[0].classList.remove('warning-text');
  }
}

//The popup edits its own copy, so a rebind abandoned with Close leaves the app's live bindings
//exactly as they were.
function copyBindings(bindings){
  var copy = {};

  Object.keys(bindings).forEach(function(id){
    copy[id] = bindings[id] == null ? null : Object.assign({}, bindings[id]);
  });

  return copy;
}

module.exports = showShortcutsHelp;
