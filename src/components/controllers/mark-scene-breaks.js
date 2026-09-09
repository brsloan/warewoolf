const { getTempQuill } = require('./quill-utils');

//What standard manuscript format puts in the gap between two scenes: a centered hash on the blank
//line that separates them, so a reader (or a typesetter) can tell a deliberate scene break from a
//page break that happened to fall there.
const SCENE_BREAK_MARK = '#';

//A compile/export-time transform, not an edit: it is applied to a copy of the chapter on its way
//into the output file, so the writer's own chapters keep their blank lines exactly as typed. That
//is the difference between this and the Tools menu's transforms (center-all-heads.js,
//tab-indent-paragraphs.js), which rewrite the manuscript itself.
//
//Only a blank line with an ordinary paragraph on both sides is marked. That is what rules out the
//two cases a hash would be plainly wrong in: the blank line under a chapter heading, which is
//layout rather than a scene break, and the stray blank lines writers leave at the end of a chapter,
//which separate the text from nothing at all. A blank line beside a heading, a list, a quotation or
//a footnote body is left alone for the same reason - the gap is doing a job of its own there.
//
//Every blank line in a qualifying gap is marked, not just the first: "a centered # on every blank
//line between paragraphs" is the rule, so a writer who separates scenes with two blank lines gets
//two marks and can see that their spacing, rather than this option, is what wants tidying. (Tools >
//Tab-Indent Paragraphs' "Remove Blank Lines Between Paragraphs" is what condenses those runs.)
function markSceneBreaks(delt){
    var tempQuill = getTempQuill();
    tempQuill.setContents(delt);

    var lines = tempQuill.getLines();
    //Read before anything is inserted, since every insertion below shifts the indices after it.
    var indices = lines.map(function(line){ return tempQuill.getIndex(line); });
    var toMark = [];
    var i = 0;

    while(i < lines.length){
        if(!isBlank(tempQuill, lines[i])){
            i++;
            continue;
        }

        var runStart = i;
        while(i < lines.length && isBlank(tempQuill, lines[i]))
            i++;

        if(runStart > 0 && i < lines.length && isPlainParagraph(tempQuill, lines[runStart - 1]) && isPlainParagraph(tempQuill, lines[i])){
            for(let j = runStart; j < i; j++)
                toMark.push(indices[j]);
        }
    }

    //Marked from the end backwards, so the indices gathered above are still right when each
    //insertion runs.
    toMark.reverse().forEach(function(index){
        tempQuill.insertText(index, SCENE_BREAK_MARK);
        tempQuill.formatLine(index, 1, 'align', 'center');
    });

    return tempQuill.getContents();
}

//The first character is read back through Quill rather than from the line's DOM node, which is not
//rendered here and reports an empty string for a blank line either way.
function firstCharacterOf(tempQuill, line){
    return tempQuill.getText(tempQuill.getIndex(line), 1);
}

function isBlank(tempQuill, line){
    var firstCharacter = firstCharacterOf(tempQuill, line);
    return firstCharacter == '\n' || firstCharacter == '';
}

//A footnote body is an attribute on an ordinary block rather than a blot of its own (see
//blots/footnotes.js), so it has to be ruled out by its format where the others are ruled out by
//their blot name. Without it, the blank line a writer leaves between two notes at the foot of a
//chapter would be marked as a scene break in the middle of the notes.
function isProse(tempQuill, line){
    var blotName = line.statics.blotName;

    if(blotName == 'header' || blotName == 'list-item' || blotName == 'blockquote')
        return false;

    return tempQuill.getFormat(tempQuill.getIndex(line), 1).footnoteBody == null;
}

function isPlainParagraph(tempQuill, line){
    return isProse(tempQuill, line) && !isBlank(tempQuill, line);
}

module.exports = {
    markSceneBreaks
}
