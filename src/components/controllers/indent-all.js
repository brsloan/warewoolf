const { getTempQuill } = require('./quill-utils');

function indentAllParasInAllChaps(project){
    project.chapters.forEach(function(chap){
        chap.contents = indentAllParas(chap.getContentsOrFile());
        chap.hasUnsavedChanges = true;
    });
}

function indentAllParas(delt){
    var tempQuill = getTempQuill();
    tempQuill.setContents(delt);
    var lines = tempQuill.getLines();
    lines.forEach(function(line){
        if(line.statics.blotName != 'header' && line.domNode.innerText[0] != '\t'){
            var insertIndex = tempQuill.getIndex(line);
            tempQuill.insertText(insertIndex, '\t');
        }
    });
    return tempQuill.getContents();
}

module.exports = {
    indentAllParas,
    indentAllParasInAllChaps
}