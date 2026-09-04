function typewriterScroll(editorQuill){
  if(editorQuill.hasFocus()){
    var selection = editorQuill.getSelection();
    if(!selection) return;
    var viewTop = editorQuill.getBounds(selection.index).top;
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