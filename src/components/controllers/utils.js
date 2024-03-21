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
      var converted = fpath.replaceAll('\\', '/');
    }
    catch(err){
      logError(err);
    }
  
    return converted;
  }
  

function createButton(text){
    var btn = document.createElement("button");
    btn.innerHTML = text;
    btn.type = "button";
    return btn;
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
      var parts = str.split('.');
      var ext = parts.pop();
      return sanitizeFilename(parts.join('')) + '.' + ext;
    }
    catch(err){
      logError(err);
    }
  }

  function sanitizeFilename(str){
    try{
      const lengthLimit = 100;
      var illegalRe = /[\/\?<>\\:\*\|":]/g;
      var controlRe = /[\x00-\x1f\x80-\x9f]/g;
      var reservedRe = /^\.+$/;
      var windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

      var sanitized = str.replace(illegalRe,'').replace(controlRe,'').replace(reservedRe,'').replace(windowsReservedRe, '');

      if(sanitized.length > lengthLimit)
        sanitized = sanitized.slice(0,lengthLimit);

      return sanitized;
    }
    catch(err){
      logError(err);
    }
  }

  module.exports = {
    closePopups,
    closePopupDialogs,
    removeElementsByClass,
    convertFilepath,
    createButton,
    generateRow,
    removeOptions,
    enableSearchView,
    disableSearchView,
    sanitizeFilename,
    sanitizeFilenameWithExt
  }