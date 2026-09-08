const { removeElementsByClass } = require('../controllers/utils');
const chapterList = require('../controllers/chapter-list');

//The sidebar shows the project's three lists as one run of rows, each carrying its combined index
//in data-chap-index. That attribute is the boundary where a locator has to flatten back into a
//single number, and it is what the handlers below hand back to the caller.
//
//Chapters has no empty state to mark - its header is always shown - so it is the one section
//without a headerId.
const SECTIONS = [
  { list: 'chapters',  rowsId: 'chapter-list' },
  { list: 'reference', rowsId: 'reference-list', headerId: 'reference-header' },
  { list: 'trash',     rowsId: 'trash-list',     headerId: 'trash-header' }
];

//handlers: { onSelect(combinedIndex), onRename(combinedIndex) }
function renderChapterList(project, handlers){
  //A rename box left over from before this render started has to go before clearChildren() below
  //tears down the row it lives in. Its own onblur handler also calls removeElementsByClass() - if
  //that box still has focus (the common case: a rename in progress when a new project is opened,
  //say), removing its row fires that blur synchronously, reentering removeElementsByClass() from
  //inside clearChildren()'s own removal loop and removing a node it still holds a reference to,
  //which throws "the node to be removed is no longer a child of this node". Dismissing the box
  //explicitly first (which also detaches its onblur, same as renameChapterInList() already does
  //when starting a new rename) means clearChildren() never has a focused, blur-wired element left
  //to trip over.
  removeElementsByClass('name-box');

  //Only the chapters list scrolls itself into view, which is how it has always behaved: stepping
  //into a reference or trash row with the keyboard can still leave it below the fold.
  var rowToReveal = null;

  SECTIONS.forEach(function(section){
    var chapters = chapterList.listOf(project, section.list);
    var rows = document.getElementById(section.rowsId);

    clearChildren(rows);

    chapters.forEach(function(chap, indexInList){
      var combinedIndex = chapterList.toCombinedIndex(project, { list: section.list, index: indexInList });
      var row = buildRow(chap, combinedIndex, handlers);

      rows.appendChild(row);

      if(combinedIndex == project.activeChapterIndex){
        row.classList.add("activeChapter");
        if(section.list == 'chapters')
          rowToReveal = row;
      }
    });

    if(section.headerId)
      markHeaderEmpty(document.getElementById(section.headerId), chapters.length == 0);
  });

  //Deliberately after the whole list is rebuilt, not as the active row is appended. Every render
  //clears all three lists and re-appends every row, so mid-loop the active row is the *last* row in
  //the document - it measures as sitting at the bottom of the view no matter which chapter it is,
  //reads as already visible, and no scroll happens. The rows below it are then appended and carry
  //its real position off the top of the sidebar. That is why stepping up through a long book left
  //the list frozen while the bold title walked off the top.
  if(rowToReveal)
    scrollIntoViewIfNeeded(document.getElementById('chapter-list-sidebar'), rowToReveal);
}

function buildRow(chap, combinedIndex, handlers){
  var row = document.createElement("li");

  row.textContent = (chap.title != '' ? chap.title : '(untitled)') + (chap.hasUnsavedChanges == true ? "*" : "");
  row.dataset.chapIndex = combinedIndex;
  row.onclick = function(){
    handlers.onSelect(this.dataset.chapIndex);
  };
  row.ondblclick = function(){
    handlers.onRename(this.dataset.chapIndex);
  };

  return row;
}

//row.offsetTop is measured against the nearest *positioned* ancestor, and nothing between a row
//and <body> has position set - so it lands relative to <body>, not the scrollable sidebar, and is
//useless for deciding how far to scroll. getBoundingClientRect() is always viewport-relative
//regardless of positioning, so comparing rects tells us exactly how far out of view the row is (in
//either direction) and by how much to move scrollTop to bring it back in - without disturbing the
//scroll position at all when the row is already visible.
function scrollIntoViewIfNeeded(container, row){
  var containerRect = container.getBoundingClientRect();
  var rowRect = row.getBoundingClientRect();

  if(rowRect.top < containerRect.top)
    container.scrollTop -= containerRect.top - rowRect.top;
  else if(rowRect.bottom > containerRect.bottom)
    container.scrollTop += rowRect.bottom - containerRect.bottom;
}

function markHeaderEmpty(header, isEmpty){
  if(isEmpty)
    header.classList.add('trash-header-empty');
  else
    header.classList.remove('trash-header-empty');
}

function clearChildren(element){
  while(element.firstChild){
    element.removeChild(element.firstChild);
  }
}

//Turns the named row into a text box for renaming in place. The box starts empty rather than
//pre-filled with the current title - typing replaces the name outright, which is what the
//double-click-to-rename flow has always done.
//handlers: { onCommit(newTitle), onCancel(), onDismiss() }
function renameChapterInList(combinedIndex, handlers){
  var row = document.querySelector("[data-chap-index='" + combinedIndex + "']");
  if(!row)
    return null;

  //Clears any rename already in progress. removeElementsByClass() detaches the blur handler before
  //removing the box, so replacing one rename with another does not fire onDismiss on the way.
  removeElementsByClass('name-box');

  var nameBox = document.createElement("input");
  nameBox.type = "text";
  nameBox.classList.add("name-box");

  nameBox.addEventListener("keydown", function(e){
    if(e.key === "Enter" || e.key === "Tab"){
      e.preventDefault();
      e.stopPropagation();
      var newTitle = nameBox.value;
      removeElementsByClass('name-box');
      handlers.onCommit(newTitle);
    }
    else if (e.key === "Escape"){
      removeElementsByClass('name-box');
      handlers.onCancel();
    }
  });

  //Losing focus abandons the rename too, but without pulling focus back to the editor the way
  //Escape does - whatever the reader clicked on has its own claim to it.
  nameBox.onblur = function(){
    removeElementsByClass('name-box');
    handlers.onDismiss();
  };

  row.firstChild.remove();
  row.appendChild(nameBox);
  nameBox.focus();

  return nameBox;
}

module.exports = {
  renderChapterList,
  renameChapterInList,
  scrollIntoViewIfNeeded
};
