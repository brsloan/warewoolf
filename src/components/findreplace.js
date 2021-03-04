function find(str){
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
            var indices = getIndicesOf(str, totalText);
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

function removeHighlights() {
    editorQuill.formatText(0, editorQuill.getText().length, 'background', false);
}

function getIndicesOf(findStr, fullStr){
    var findStrLen = findStr.length;
    var startIndex = 0;
    var index;
    var indices = [];

    while((index = fullStr.toLowerCase().indexOf(findStr.toLowerCase(), startIndex)) > -1){
        indices.push(index);
        startIndex = index + findStrLen;
    }

    return indices;
}
//****Rewrite to find/replace in all chapters */

function findInAllChaps(str){
    var allMatches = [];

    if(str){
        console.log('search for ' + str);
        var tempQuill = getTempQuill();

        for(i = 0; i < project.chapters.length; i++){
            var thisChap = project.chapters[i];
            var chapContents = thisChap.contents ? thisChap.contents : thisChap.getFile();
            tempQuill.setContents(chapContents);
            var chapText = tempQuill.getText();

            var re = new RegExp(str, "gi");
            var match = re.test(chapText);
            if(match){
                var matchIndices = getIndicesOf(str, chapText);
                allMatches.push({
                    chapIndex: i, 
                    matchIndices: matchIndices
                });
            }
        }
    }
    return allMatches;
}

function replaceAllInAllChaps(allMatches, oldStr, newStr){
    allMatches.forEach(function(chapMatches){
        //As you replace each instance, if replacement is different length it shifts all 
        //subsequent index values
        var shiftVal = 0;
        displayChapterByIndex(chapMatches.chapIndex)
        chapMatches.matchIndices.forEach(function(ind){
            ind += shiftVal;
            console.log("for chap " + chapMatches.chapIndex + ", replace '" + editorQuill.getText(ind, oldStr.length) + "' with " + newStr);
            editorQuill.deleteText(ind, oldStr.length, 'user');
            editorQuill.insertText(ind, newStr, 'user');
            shiftVal += (newStr.length - oldStr.length);
        });
    });
}

