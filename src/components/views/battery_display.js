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
        batteryText.innerText = '⚡' + newPerc + '%';
        if(parseInt(newPerc) < 10)
            batteryDiv.classList.add('battery-emergency');
        else
            batteryDiv.classList.remove('battery-emergency');
    });
}

function removeBattery(){
    endAutocheck();
    document.getElementById('battery-block').remove();
}

module.exports = {
    showBattery,
    removeBattery
};