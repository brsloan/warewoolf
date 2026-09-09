const { getTempQuill } = require('./quill-utils');

//The "Do Not Indent After" boxes, in the order the popup shows them. Kept here rather than in the
//view so the ids the popup builds its checkboxes from and the ids this module reads back are one
//list, and adding a rule is one edit.
const DO_NOT_INDENT_AFTER = [
    { id: 'newChapter', label: 'New Chapter' },
    { id: 'headings', label: 'Headings' },
    { id: 'blankLines', label: 'Blank Lines' },
    { id: 'blockquotes', label: 'Blockquotes' },
    { id: 'lists', label: 'Lists' }
];

function getDoNotIndentAfterDefs(){
    return DO_NOT_INDENT_AFTER.slice();
}

//Every typographic rule is on by default and blank-line removal is off, matching the popup. A
//caller that passes nothing at all - or an options object missing a key - gets those defaults
//rather than false, so a key that goes missing can never quietly switch a rule off.
function getDefaultOptions(){
    var defaults = { doNotIndentAfter: {}, correctCurrentTabs: true, removeBlankLinesBetweenParagraphs: false };

    DO_NOT_INDENT_AFTER.forEach(function(def){
        defaults.doNotIndentAfter[def.id] = true;
    });

    return defaults;
}

function withDefaults(options){
    var opts = getDefaultOptions();

    if(!options)
        return opts;

    Object.keys(opts).forEach(function(key){
        if(key != 'doNotIndentAfter' && options[key] !== undefined)
            opts[key] = options[key];
    });

    if(options.doNotIndentAfter){
        DO_NOT_INDENT_AFTER.forEach(function(def){
            if(options.doNotIndentAfter[def.id] !== undefined)
                opts.doNotIndentAfter[def.id] = options.doNotIndentAfter[def.id];
        });
    }

    return opts;
}

//Indexed loop rather than forEach because reading a chapter off disk is asynchronous now - see
//center-all-heads.js.
async function tabIndentParasInAllChaps(project, options){
    var anyChanged = false;

    for(let i = 0; i < project.chapters.length; i++){
        let chap = project.chapters[i];
        var result = tabIndentParas(await chap.getContentsOrFile(), options);
        if(result.changed > 0){
            chap.contents = result.delta;
            chap.hasUnsavedChanges = true;
            anyChanged = true;
        }
    }

    if(anyChanged)
        project.hasUnsavedChanges = true;
}

//Blank lines go first, and have to: a paragraph that was separated from the one above it by a blank
//line becomes a paragraph directly following a paragraph, and so takes the tab it now needs. Doing
//it the other way round would decide every indent against a layout that is about to change.
function tabIndentParas(delt, options){
    var opts = withDefaults(options);
    var tempQuill = getTempQuill();
    tempQuill.setContents(delt);
    var changes = 0;

    if(opts.removeBlankLinesBetweenParagraphs)
        changes += removeBlankLinesBetweenParas(tempQuill);

    changes += applyIndents(tempQuill, opts);

    return {
        changed: changes,
        delta: tempQuill.getContents()
    };
}

//One pass, two jobs: a paragraph that should be indented and is not gets a tab, and - when Correct
//Current Tabs is on - a paragraph that should not be indented and is loses the tabs it has. The
//index is re-read from the document on every line rather than taken from a list gathered up front,
//because each insertion or deletion shifts everything after it.
function applyIndents(tempQuill, opts){
    var lines = tempQuill.getLines();
    var changes = 0;

    lines.forEach(function(line, i){
        var previousLine = i > 0 ? lines[i - 1] : null;
        var insertIndex = tempQuill.getIndex(line);
        var leadingTabs = countLeadingTabs(tempQuill, line, insertIndex);

        if(shouldBeIndented(tempQuill, line, previousLine, opts.doNotIndentAfter)){
            if(leadingTabs == 0){
                tempQuill.insertText(insertIndex, '\t');
                changes++;
            }
        }
        else if(opts.correctCurrentTabs && leadingTabs > 0 && isProse(line)){
            tempQuill.deleteText(insertIndex, leadingTabs);
            changes++;
        }
    });

    return changes;
}

//Headings are not indented, list items carry their own indenting, blockquotes get their own marker
//at export time (a tab or a "> ", never both), and a blank line has nothing to indent: tabbing it
//just leaves a stray tab in the middle of the chapter. None of that is optional, so those blot
//types are ruled out before any checkbox is consulted - the boxes say what a paragraph may not be
//indented AFTER, not what may be indented.
//
//What the boxes do decide is the typographic rule the tool is named for. The indent marks the break
//between one paragraph and the next, so a paragraph with nothing above it to be separated from -
//the first of a chapter, the first after a heading, a blank line, a quotation or a list - is set
//flush at the margin. Unticking a box puts those paragraphs back in the indent.
function shouldBeIndented(tempQuill, line, previousLine, doNotIndentAfter){
    if(!isProse(line) || isBlank(tempQuill, line))
        return false;

    if(!previousLine)
        return !doNotIndentAfter.newChapter;

    var previousBlot = previousLine.statics.blotName;

    if(previousBlot == 'header')
        return !doNotIndentAfter.headings;

    if(previousBlot == 'list-item')
        return !doNotIndentAfter.lists;

    if(previousBlot == 'blockquote')
        return !doNotIndentAfter.blockquotes;

    if(isBlank(tempQuill, previousLine))
        return !doNotIndentAfter.blankLines;

    return true;
}

//A blog separates its paragraphs with a blank line; a book separates them with an indent. Dropping
//a lone blank line and condensing a longer run down to one converts the first into the second,
//while leaving the wider gap that marks a scene break as a gap.
//
//Only a run with an ordinary paragraph on both sides is touched. The blank line under a heading,
//the one above a block quotation, and anything at the very top or bottom of a chapter are layout
//rather than blog styling, and a writer asking for book-style paragraphs is not asking to have
//their chapter openings closed up.
function removeBlankLinesBetweenParas(tempQuill){
    var lines = tempQuill.getLines();
    var indices = lines.map(function(line){ return tempQuill.getIndex(line); });
    var deletions = [];
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
            //A run of two or more keeps one line; a lone blank line goes entirely.
            var keep = (i - runStart) > 1 ? 1 : 0;
            for(let j = runStart + keep; j < i; j++)
                deletions.push(indices[j]);
        }
    }

    //Deleted from the end backwards, so the indices gathered above are still right when each
    //deletion runs. Removing a blank line means removing its newline: what is left of it merges
    //into the line below, which is the gap closing up.
    deletions.reverse().forEach(function(index){
        tempQuill.deleteText(index, 1);
    });

    return deletions.length;
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

function isProse(line){
    var blotName = line.statics.blotName;
    return blotName != 'header' && blotName != 'list-item' && blotName != 'blockquote';
}

function isPlainParagraph(tempQuill, line){
    return isProse(line) && !isBlank(tempQuill, line);
}

//line.length() counts the line's newline as well, so this reads the line and no further; the count
//stops at the first character that is not a tab in any case.
function countLeadingTabs(tempQuill, line, insertIndex){
    var text = tempQuill.getText(insertIndex, line.length());
    var tabs = 0;

    while(tabs < text.length && text[tabs] == '\t')
        tabs++;

    return tabs;
}

module.exports = {
    tabIndentParas,
    tabIndentParasInAllChaps,
    getDoNotIndentAfterDefs,
    getDefaultOptions
}
