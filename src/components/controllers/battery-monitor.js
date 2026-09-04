const { spawn } = require("child_process");
const { logError } = require('./error-log');
const fs = require('fs');
var batteryCheckInterval;

function checkBatteryMinutely(callback){
    var batName = getBatteryName();

    //Do initial check
    getBatteryPercent(batName, callback);

    //Start timed updates
    updateAutocheck(1, function(){
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

function getBatteryPercent(batName, updateBattery){
    if(batName != null)
        queryKernel(batName, function(resp){
            updateBattery(resp);
        });
    else
        updateBattery('N/A');
}

function getBatteryName(){
    var batteryName = null;
    var batDirs;
    try{
        batDirs = fs.readdirSync('/sys/class/power_supply');
    }
    catch(err){
        logError(err);
        return null;
    }
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

        var output = '';
        var cbackCalled = false;

        function respond(value){
            if(!cbackCalled){
                cbackCalled = true;
                cback(value);
            }
        }

        cat.stdout.on('data', function(data){
            output += data.toString();
        });

        cat.stderr.on('data', function(data){
            logError(new Error(data.toString().trim()));
        });

        cat.on('error', function(err){
            logError(err);
            respond('no data');
        });

        cat.stdout.on('close', function(code){
            respond(output.trim() || 'no data');
        });
    }
}

module.exports = {
    getBatteryPercent,
    getBatteryName,
    checkBatteryMinutely,
    initiateAutocheck,
    updateAutocheck,
    endAutocheck
};