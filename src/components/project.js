function newProject(){
    return {
        title: "",
        author: "",
        notes: {},
        chapters: [],
        filters: [],
        trash: [],
        activeChapterIndex: 0,
        getActiveChapter: function(){
        var chap;
        if(this.activeChapterIndex < this.chapters.length)
            chap =  this.chapters[this.activeChapterIndex];
        else
            chap = this.trash[this.activeChapterIndex - this.chapters.length];
        return chap;
        }
    };
}

function loadProject(projName){
  var projectFile = fakeFileSys.find(function(f){
    return f.filename == projName;
  });
  Object.assign(project, projectFile.file);
  project.filename = projectFile.filename;
}
