const fs = require('fs');

function logError(e){
    console.log(e);
    let time = new Date().toLocaleString();
    try{
      fs.appendFile('error_log.txt', time + '\n' + e.stack + '\n', function(err){
        if(err)
          console.log('error logging: ' + err);
      });
    }
    catch(er){
      console.log('error logging: ' + er);
    }
  }

  function loadErrorLog(){
    var logLocation = 'error_log.txt';
    var logText = '';
  
    try {
      if(fs.existsSync(logLocation)){
        logText = fs.readFileSync(logLocation, "utf8");
      }
    }
    catch(err){
      logError(err);
    }
  
    return logText;
  }
  
  function clearErrorLog(){
    var logLocation = 'error_log.txt';
    try {
      if(fs.existsSync(logLocation)){
        fs.writeFileSync(logLocation, '', 'utf8')
      }
    }
    catch(err){
      logError(err);
    }
  }
  
  module.exports = {
    logError,
    loadErrorLog,
    clearErrorLog
  }