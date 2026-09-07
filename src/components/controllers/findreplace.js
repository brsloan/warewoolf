const { getTempQuill } = require('./quill-utils');

function find(editorQuill, project, str, caseSensitive = true, startingIndex, searchAllChapters, displayChapterByIndex, wholeWordOnly = false){
    var index = -1;

    if(str){
        var totalText = editorQuill.getText();

        if(!caseSensitive){
            totalText = totalText.toLowerCase();
            str = str.toLowerCase();
        }

        index = getNextIndex(str, totalText, startingIndex, wholeWordOnly);

        if(index > -1)
            editorQuill.setSelection(index, str.length);
        else{
            //No more results. Either start again at top of current chapter or move to next chapter.
            if(searchAllChapters){
                var startingChapIndex = project.activeChapterIndex;
                var chapIndex = startingChapIndex;

                //Visits every other chapter exactly once, starting with the next one and wrapping
                //around, stopping as soon as a match turns up.
                for(var i = 0; i < project.chapters.length - 1 && index < 0; i++){
                    chapIndex = chapIndex < project.chapters.length - 1 ? chapIndex + 1 : 0;
                    displayChapterByIndex(chapIndex);
                    //searchAllChapters is deliberately false here so the recursive call searches
                    //only the chapter just displayed rather than re-entering this loop.
                    index = find(editorQuill, project, str, caseSensitive, 0, false, displayChapterByIndex, wholeWordOnly);
                }

                //Nothing found anywhere; return to the chapter the search started from instead of
                //leaving the view on whichever chapter the wraparound happened to end on.
                if(index < 0)
                    displayChapterByIndex(startingChapIndex);
            } else {
                if(startingIndex != 0){
                    index =  find(editorQuill, project, str, caseSensitive, 0, false, displayChapterByIndex, wholeWordOnly);
                }

            }
        }
    }
    return index;
}

function findInText(str, text, caseSensitive, startingIndex, wholeWordOnly = false){
    var index = -1;

    if(!caseSensitive){
        text = text.toLowerCase();
        str = str.toLowerCase();
    }

    index = getNextIndex(str, text, startingIndex, wholeWordOnly);
    
    return index;
}

function getNextIndex(str, text, startingIndex, wholeWordOnly){
    var index = -1;
    if(wholeWordOnly == false){
        index = text.indexOf(str, startingIndex);
    }
    else {
        const regex = new RegExp(getWholeWordPattern(str), 'g');
        regex.lastIndex = startingIndex;
        const match = regex.exec(text);
        if(match)
            index = match.index;
    }
    return index;
}

//The search term comes straight from the user, so it must be escaped before going into a
//RegExp or characters like ( and * will either throw or match the wrong thing. \b also only
//marks a boundary between a word and a non-word character, so a term that starts or ends with
//punctuation (--, 'tis) would never match; those sides need a "not preceded/followed by a word
//character" check instead.
function getWholeWordPattern(str){
    var escaped = escapeRegExp(str);
    var openingBoundary = /^\w/.test(str) ? '\\b' : '(?<!\\w)';
    var closingBoundary = /\w$/.test(str) ? '\\b' : '(?!\\w)';

    return openingBoundary + escaped + closingBoundary;
}

function escapeRegExp(string){
    const specialCharacters = /[.*+?^${}()|[\]\\]/g;
    return string.replace(specialCharacters, '\\$&');
}

function replace(editorQuill, newStr){
    var selectedRange = editorQuill.getSelection(true);
    if(selectedRange.length > 0){
        editorQuill.deleteText(selectedRange.index, selectedRange.length, 'user');
        editorQuill.insertText(selectedRange.index, newStr, 'user');
    }
}

//Async because a chapter that is not already in memory has to be read off disk, which now goes
//through the platform facade. replaceAllInDelta below stays pure and synchronous - it is the part
//convert-tabs.js and the tests reuse.
async function replaceAllInAllChapters(project, oldStr, newStr, caseSensitive, wholeWordOnly = false){
  var numReplaced = 0;
  var everyChapter = project.chapters.concat(project.reference);

  for(let i = 0; i < everyChapter.length; i++){
    numReplaced += await replaceAllInChapter(oldStr, newStr, caseSensitive, everyChapter[i], wholeWordOnly);
  }

  if(numReplaced > 0)
    project.hasUnsavedChanges = true;

  return numReplaced;
}

async function replaceAllInChapter(oldStr, newStr, caseSensitive, chap, wholeWordOnly = false){
  var result = replaceAllInDelta(oldStr, newStr, caseSensitive, chap.contents ? chap.contents : await chap.getFile(), wholeWordOnly);
  if(result.changed > 0){
    chap.contents = result.delta;
    chap.hasUnsavedChanges = true;
  }
  return result.changed;
}

function replaceAllInDelta(oldStr, newStr, caseSensitive, delt, wholeWordOnly = false){
    //An empty search term matches at every position without ever advancing, so the loop below would
    //never end. The Find button guards against this already, Replace All did not.
    if(!oldStr)
        return { changed: 0, delta: delt };

    var tempQuill = getTempQuill();
    var counter = 0;

    tempQuill.setContents(delt);
    var text = tempQuill.getText();

    var foundIndex = 0;
    var startingIndex = 0;

    while(foundIndex > -1){
        foundIndex = findInText(oldStr, text, caseSensitive, startingIndex, wholeWordOnly);
        if(foundIndex > -1){
            counter++;
            tempQuill.deleteText(foundIndex, oldStr.length);
            tempQuill.insertText(foundIndex, newStr);
            startingIndex = foundIndex + newStr.length;
            text = tempQuill.getText();
        }
    }

    delt = tempQuill.getContents();

    return {
      changed: counter,
      delta: delt
    };
}

module.exports = {
    find,
    findInText,
    getNextIndex,
    replace,
    replaceAllInAllChapters,
    replaceAllInChapter,
    replaceAllInDelta
}