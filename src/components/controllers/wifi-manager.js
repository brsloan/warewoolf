const { logError } = require('./error-log');
const { createPlatform } = require('./platform');
const { createIpcBacking } = require('./platform-ipc');

//All seven functions here take no injected config, so this holds its own standing instance, the
//same reason file-manager.js/corkboard.js/epub.js do. As of the gap Phase 8 recorded being closed,
//every one of them routes through a contract command - none of them spawns nmcli directly any more.
var platform = createPlatform(createIpcBacking());

//Logging is skipped for UNAVAILABLE specifically - nmcli/hostname simply not being installed is
//the ordinary case on every machine that isn't a writerDeck, and this dialog gets opened by anyone
//who clicks Wi-Fi Manager, not only on a Pi. A genuine failure (IO_ERROR and the rest) still logs.
function reportUnlessUnavailable(err){
  if(err == null || err.code !== 'UNAVAILABLE')
    logError(err);
}

async function getIpAddress(){
  try{
    var address = await platform.wifiGetAddress();
    return address || 'no data';
  }
  catch(err){
    reportUnlessUnavailable(err);
    return 'no data';
  }
}

async function getConnectionState(){
  try{
    return await platform.wifiGetConnectionState();
  }
  catch(err){
    reportUnlessUnavailable(err);
    return { state: 'unknown', connection: null };
  }
}

async function getWifiStatus(){
  try{
    return await platform.wifiGetStatus();
  }
  catch(err){
    reportUnlessUnavailable(err);
    return 'no data';
  }
}

async function getWifiNetworks(){
  try{
    return await platform.wifiListNetworks();
  }
  catch(err){
    reportUnlessUnavailable(err);
    return [];
  }
}

async function disableWifi(){
  try{
    await platform.wifiDisable();
  }
  catch(err){
    reportUnlessUnavailable(err);
  }
}

async function enableWifi(){
  try{
    await platform.wifiEnable();
  }
  catch(err){
    reportUnlessUnavailable(err);
  }
}

async function connectToNewWifi(ssidString, passString){
  try{
    await platform.wifiConnect({ ssid: ssidString, psk: passString });
    return 'Connected.';
  }
  catch(err){
    reportUnlessUnavailable(err);
    return err.message;
  }
}

module.exports = {
  getConnectionState,
  getWifiStatus,
  getWifiNetworks,
  disableWifi,
  enableWifi,
  connectToNewWifi,
  getIpAddress
}
