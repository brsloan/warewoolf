
function exportProject(options, docPath){
    console.log(options);
  
    const saveOptions = {
      title: 'Export files to... (Subdirectory will be created)',
      defaultPath: docPath,
      properties: ['openDirectory']
    };
    var filepath = convertFilepath(dialog.showOpenDialogSync(saveOptions)[0]);
    
    if(filepath){
      //TODO: Need to create function to safely convert titles to folder/filenames
      var newDir = filepath.concat("/").concat(project.title.replace(/[^a-z0-9]/gi, '_')).concat("/"); 
      
      if(!fs.existsSync(newDir))
          fs.mkdirSync(newDir);
  
      for(i = 0; i < project.chapters.length; i++){
        var chapFile = project.chapters[i].getFile();

        var outName = String(i + 1).padStart(4, '0') + "_" + project.chapters[i].title.replace(/[^a-z0-9]/gi, '_');

        fs.writeFileSync(newDir + outName + options.type, convertChapter(chapFile, options), 'utf8');
      }

      fs.writeFileSync(newDir + "notes" + options.type, convertChapter(project.notes, options), "utf8");
    }
  }
  
function convertChapter(chapFile, options){
    var converted;
    
    switch(options.type){
        case ".txt":
            converted = convertToPlainText(chapFile);
            break;
        case ".markdown":
            break;
        case ".odt":
            break;
        default: 
            console.log("No valid filetype selected for export.");
    }

    return converted;
}

function convertToPlainText(chapFile){
    var tempQuill = new Quill(document.createElement('div'), {
        modules: {
            history: {
            userOnly: true
            }
        }
        });

    tempQuill.setContents(chapFile);

    return tempQuill.getText();
}