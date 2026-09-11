const { logError } = require('./error-log');

function focusEditor(){
    document.getElementById('editor-container').getElementsByClassName('ql-editor')[0].focus();
}

function closePopups(){
    removeElementsByClass('popup');
    disableSearchView();
    focusEditor();
}
  
function closePopupDialogs(){
    removeElementsByClass('popup-dialog');
    var popups = document.getElementsByClassName('popup');
    if(popups.length > 0){
        popups[0].focus();
    }
    else {
        focusEditor();
    }
} 

function removeElementsByClass(className){
    try{
      var elements = document.getElementsByClassName(className);
      while(elements.length > 0){
          elements[0].onblur = null;
          elements[0].parentNode.removeChild(elements[0]);
      }
    }
    catch(err){
      logError(err);
    }
  }
  
  function convertFilepath(fpath){
    //Convert Windows filepaths to maintain linux/windows compatibility
    try{
      return fpath.replaceAll('\\', '/');
    }
    catch(err){
      logError(err);
      return fpath;
    }
  }
  

//Every call site today passes a hardcoded string literal, never anything derived from a file, the
//network, or user input - but setting innerHTML from a string parameter is exactly the shape that
//turns into an injection point the moment that stops being true, and with nodeIntegration true
//(see src/index.js) that means arbitrary code execution, not just a defaced popup. A handful of
//labels mark one letter for the OS-level accessKey shortcut with a fixed
//<span class='access-key'>X</span> pattern - ACCESS_KEY_LABEL recognises exactly that shape and
//builds it as real DOM nodes, so nothing here ever needs to parse or trust arbitrary markup.
const ACCESS_KEY_LABEL = /^(.*)<span class='access-key'>(.)<\/span>(.*)$/;

function createButton(text){
    var btn = document.createElement("button");
    btn.type = "button";

    var accessKeyMatch = ACCESS_KEY_LABEL.exec(text);
    if(accessKeyMatch){
      var before = accessKeyMatch[1];
      var letter = accessKeyMatch[2];
      var after = accessKeyMatch[3];

      if(before)
        btn.appendChild(document.createTextNode(before));

      var accessKeySpan = document.createElement('span');
      accessKeySpan.className = 'access-key';
      accessKeySpan.textContent = letter;
      btn.appendChild(accessKeySpan);

      if(after)
        btn.appendChild(document.createTextNode(after));
    }
    else{
      btn.textContent = text;
    }

    return btn;
}
  

//Marks a popup as a dialog for assistive technology, and names it. Every popup in the app is a
//plain <div class="popup"> built by hand, which a screen reader announces as nothing at all: no
//role, so it is not a dialog; no name, so a reader landing inside it has no idea what just opened.
//This gives it both, from the heading the view already draws - the same text a sighted writer
//reads - so there is one title, not two that can drift.
//
//`heading` is the h1 (or h3, for the file dialog) the popup shows; it is given an id if it has
//none, and the popup points at it with aria-labelledby. A string names a popup that has no
//heading of its own (the corkboard, the shortcut helper). `role` defaults to 'dialog';
//'alertdialog' is for the confirmations and error reports that interrupt with a question or a
//failure, which readers announce more insistently.
//
//aria-modal is set because every popup here behaves that way: closePopups() tears down whatever
//is open, focus is moved into it on open, and nothing behind it is meant to be reachable while it
//is up. It tells a reader to stop exploring the page behind the dialog rather than to keep
//reading through it.
var dialogTitleCount = 0;

function describeDialog(popup, heading, role){
    popup.setAttribute('role', role || 'dialog');
    popup.setAttribute('aria-modal', 'true');

    if(typeof heading === 'string'){
      popup.setAttribute('aria-label', heading);
      return popup;
    }

    if(!heading.id){
      dialogTitleCount++;
      heading.id = 'dialog-title-' + dialogTitleCount;
    }
    popup.setAttribute('aria-labelledby', heading.id);

    return popup;
}

function generateRow(elOne, elTwo){
    var row = document.createElement('tr');
    var cellOne = document.createElement('td');
    cellOne.appendChild(elOne);
    row.appendChild(cellOne);
    var cellTwo = document.createElement('td');
    cellTwo.appendChild(elTwo);
    row.appendChild(cellTwo);
    return row;
  }
  
  function removeOptions(selectElement) {
    try{
      var i, L = selectElement.options.length - 1;
      for(i = L; i >= 0; i--) {
         selectElement.remove(i);
      }
    }
    catch(err){
      logError(err)
    }
  }

  function enableSearchView(){
    document.getElementById("chapter-list-sidebar").classList.add("sidebar-search-view");
    document.getElementById("project-notes").classList.add("sidebar-search-view");
    document.getElementById("writing-field").classList.add("writing-field-search-view");
  }
  
  function disableSearchView(){
    document.getElementById("chapter-list-sidebar").classList.remove("sidebar-search-view");
    document.getElementById("project-notes").classList.remove("sidebar-search-view");
    document.getElementById("writing-field").classList.remove("writing-field-search-view");
  }

  function sanitizeFilenameWithExt(str){
    try{
      var dotIndex = str.lastIndexOf('.');
      if(dotIndex === -1){
        return sanitizeFilename(str);
      }
      var base = str.slice(0, dotIndex);
      var ext = str.slice(dotIndex + 1);
      return sanitizeFilename(base) + '.' + ext;
    }
    catch(err){
      logError(err);
      return str;
    }
  }

  function sanitizeFilename(str){
    try{
      const lengthLimit = 100;
      var illegalRe = /[\/\?<>\\:\*\|":]/g;
      var controlRe = /[\x00-\x1f\x80-\x9f]/g;
      var reservedRe = /^\.+$/;
      var windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

      var sanitized = str.replace(illegalRe,'').replace(controlRe,'').replace(reservedRe,'').replace(windowsReservedRe, '');

      if(sanitized.length > lengthLimit)
        sanitized = sanitized.slice(0,lengthLimit);

      return sanitized;
    }
    catch(err){
      logError(err);
      return str;
    }
  }

  module.exports = {
    closePopups,
    closePopupDialogs,
    removeElementsByClass,
    convertFilepath,
    createButton,
    describeDialog,
    generateRow,
    removeOptions,
    enableSearchView,
    disableSearchView,
    sanitizeFilename,
    sanitizeFilenameWithExt
  }