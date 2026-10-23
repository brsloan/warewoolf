const { closePopups, createButton, removeElementsByClass, generateRow, removeOptions, describeDialog } = require('../controllers/utils');
const { getBluetoothStatus, enableBluetooth, disableBluetooth, getBluetoothDevices, scanForDevices, connectDevice, forgetDevice } = require('../controllers/bluetooth-manager');

//Bumped on every showBluetoothManager() call and again on Close, for the same reason as
//wifi-manager_display.js's generation: a scan or a pair takes seconds, and its result must not be
//written into a dialog that has since closed or been reopened.
var bluetoothManagerGeneration = 0;

//BlueZ's icon names for the kinds of device a writerDeck is likely to see.
var DEVICE_KINDS = {
  'input-keyboard': 'keyboard',
  'input-mouse': 'mouse',
  'input-tablet': 'tablet',
  'input-gaming': 'game controller',
  'audio-headset': 'headset',
  'audio-headphones': 'headphones',
  'audio-card': 'speaker',
  'phone': 'phone',
  'computer': 'computer'
};

function describeDevice(device){
  var kind = DEVICE_KINDS[device.icon];
  var text = device.name + (kind ? ' (' + kind + ')' : '');
  if(device.connected)
    text += ' - connected';
  else if(device.paired)
    text += ' - paired';
  return text;
}

function showBluetoothManager(){

  bluetoothManagerGeneration++;
  var myGeneration = bluetoothManagerGeneration;
  function isCurrent(){
    return myGeneration === bluetoothManagerGeneration;
  }

  var devices = [];

  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var header = document.createElement('h1');
  header.innerText = "Bluetooth Manager";
  popup.appendChild(header);
  describeDialog(popup, header);

  var explanation = document.createElement('p');
  explanation.innerText = 'To add a keyboard, turn it on and put it in pairing mode, then Scan,'
    + ' choose it from the list and Connect.';
  popup.appendChild(explanation);

  var bluetoothForm = document.createElement('form');
  var bluetoothTbl = document.createElement('table');

  var enableLabel = document.createElement('label');
  enableLabel.innerText = "Enable Bluetooth: ";
  enableLabel.htmlFor = 'enable-bluetooth-check';

  var enableCheck = document.createElement('input');
  enableCheck.type = 'checkbox';
  enableCheck.id = 'enable-bluetooth-check';
  enableCheck.disabled = true;

  bluetoothTbl.appendChild(generateRow(enableLabel, enableCheck));

  var statusLabel = document.createElement('label');
  statusLabel.innerText = "Status: ";

  var statusText = document.createElement('label');
  statusText.id = 'bluetooth-status';
  statusText.innerText = "checking...";

  bluetoothTbl.appendChild(generateRow(statusLabel, statusText));
  bluetoothForm.appendChild(bluetoothTbl);

  var devicesSet = document.createElement("fieldset");
  devicesSet.disabled = true;
  bluetoothForm.appendChild(devicesSet);

  var devicesLegend = document.createElement("legend");
  devicesLegend.innerText = "Devices";
  devicesSet.appendChild(devicesLegend);

  var devicesSelect = document.createElement("select");
  devicesSelect.id = "bluetooth-devices-select";
  devicesSelect.size = 8;
  devicesSelect.setAttribute('aria-label', 'Devices');
  devicesSet.appendChild(devicesSelect);
  devicesSet.appendChild(document.createElement('br'));

  var scanBtn = createButton("<span class='access-key'>S</span>can");
  scanBtn.accessKey = 's';
  devicesSet.appendChild(scanBtn);

  var connectBtn = createButton("<span class='access-key'>C</span>onnect");
  connectBtn.accessKey = 'c';
  devicesSet.appendChild(connectBtn);

  var forgetBtn = createButton("<span class='access-key'>F</span>orget");
  forgetBtn.accessKey = 'f';
  devicesSet.appendChild(forgetBtn);

  var messageText = document.createElement('p');
  messageText.id = 'bluetooth-message';
  messageText.setAttribute('aria-live', 'polite');
  devicesSet.appendChild(messageText);

  popup.appendChild(bluetoothForm);
  popup.appendChild(document.createElement('br'));

  var closeBtn = createButton("Close");
  closeBtn.onclick = function(){
    bluetoothManagerGeneration++;
    closePopups();
  };
  popup.appendChild(closeBtn);

  document.body.appendChild(popup);
  closeBtn.focus();

  //Only one scan, pair or forget at a time: bluetoothctl would happily start a second, and the
  //two answers would land in the one message line in whichever order they finished.
  function setBusy(busy){
    scanBtn.disabled = busy;
    connectBtn.disabled = busy;
    forgetBtn.disabled = busy;
    enableCheck.disabled = busy;
  }

  function showMessage(text){
    messageText.innerText = text || '';
  }

  function selectedDevice(){
    var index = devicesSelect.selectedIndex;
    return index < 0 ? null : devices[index];
  }

  function updateDevicesList(listData){
    var previous = selectedDevice();
    devices = listData || [];
    removeOptions(devicesSelect);
    devices.forEach(function(device, i){
      var option = document.createElement('option');
      option.value = device.address;
      option.innerText = describeDevice(device);
      devicesSelect.appendChild(option);
      if(previous != null && previous.address === device.address)
        devicesSelect.selectedIndex = i;
    });
    if(devicesSelect.selectedIndex < 0 && devices.length > 0)
      devicesSelect.selectedIndex = 0;
  }

  function updateStatus(statusData){
    if(statusData.status === 'unavailable'){
      enableCheck.checked = false;
      enableCheck.disabled = true;
      devicesSet.disabled = true;
      statusText.innerText = statusData.message || 'unavailable';
      return;
    }
    enableCheck.disabled = false;
    enableCheck.checked = statusData.status === 'enabled';
    devicesSet.disabled = !enableCheck.checked;
    statusText.innerText = statusData.status;
  }

  function refreshDevices(){
    return getBluetoothDevices().then(function(listData){
      if(!isCurrent()) return;
      updateDevicesList(listData);
    });
  }

  enableCheck.onclick = function(){
    var turningOn = enableCheck.checked;
    setBusy(true);
    showMessage(turningOn ? 'Turning Bluetooth on...' : 'Turning Bluetooth off...');
    (turningOn ? enableBluetooth() : disableBluetooth()).then(function(failure){
      if(!isCurrent()) return;
      showMessage(failure);
      return getBluetoothStatus().then(function(statusData){
        if(!isCurrent()) return;
        updateStatus(statusData);
        setBusy(false);
        return refreshDevices();
      });
    });
  };

  scanBtn.onclick = function(){
    setBusy(true);
    showMessage('Scanning for ten seconds...');
    scanForDevices().then(function(result){
      if(!isCurrent()) return;
      setBusy(false);
      updateDevicesList(result.devices);
      if(result.message)
        showMessage(result.message);
      else
        showMessage(result.devices.length > 0
          ? 'Choose a device and Connect. A new device is only listed for about thirty seconds.'
          : 'Nothing found. Is the device in pairing mode?');
      devicesSelect.focus();
    });
  };

  connectBtn.onclick = function(){
    var device = selectedDevice();
    if(device == null){
      showMessage('Choose a device first.');
      return;
    }
    setBusy(true);
    showMessage((device.paired ? 'Connecting to ' : 'Pairing with ') + device.name + '...');
    connectDevice(device).then(function(message){
      if(!isCurrent()) return;
      setBusy(false);
      showMessage(message);
      return refreshDevices();
    });
  };

  forgetBtn.onclick = function(){
    var device = selectedDevice();
    if(device == null){
      showMessage('Choose a device first.');
      return;
    }
    setBusy(true);
    showMessage('Forgetting ' + device.name + '...');
    forgetDevice(device).then(function(message){
      if(!isCurrent()) return;
      setBusy(false);
      showMessage(message);
      return refreshDevices();
    });
  };

  devicesSelect.onkeydown = function(e){
    if(e.key === 'Enter'){
      e.preventDefault();
      if(!connectBtn.disabled)
        connectBtn.onclick();
    }
  };
  devicesSelect.ondblclick = function(){
    if(!connectBtn.disabled)
      connectBtn.onclick();
  };

  //Kicked off once every element a callback might touch exists, and each guarded on isCurrent().
  getBluetoothStatus().then(function(statusData){
    if(!isCurrent()) return;
    updateStatus(statusData);
  });
  refreshDevices();
}

module.exports = showBluetoothManager;
