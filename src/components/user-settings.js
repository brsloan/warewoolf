function getUserSettings(){
  return {
    editorWidth: 50,
    fontSize: 12,
    typewriterMode: false,
    displayMode: 1, //|A|B|C|:1=ABC,2=AB,3=BC,4=A,5=B,6=C
    lastProject: null,
    defaultAuthor: '',
    save: save,
    load: load
  };

  function save(){
    var settings = this;

    var fileString = JSON.stringify(settings, null, '\t');

    try{
      fs.writeFileSync("user-settings.json", fileString, 'utf8');
    }
    catch(err){
      logError(err);
    }
  }

  function load(){
    try{
      var settingsFile = JSON.parse(fs.readFileSync("user-settings.json", "utf8"));
      Object.assign(this, settingsFile);
    }
    catch(err){
      logError(err);
    }
    return this;
  }

}
