function getUserSettings(){
  return {
    editorWidth: 50,
    fontSize: 12,
    typewriterMode: false,
    distractionFreeMode: false,
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
      console.log(err);
    }
  }

  function load(){
    try{
      var settingsFile = JSON.parse(fs.readFileSync("user-settings.json", "utf8"));
      Object.assign(this, settingsFile);
    }
    catch(err){
      console.log(err);
    }
    return this;
  }

}
