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
        if(index == startingIndex)
            index = getNextIndex(str, totalText, startingIndex + str.length, wholeWordOnly);

        if(index > -1)
            editorQuill.setSelection(index, str.length);
        else{
            //No more results. Either start again at top of current chapter or move to next chapter.
            if(searchAllChapters){
                var startingChapIndex = project.activeChapterIndex;
                var result = -1;
                while(result < 0){
                    if(project.activeChapterIndex < project.chapters.length - 1){
                        displayChapterByIndex(project.activeChapterIndex + 1);
                        result = find(editorQuill, project, str, caseSensitive, 0);
                        index = result;
                    }
                    else {
                        //If search did not begin at first chapter, loop back to first chapter for one more go.
                        if(startingChapIndex != 0){
                            startingChapIndex = 0;
                            displayChapterByIndex(0);
                            result = find(editorQuill, project, str, caseSensitive, 0);
                            index = result;
                        }
                        else {
                            result = 1;
                        }
                    }
                }
            } else {
                if(startingIndex != 0){
                    index =  find(editorQuill, project, str, caseSensitive, 0);
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
        const regex = new RegExp(`\\b${str}\\b`, 'g');
        regex.lastIndex = startingIndex;
        const match = regex.exec(text);
        if(match)
            index = match.index;
    }
    return index;
}

function replace(editorQuill, newStr){
    var selectedRange = editorQuill.getSelection(true);
    if(selectedRange.length > 0){
        editorQuill.deleteText(selectedRange.index, selectedRange.length, 'user');
        editorQuill.insertText(selectedRange.index, newStr, 'user');
    }
}

function replaceAllInAllChapters(project, oldStr, newStr, caseSensitive, wholeWordOnly = false){
  var numReplaced = 0;

  project.chapters.forEach(function(chap){
    var changed = replaceAllInChapter(oldStr, newStr, caseSensitive, chap, wholeWordOnly);
    numReplaced += changed;
  });

  project.reference.forEach(function(chap){
    var changed = replaceAllInChapter(oldStr, newStr, caseSensitive, chap, wholeWordOnly);
    numReplaced += changed;
  });

  return numReplaced;
}

function replaceAllInChapter(oldStr, newStr, caseSensitive, chap, wholeWordOnly = false){
  var result = replaceAllInDelta(oldStr, newStr, caseSensitive, chap.contents ? chap.contents : chap.getFile(), wholeWordOnly);
  if(result.changed > 0){
    chap.contents = result.delta;
    chap.hasUnsavedChanges = true;
  }
  return result.changed;
}

function replaceAllInDelta(oldStr, newStr, caseSensitive, delt, wholeWordOnly = false){
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
    replace,
    replaceAllInAllChapters,
    replaceAllInChapter,
    replaceAllInDelta
}