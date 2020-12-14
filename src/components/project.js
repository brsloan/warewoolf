function newProject(){
    return {
        title: "",
        author: "",
        notes: {},
        chapters: [],
        filters: [],
        trash: [],
        activeChapterIndex: 0,
        getActiveChapter: getActiveChapter,
        loadFile: loadFile,
        saveFile: saveFile
    };

    function getActiveChapter(){
      var chap;
        if(this.activeChapterIndex < this.chapters.length)
            chap =  this.chapters[this.activeChapterIndex];
        else
            chap = this.trash[this.activeChapterIndex - this.chapters.length];
        return chap;
    }

    function loadFile(projName){
      var projectFile = fakeFileSys.find(function(f){
        return f.filename == projName;
      });
      Object.assign(this, projectFile.file);
      this.filename = projectFile.filename;
    
      var chaps = [];
      this.chapters.forEach(function(chap){
       chaps.push(newChapter().parseChapter(chap));
      });
      this.chapters = chaps;
    
    
      var trashChaps = [];
      this.trash.forEach(function(tr){
        trashChaps.push(newChapter().parseChapter(tr));
      });
      this.trash = trashChaps;
    }

    function saveFile(){
      var proj = this;
      var projFile = fakeFileSys.find(function(f){
        return f.filename == proj.filename;
      });
      projFile.file = proj;
    }
}
