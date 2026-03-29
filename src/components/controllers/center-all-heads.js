const { getTempQuill } = require('./quill-utils');

function centerAllHeadingsInAllChaps(project){
    project.chapters.forEach(function(chap){
        chap.contents = centerHeads(chap.getContentsOrFile());
        chap.hasUnsavedChanges = true;
    });
}

function centerHeads(delt){
    var tempQuill = getTempQuill();
    tempQuill.setContents(delt);
    var lines = tempQuill.getLines();
    lines.forEach(function(line){
        if(line.statics.blotName == 'header'){
            var insertIndex = tempQuill.getIndex(line);
            tempQuill.formatLine(insertIndex, 1, 'align', 'center');
        }
    });
    return tempQuill.getContents();
}

module.exports = {
    centerHeads,
    centerAllHeadingsInAllChaps
}