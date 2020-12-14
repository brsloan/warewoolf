//const { jetpack } = require('fs-jetpack');
const { ipcRenderer } = require('electron');
const { valueOf } = require('electron-squirrel-startup');

function newChapter(){
    return {
      title: "new",
      filename: null,
      filter: null,
      contents: {"ops":[{"insert":"\n"}]},
      hasUnsavedChanges: null,
      deleteFile: deleteChapterFile,
      parseChapter: parseChapter,
      getFile: getFile,
      saveFile: saveFile
    };

    function deleteChapterFile(){
      var chap = this;
      var indexToDelete = fakeFileSys.findIndex(function(f){
        return f.filename == chap.filename;
      });
      
      if(indexToDelete > -1)
        fakeFileSys.splice(indexToDelete, 1);
    }

    function parseChapter(chap){
      return Object.assign(this, chap);
    }

    function getFile(){
      var chap = this;
      var chapterObj = fakeFileSys.find(function(f){
        return f.filename == chap.filename;
      });
      return chapterObj.file;
    }

    function saveFile(){
      var chap = this;

      if(chap.filename == undefined || chap.filename == null)
        chap.filename = getNewFilename();
      /*
      var fileString = JSON.stringify(chap.contents, function(k,v){
        if (k == "contents") return undefined;
        else if (k == "hasUnsavedChanges") return undefined;
        else if (k == "filename") return undefined;
        else return v;
      });*/

     

      ipcRenderer.invoke('save-file', chap.filename, JSON.stringify(chap.contents));

      /*

      var chapFile = fakeFileSys.find(function(f){
        return f.filename == chap.filename;
      });
      
      if(chapFile == undefined){
        chap.filename = getNewFilename();
        fakeFileSys.push({ filename: chap.filename, file: chap.contents });
      }
      else {
        chapFile.file = chap.contents;  
      }*/

      function getNewFilename(){
        var largestFilename = 0;
        fakeFileSys.forEach(function(ch){
          if(ch.filename != null){
            var nameNumber = parseInt(ch.filename.split(".")[0]);
            if(nameNumber > largestFilename)
              largestFilename = nameNumber;  
          }
        });
        return (largestFilename + 1).toString() + ".pup";
      }
    }
  }

  
