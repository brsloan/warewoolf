const { getTempQuill } = require('./quill-utils');

//Indexed loop rather than forEach because reading a chapter off disk is asynchronous now - see
//center-all-heads.js.
async function indentAllParasInAllChaps(project){
    var anyChanged = false;

    for(let i = 0; i < project.chapters.length; i++){
        let chap = project.chapters[i];
        var result = indentAllParas(await chap.getContentsOrFile());
        if(result.changed > 0){
            chap.contents = result.delta;
            chap.hasUnsavedChanges = true;
            anyChanged = true;
        }
    }

    if(anyChanged)
        project.hasUnsavedChanges = true;
}

function indentAllParas(delt){
    var tempQuill = getTempQuill();
    tempQuill.setContents(delt);
    var lines = tempQuill.getLines();
    var changes = 0;

    lines.forEach(function(line){
        var insertIndex = tempQuill.getIndex(line);
        if(needsIndenting(tempQuill, line, insertIndex)){
            tempQuill.insertText(insertIndex, '\t');
            changes++;
        }
    });

    return {
        changed: changes,
        delta: tempQuill.getContents()
    };
}

//Headings are not indented, list items carry their own indenting, blockquotes get their own marker
//at export time (a tab or a "> ", never both), and a blank line has nothing to indent: tabbing it
//just leaves a stray tab in the middle of the chapter. Everything else is a paragraph of prose. The
//first character is read back through Quill rather than from the line's DOM node, which is not
//rendered here and reports an empty string for a blank line either way.
function needsIndenting(tempQuill, line, insertIndex){
    var blotName = line.statics.blotName;

    if(blotName == 'header' || blotName == 'list-item' || blotName == 'blockquote')
        return false;

    var firstCharacter = tempQuill.getText(insertIndex, 1);

    return firstCharacter != '\t' && firstCharacter != '\n' && firstCharacter != '';
}

module.exports = {
    indentAllParas,
    indentAllParasInAllChaps
}