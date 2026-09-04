const { logError } = require('../controllers/error-log');
const { checkBatteryMinutely, endAutocheck } = require('../controllers/battery-monitor');


function showBattery(){
    var batteryDiv = document.createElement('div');
    batteryDiv.id = 'battery-block';

    var batteryText = document.createElement('p');
    batteryText.id = 'battery-text';
    batteryText.innerText = "--%";

    batteryDiv.appendChild(batteryText);

    document.body.appendChild(batteryDiv);

    checkBatteryMinutely(function(newPerc){
        var percent = parseInt(newPerc);
        //getBatteryPercent reports non-numeric strings like 'N/A' or 'no data' when no
        //battery is present or the kernel read failed - show those as-is instead of the
        //nonsensical "⚡N/A%".
        if(isNaN(percent)){
            batteryText.innerText = newPerc;
            batteryDiv.classList.remove('battery-emergency');
        }
        else{
            batteryText.innerText = '⚡' + percent + '%';
            if(percent < 10)
                batteryDiv.classList.add('battery-emergency');
            else
                batteryDiv.classList.remove('battery-emergency');
        }
    });
}

function removeBattery(){
    endAutocheck();
    var batteryDiv = document.getElementById('battery-block');
    if(batteryDiv)
        batteryDiv.remove();
    else
        logError(new Error('removeBattery called with no #battery-block in the DOM'));
}

module.exports = {
    showBattery,
    removeBattery
};