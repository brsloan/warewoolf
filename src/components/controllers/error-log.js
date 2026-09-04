const fs = require('fs');
const path = require('path');

const LOG_FILENAME = 'error_log.txt';
const MAX_LOG_SIZE_BYTES = 1024 * 1024; //1MB - past this, the log is truncated before the next append

let logDirectory = null;

//Renderer startup should call this once with sysDirectories.userData, same as every other
//persistent file in this app (user-settings.json, credentials.json, the spellcheck dictionary).
//Without it we fall back to a bare relative filename so existing tests keep working.
function setLogDirectory(dir){
  logDirectory = dir;
}

function getLogLocation(){
  return logDirectory ? path.join(logDirectory, LOG_FILENAME) : LOG_FILENAME;
}

//logError is called with all kinds of things that aren't real Errors (bare strings from stderr,
//rejected promise values, plain objects) - e.stack on those is undefined, so previously the real
//message was lost and "undefined" got written to the log instead. Fall back to something useful.
function describeError(e){
  if(e instanceof Error)
    return e.stack || e.message || String(e);
  if(typeof e === 'object' && e !== null){
    try{
      return JSON.stringify(e);
    }
    catch(_){
      return String(e);
    }
  }
  return String(e);
}

function logError(e){
  console.log(e);
  let time = new Date().toLocaleString();
  let logLocation = getLogLocation();

  try{
    if(fs.existsSync(logLocation) && fs.statSync(logLocation).size > MAX_LOG_SIZE_BYTES)
      fs.writeFileSync(logLocation, '', 'utf8');

    fs.appendFile(logLocation, time + '\n' + describeError(e) + '\n', function(err){
      if(err)
        console.log('error logging: ' + err);
    });
  }
  catch(er){
    console.log('error logging: ' + er);
  }
}

function loadErrorLog(){
  var logText = '';
  var logLocation = getLogLocation();

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
  var logLocation = getLogLocation();

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
  setLogDirectory,
  logError,
  loadErrorLog,
  clearErrorLog
}
