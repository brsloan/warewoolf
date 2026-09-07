const { logError } = require('./error-log');
const { createPlatform } = require('./platform');
const { createNodeBacking } = require('./platform-node');

//getBatteryCapacity (group K) takes no injected config, so this holds its own standing instance,
//the same reason file-manager.js/corkboard.js/epub.js do. It folds what used to be this file's own
//getBatteryName()/queryKernel() two-step into one native call - see platform-node.js's own note on
//why "no battery" is UNAVAILABLE rather than a resolved null.
var platform = createPlatform(createNodeBacking({}));

var batteryCheckInterval;

function checkBatteryMinutely(callback){
    //Do initial check
    pollCapacity(callback);

    //Start timed updates
    updateAutocheck(1, function(){
        pollCapacity(callback);
    });
};

function pollCapacity(callback){
    platform.getBatteryCapacity().then(function(capacity){
        callback(String(capacity));
    }).catch(function(err){
        //UNAVAILABLE (no battery at all) is the everyday result on every machine that isn't a
        //writerDeck - not worth writing to the error log once a minute for as long as the app is
        //open. A read that genuinely failed (IO_ERROR, a spawn error) still logs.
        if(err.code === 'UNAVAILABLE'){
            callback('N/A');
            return;
        }

        logError(err);
        callback('no data');
    });
}

function initiateAutocheck(minutes, updateBattery){
    if(minutes > 0)
      batteryCheckInterval = setInterval(updateBattery, minutes * 60000);
}


function updateAutocheck(minutes, updateBattery){
    if(batteryCheckInterval == null)
        initiateAutocheck(minutes, updateBattery);
    else {
        clearInterval(batteryCheckInterval);
        batteryCheckInterval = null;
        initiateAutocheck(minutes, updateBattery);
    }
}

function endAutocheck(){
    if(batteryCheckInterval){
        clearInterval(batteryCheckInterval);
        batteryCheckInterval = null;
    }
}

module.exports = {
    checkBatteryMinutely,
    initiateAutocheck,
    updateAutocheck,
    endAutocheck
};
