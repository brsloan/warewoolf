const { getTempQuill } = require('./quill-utils');

function centerAllHeadingsInAllChaps(project){
    var anyChanged = false;

    project.chapters.forEach(function(chap){
        var result = centerHeads(chap.getContentsOrFile());
        if(result.changed > 0){
            chap.contents = result.delta;
            chap.hasUnsavedChanges = true;
            anyChanged = true;
        }
    });

    if(anyChanged)
        project.hasUnsavedChanges = true;
}

function centerHeads(delt){
    var tempQuill = getTempQuill();
    tempQuill.setContents(delt);
    var lines = tempQuill.getLines();
    var changes = 0;

    lines.forEach(function(line){
        if(line.statics.blotName == 'header'){
            var insertIndex = tempQuill.getIndex(line);
            if(tempQuill.getFormat(insertIndex, 1).align != 'center'){
                tempQuill.formatLine(insertIndex, 1, 'align', 'center');
                changes++;
            }
        }
    });

    return {
        changed: changes,
        delta: tempQuill.getContents()
    };
}

module.exports = {
    centerHeads,
    centerAllHeadingsInAllChaps
}