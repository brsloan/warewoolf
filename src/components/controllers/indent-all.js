const { getTempQuill } = require('./quill-utils');

function indentAllParas(editorQuill){
    var lines = editorQuill.getLines();
    lines.forEach(function(line){
        console.log(line);
        if(line.statics.blotName != 'header' && line.domNode.innerText[0] != '\t'){
            var insertIndex = editorQuill.getIndex(line);
            editorQuill.insertText(insertIndex, '\t', 'user');
        }
    });
}

module.exports = {
    indentAllParas
}