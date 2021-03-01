function searchFor(str){
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
    editorQuill.deleteText(ind, oldStr.length, 'user');
    editorQuill.insertText(ind, newStr, 'user');
}

function removeHighlights() {
    editorQuill.formatText(0, editorQuill.getText().length, 'background', false);
}

function getIndicesOf(searchStr, fullStr){
    var searchStrLen = searchStr.length;
    var startIndex = 0;
    var index;
    var indices = [];

    while((index = fullStr.toLowerCase().indexOf(searchStr.toLowerCase(), startIndex)) > -1){
        indices.push(index);
        startIndex = index + searchStrLen;
    }

    return indices;
}