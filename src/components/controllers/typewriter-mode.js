function typewriterScroll(editorQuill){
  if(editorQuill.hasFocus()){
    var viewTop = editorQuill.getBounds(editorQuill.getSelection().index).top;
    var toScroll = viewTop - editorQuill.getBounds(0).top;
    var editorDiv = document.querySelector('.ql-editor');
    var heightOffset = Math.floor(editorDiv.clientHeight * 0.75);
    editorDiv.scrollTop = toScroll - heightOffset;
  }
}

function enableTypewriterMode(editorQuill){
  editorQuill.on('editor-change', function(){
    typewriterScroll(editorQuill);
  });
}

function disableTypewriterMode(editorQuill){
  editorQuill.off('editor-change', function(){
    typewriterScroll(editorQuill);
  });
}

module.exports = {
  enableTypewriterMode,
  disableTypewriterMode
};