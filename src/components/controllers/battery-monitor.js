const { spawn } = require("child_process");
const { logError } = require('./error-log');
const fs = require('fs');
var batteryCheckInterval;

function checkBatteryMinutely(callback){
    var batName = getBatteryName();

    //Do initial check
    getBatteryPercent(batName, callback);

    //Start timed updates
    initiateAutocheck(1, function(){
        getBatteryPercent(batName, function(newPercent){
            callback(newPercent);
        });
    });
};

function initiateAutocheck(minutes, updateBattery){
    if(minutes > 0)
      batteryCheckInterval = setInterval(updateBattery, minutes * 60000);
}
  

function updateAutocheck(minutes, updateBattery){
    if(batteryCheckInterval == null)
        initiateAutocheck(minutes, updateBattery);
    else {
        clearInterval(batteryCheckInterval);
        initiateAutocheck(minutes, updateBattery);
    }
}

function endAutocheck(){
    if(batteryCheckInterval)
        clearInterval(batteryCheckInterval);
}

function getBatteryPercent(batName, updateBattery){
    if(batName != null)
        queryKernel(batName, function(resp){
            updateBattery(resp);
        });
}

function getBatteryName(){
    var batteryName = null;
    var batDirs = fs.readdirSync('/sys/class/power_supply');
    var batNames = batDirs.filter(function(val){
        return val.startsWith('BAT');
    });
    if(batNames.length > 0)
        batteryName = batNames[0];

    return batteryName;
}

function queryKernel(batName, cback){
    if(batName != null){
        const cat = spawn('cat', ['/sys/class/power_supply/' + batName + '/capacity']);

        var responseHasData = false;

        cat.stdout.on('data', function(data){
            responseHasData = true;
            cback(data.toString().trim());
        });

        cat.stderr.on('data', function(data){
            logError(data.toString().trim());
        });

        cat.stdout.on('close', function(code){
        if(!responseHasData)
        cback('no data');
        }); 
        
    }
}

module.exports = {
    getBatteryPercent,
    checkBatteryMinutely,
    endAutocheck
};