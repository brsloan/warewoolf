function find(str, caseSensitive = true){
    removeHighlights();
    var currentMatch = {
        index: null,
        text:  '0/0'
    };
         
    if(str){
        var totalText = editorQuill.getText();
        var re = new RegExp(str, "gi");
        var match = re.test(totalText);
        if(match){
            var indices = getIndicesOf(str, totalText, caseSensitive);
            var length = str.length;

            indices.forEach(function(index){
                editorQuill.formatText(index, length, {'background': '#f8ff00'}, true);
            });

            var currentIndex = editorQuill.getSelection(true).index;
            var nextIndex = indices.find(ind => ind > currentIndex);
            var nextSelection = nextIndex ? nextIndex : indices[0];

            editorQuill.setSelection(nextSelection);
            currentMatch.index = nextSelection;
            currentMatch.text = (indices.indexOf(nextSelection) + 1) + "/" + indices.length;
        }
    }
    return currentMatch;
}

function replace(ind, oldStr, newStr){
    if(ind != null){
        editorQuill.deleteText(ind, oldStr.length, 'user');
        editorQuill.insertText(ind, newStr, 'user');
    }
}

function replaceAll(oldStr, newStr){
    var matchIndex = '';
    while(matchIndex != null){
        var results = find(oldStr);
        matchIndex = results.index;
        if(matchIndex != null)
            replace(matchIndex, oldStr, newStr);
    }
}

function getIndicesOf(findStr, fullStr, caseSensitive = true){
    var findStrLen = findStr.length;
    var startIndex = 0;
    var index;
    var indices = [];
    if(!caseSensitive){
        findStr = findStr.toLowerCase();
        fullStr = fullStr.toLowerCase();
    }

    while((index = fullStr.indexOf(findStr, startIndex)) > -1){
        indices.push(index);
        startIndex = index + findStrLen;
    }

    return indices;
}
//****Rewrite to find/replace in all chapters */

function findInAllChaps(str, caseSensitive = true){
    var allMatches = [];

    if(str){
        for(i = 0; i < project.chapters.length; i++){
            var chapterMatches = findInChapter(i, str, caseSensitive);
            if(chapterMatches)
                allMatches.push(chapterMatches);
        }
    }
    return allMatches;
}

function findInChapter(chapIndex, str, caseSensitive = true){
    var thisChap = project.chapters[chapIndex];
    var chapContents = thisChap.contents ? thisChap.contents : thisChap.getFile();
    var tempQuill = getTempQuill();
    tempQuill.setContents(chapContents);
    var chapText = tempQuill.getText();

    var matches = null;
    var re = new RegExp(str, "gi");
    var match = re.test(chapText);
    if(match){
        var matchIndices = getIndicesOf(str, chapText, caseSensitive);
        matches = {
            chapIndex: chapIndex, 
            matchIndices: matchIndices
        };
    }

    return matches;
}

function replaceAllInAllChaps(allMatches, oldStr, newStr){
    var totalReplaced = 0;
    allMatches.forEach(function(chapMatches){
        //As you replace each instance, if replacement is different length it shifts all 
        //subsequent index values in that chapter
        var shiftVal = 0;
        displayChapterByIndex(chapMatches.chapIndex)
        chapMatches.matchIndices.forEach(function(ind){
            ind += shiftVal;
            console.log("for chap " + chapMatches.chapIndex + ", replace '" + editorQuill.getText(ind, oldStr.length) + "' with " + newStr);
            editorQuill.deleteText(ind, oldStr.length, 'user');
            editorQuill.insertText(ind, newStr, 'user');
            shiftVal += (newStr.length - oldStr.length);
            totalReplaced++;
        });
    });
    return totalReplaced;
}

