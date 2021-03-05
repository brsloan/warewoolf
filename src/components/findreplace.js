function find(str, caseSensitive = true, startingIndex, searchAllChapters){
    var index = -1;
    
    if(str){
        var totalText = editorQuill.getText();

        if(!caseSensitive){
            totalText = totalText.toLowerCase();
            str = str.toLowerCase();
        }

        index = totalText.indexOf(str, startingIndex);
        if(index == startingIndex)
            index = totalText.indexOf(str, startingIndex + str.length);

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
                        result = find(str, caseSensitive, 0);
                        index = result;
                    }
                    else {
                        //If search did not begin at first chapter, loop back to first chapter for one more go.
                        if(startingChapIndex != 0){
                            startingChapIndex = 0;
                            displayChapterByIndex(0);
                            result = find(str, caseSensitive, 0);
                            index = result;
                        }
                        else {
                            result = 1;
                        }
                    }
                }   
            } else {
                if(startingIndex != 0){
                    index =  find(str, caseSensitive, 0);
                }
                   
            }   
        }
    }
    return index;
}

function replace(newStr){
    var selectedRange = editorQuill.getSelection(true);
    if(selectedRange.length > 0){
        editorQuill.deleteText(selectedRange.index, selectedRange.length, 'user');
        editorQuill.insertText(selectedRange.index, newStr, 'user');
    }
}

function replaceAll(oldStr, newStr, caseSensitive, searchAllChapters){
    var res = 1;
    var counter = 0;
    while(res > 0){
        res = find(oldStr, caseSensitive, 0, searchAllChapters);
        if(res > 0){
            replace(newStr);
            counter++;
        }       
    }
    return counter;
}