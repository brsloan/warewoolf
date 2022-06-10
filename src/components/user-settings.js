function getUserSettings(userSettingsFilepath){
  return {
    editorWidth: 50,
    fontSize: 12,
    typewriterMode: false,
    displayChapList: true,
    displayEditor: true,
    displayNotes: true,
    lastProject: null,
    defaultAuthor: '',
    save: save,
    load: load
  };

//  const userSettingsFilepath = "user-settings.json";

  function save(){
    var settings = this;

    var fileString = JSON.stringify(settings, null, '\t');

    try{
      fs.writeFileSync(userSettingsFilepath, fileString, 'utf8');
    }
    catch(err){
      logError(err);
    }
  }

  function load(){

    try{
      if(fs.existsSync(userSettingsFilepath)){
        var settingsFile = JSON.parse(fs.readFileSync(userSettingsFilepath, "utf8"));
        Object.assign(this, settingsFile);
      }
    }
    catch(err){
      logError(err);
    }
    return this;
  }

}
