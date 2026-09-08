//Anchor and focus are the only record of which end of a selection the caret is on: Quill's Range
//is {index, length} and says nothing about direction. Reported backwards for a selection whose
//focus sits before its anchor - Shift+Up, Shift+Home, a drag started at the bottom.
function selectionIsBackwards(domSelection){
  if(domSelection.anchorNode == null || domSelection.focusNode == null)
    return false;

  if(domSelection.anchorNode === domSelection.focusNode)
    return domSelection.focusOffset < domSelection.anchorOffset;

  var position = domSelection.anchorNode.compareDocumentPosition(domSelection.focusNode);
  return (position & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
}

//The end of the selection the caret is actually sitting on, which is the end that has to stay on
//screen. Scrolling to selection.index instead pins the view to wherever the selection *began*, so
//holding Shift+Down would hold the view there while the caret ran off the bottom of the screen.
function caretIndexOf(selection){
  if(!selection.length)
    return selection.index;

  var domSelection = document.getSelection();

  if(domSelection && selectionIsBackwards(domSelection))
    return selection.index;

  return selection.index + selection.length;
}

function typewriterScroll(editorQuill){
  if(editorQuill.hasFocus()){
    var selection = editorQuill.getSelection();
    if(!selection) return;
    var viewTop = editorQuill.getBounds(caretIndexOf(selection)).top;
    var toScroll = viewTop - editorQuill.getBounds(0).top;
    var editorDiv = document.querySelector('.ql-editor');
    var heightOffset = Math.floor(editorDiv.clientHeight * 0.75);
    editorDiv.scrollTop = toScroll - heightOffset;
  }
}

function enableTypewriterMode(editorQuill){
  editorQuill.__typewriterHandler = function(){
    typewriterScroll(editorQuill);
  };
  editorQuill.on('editor-change', editorQuill.__typewriterHandler);
}

function disableTypewriterMode(editorQuill){
  if(editorQuill.__typewriterHandler){
    editorQuill.off('editor-change', editorQuill.__typewriterHandler);
    delete editorQuill.__typewriterHandler;
  }
}

module.exports = {
  enableTypewriterMode,
  disableTypewriterMode
};
