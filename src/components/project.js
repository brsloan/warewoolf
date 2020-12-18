

function newProject(){
    return {
        filename: "",
        title: "",
        author: "",
        notes: {},
        chapters: [],
        filters: [],
        trash: [],
        activeChapterIndex: 0,
        getActiveChapter: getActiveChapter,
        loadFile: loadFile,
        saveFile: saveFile,
        saveAs: saveAs
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

      var projectFile = JSON.parse(fs.readFileSync("output/" + projName, "utf8"));

        Object.assign(this, projectFile);
        this.filename = projName;

        var chaps = [];
        this.chapters.forEach(function (chap) {
          chaps.push(newChapter().parseChapter(chap));
        });
        this.chapters = chaps;


        var trashChaps = [];
        this.trash.forEach(function (tr) {
          trashChaps.push(newChapter().parseChapter(tr));
        });
        this.trash = trashChaps;
      
    }




    function saveFile(){
      var proj = this;
      
      var fileString = JSON.stringify(proj, function(k,v){
        if (k == "contents") return undefined;
        else if (k == "hasUnsavedChanges") return undefined;
        else return v;
      });

      ipcRenderer.invoke('save-file', proj.filename, fileString);
    }

    function saveAs(filepath){
      var proj = this;
      var filepathParts = filepath.split('/');

      proj.filename = filepathParts.pop();
      if(proj.filename.substr(proj.filename.length - 6, 6) != ".woolf")
        proj.filename += ".woolf";

      proj.directory = filepathParts.join('/').concat("/").concat(proj.filename.split('.')[0]).concat("/");

      if(!fs.existsSync(proj.directory))
        fs.mkdirSync(proj.directory);

      proj.chapters.forEach(function(chap){
        chap.saveFileNew();
      });
      proj.trash.forEach(function(tr){
        tr.saveFileNew();
      });


      
      var fileString = JSON.stringify(proj, function(k,v){
        if (k == "contents") return undefined;
        else if (k == "hasUnsavedChanges") return undefined;
        else return v;
      });

      //ipcRenderer.invoke('save-file', filepath, fileString);
      fs.writeFileSync(proj.directory + proj.filename, fileString, 'utf8');
      
    }
}
