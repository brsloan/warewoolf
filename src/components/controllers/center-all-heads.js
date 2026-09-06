const { getTempQuill } = require('./quill-utils');

//A chapter's text now comes off disk through the platform facade, so reading it is asynchronous -
//hence the indexed loop rather than forEach, which would fire every read at once and return before
//any of them landed.
async function centerAllHeadingsInAllChaps(project){
    var anyChanged = false;

    for(let i = 0; i < project.chapters.length; i++){
        let chap = project.chapters[i];
        var result = centerHeads(await chap.getContentsOrFile());
        if(result.changed > 0){
            chap.contents = result.delta;
            chap.hasUnsavedChanges = true;
            anyChanged = true;
        }
    }

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