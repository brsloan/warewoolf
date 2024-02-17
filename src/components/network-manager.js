const network = require("node-network-manager");
/*
network
  .getConnectionProfilesList()
  .then((data) => console.log(data))
  .catch((error) => console.log(error));*/

function getConnectionState(cback){
  network
    .deviceStatus()
    .then((result) => cback(result))
    .catch((error) => console.log(error));
}


function getWifiStatus(cback){
  network
    .getWifiStatus()
    .then((data) => cback(data))
    .catch((error) => cback(error));
}

function getWifiNetworks(cback){
  network
    .getWifiList(true)
    .then((data) => cback(data))
    .catch((error) => cback(error));
}

function disableWifi(cback){
  network
  .wifiDisable()
  .then(() => cback("wifi was disabled"))
  .catch((error) => console.log(error));
}

function enableWifi(cback){
  network
  .wifiEnable()
  .then(() => cback("wifi was enabled"))
  .catch((error) => console.log(error));
}
