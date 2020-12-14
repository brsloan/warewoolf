function newChapter(){
    return {
      title: "new",
      filename: null,
      filter: null,
      contents: {"ops":[{"insert":"\n"}]},
      hasUnsavedChanges: true
    };
  }

  function loadChapter(chap){
    //here you would pull from file system
    var chapterObj = fakeFileSys.find(function(f){
      return f.filename == chap.filename;
    });
        
    return chapterObj.file;
  }
  
  function clearCurrentChapterIfUnchanged(){
    var ch = project.getActiveChapter();
    if(ch && (ch.hasUnsavedChanges == undefined || ch.hasUnsavedChanges == false)){
      ch.contents = null;
    }
  };