//Routes logging through the platform facade (see platform.js) instead of touching fs directly, so
//this module keeps working once contextIsolation removes fs from the renderer entirely.
//
//logError stays fire-and-forget on purpose: nearly all of its ~98 call sites sit in catch blocks
//whose return value nobody uses, so awaiting it here would cascade async through the whole
//codebase. platform.logError() still returns a promise - callers just never see it - and that
//promise is always caught below, so a failed log write can never surface as an unhandled
//rejection. The promise is returned anyway (nothing production reads it) purely so a test can
//await a specific call instead of polling the log file for it to land.
let platform = null;

//Renderer startup calls this once with the shared platform instance, replacing the old
//setLogDirectory(sysDirectories.userData) - the log lives in userData, which the native side
//already knows, so this module no longer needs to be told a path at all.
function setPlatform(p){
  platform = p;
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

  if(platform == null)
    return Promise.resolve();

  var time = new Date().toLocaleString();
  var text = time + '\n' + describeError(e) + '\n';

  return platform.logError({ text: text }).catch(function(err){
    console.log('error logging: ' + err);
  });
}

//Named loadErrorLog rather than the contract's readErrorLog - deliberate, not a drift to fix. Only
//error-log_display.js consumes this.
function loadErrorLog(){
  if(platform == null)
    return Promise.resolve('');

  return platform.readErrorLog().catch(function(err){
    logError(err);
    return '';
  });
}

function clearErrorLog(){
  if(platform == null)
    return Promise.resolve();

  return platform.clearErrorLog().catch(function(err){
    logError(err);
  });
}

module.exports = {
  setPlatform,
  logError,
  loadErrorLog,
  clearErrorLog
}
