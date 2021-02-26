

function importFiles(filepaths){
    console.log(filepaths);
    
    importPlainText(filepaths);
}

function importPlainText(filepaths){
    filepaths.forEach(function(path){
        var inText = fs.readFileSync(path, 'utf8');

        var tempQuill = new Quill(document.createElement('div'), {
            modules: {
                history: {
                    userOnly: true
                }
            }
            });
    
        tempQuill.setText(inText);
        var newChapContents = tempQuill.getContents();

        var filename = path.replaceAll('\\', '/').split('/').pop().split('.')[0];

        var newChap = newChapter();
        newChap.hasUnsavedChanges = true;
        newChap.contents = newChapContents;
        newChap.title = filename;
        
        project.chapters.splice(project.activeChapterIndex + 1, 0, newChap);
        updateFileList();
        var thisIndex = project.chapters.indexOf(newChap);
        displayChapterByIndex(thisIndex);
    });
}