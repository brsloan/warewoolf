const { logError } = require('./error-log');
const { createPlatform } = require('./platform');
const { createIpcBacking } = require('./platform-ipc');

//A standing instance for the same reason wifi-manager.js keeps one: nothing here takes injected
//config. Every function routes through a bluetooth* contract command.
var platform = createPlatform(createIpcBacking());

//UNAVAILABLE is not logged: no adapter, no bluetoothctl, or bluetoothd not running is the ordinary
//case on every machine that is not a writerDeck. Anything else still logs.
function reportUnlessUnavailable(err){
  if(err == null || err.code !== 'UNAVAILABLE')
    logError(err);
}

//Resolves { status, message }: 'enabled' or 'disabled', or 'unavailable' with the reason, so the
//dialog can say why there is nothing to manage rather than only that there is not.
async function getBluetoothStatus(){
  try{
    return { status: await platform.bluetoothGetStatus(), message: null };
  }
  catch(err){
    reportUnlessUnavailable(err);
    return { status: 'unavailable', message: err.message };
  }
}

//The three below resolve null on success and the reason as text on failure - what the dialog
//shows either way.
async function enableBluetooth(){
  try{
    await platform.bluetoothEnable();
    return null;
  }
  catch(err){
    reportUnlessUnavailable(err);
    return err.message;
  }
}

async function disableBluetooth(){
  try{
    await platform.bluetoothDisable();
    return null;
  }
  catch(err){
    reportUnlessUnavailable(err);
    return err.message;
  }
}

async function getBluetoothDevices(){
  try{
    return await platform.bluetoothListDevices();
  }
  catch(err){
    reportUnlessUnavailable(err);
    return [];
  }
}

//Resolves { devices, message }: the list after the scan, and the reason when the scan failed.
async function scanForDevices(){
  try{
    return { devices: await platform.bluetoothScan(), message: null };
  }
  catch(err){
    reportUnlessUnavailable(err);
    return { devices: await getBluetoothDevices(), message: err.message };
  }
}

//Pairs a new device, or only reconnects one already paired. Resolves the line to show.
async function connectDevice(device){
  try{
    if(device.paired)
      await platform.bluetoothConnect({ address: device.address });
    else
      await platform.bluetoothPair({ address: device.address });
    return 'Connected to ' + device.name + '.';
  }
  catch(err){
    reportUnlessUnavailable(err);
    return err.message;
  }
}

async function forgetDevice(device){
  try{
    await platform.bluetoothRemove({ address: device.address });
    return 'Forgot ' + device.name + '.';
  }
  catch(err){
    reportUnlessUnavailable(err);
    return err.message;
  }
}

module.exports = {
  getBluetoothStatus,
  enableBluetooth,
  disableBluetooth,
  getBluetoothDevices,
  scanForDevices,
  connectDevice,
  forgetDevice
}
