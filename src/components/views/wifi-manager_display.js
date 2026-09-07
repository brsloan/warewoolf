const { closePopups, createButton, removeElementsByClass, generateRow, removeOptions } = require('../controllers/utils');
const { enableWifi, disableWifi, getWifiStatus, getWifiNetworks, getConnectionState, connectToNewWifi, getIpAddress } = require('../controllers/wifi-manager');

//Bumped on every showWifiManager() call and again when the popup is closed. wifi-manager.js's own
//seven functions are all promise-returning now, so every continuation below - the initial loads,
//the enable/disable handlers, and above all pollUntilConnected's recursive poll - checks this
//before touching the DOM or scheduling more work, instead of running forever in the background
//after the dialog that started it is gone. A promise chain cannot be cancelled from the outside the
//way a timer can be cleared; this is the only lever there is, so every `.then` that follows an
//await/`.then` boundary checks it before doing anything observable.
var wifiManagerGeneration = 0;

function delay(ms){
  return new Promise(function(resolve){ setTimeout(resolve, ms); });
}

function showWifiManager(){

  wifiManagerGeneration++;
  var myGeneration = wifiManagerGeneration;
  function isCurrent(){
    return myGeneration === wifiManagerGeneration;
  }

  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var header = document.createElement('h1');
  header.innerText = "Wi-Fi Manager";
  popup.appendChild(header);

  var networkForm = document.createElement('form');

  var networkTbl = document.createElement('table');

  var enableWifiLabel = document.createElement('label');
  enableWifiLabel.innerText = "Enable Wi-Fi: ";
  enableWifiLabel.htmlFor = 'enable-wifi-check';

  var enableWifiCheck = document.createElement('input');
  enableWifiCheck.type = 'checkbox';
  enableWifiCheck.id = 'enable-wifi-check';

  networkTbl.appendChild(generateRow(enableWifiLabel, enableWifiCheck));
  enableWifiCheck.onclick = function(){
    setNewConnectionEnabled(enableWifiCheck.checked);
    if(enableWifiCheck.checked){
      enableWifi().then(function(){
        return delay(500);
      }).then(function(){
        if(!isCurrent()) return;
        return pollUntilConnected();
      });
    }
    else {
      disableWifi().then(function(){
        if(!isCurrent()) return;
        return getConnectionState();
      }).then(function(stateData){
        if(!isCurrent() || stateData == null) return;
        updateConnectionState(stateData);
      });
    }
  }

  var ipLabel = document.createElement('label');
  ipLabel.innerText = 'IP: ';

  var ipDisplay = document.createElement('label');
  ipDisplay.innerText = 'checking...';

  networkTbl.appendChild(generateRow(ipLabel, ipDisplay));

  var connectionStateLabel = document.createElement('label');
  connectionStateLabel.innerText = "State: ";

  var connectionStateText = document.createElement('label');
  connectionStateText.innerText = "checking...";

  networkTbl.appendChild(generateRow(connectionStateLabel, connectionStateText));

  var connectedNetworkLabel = document.createElement('label');
  connectedNetworkLabel.innerText = "Network: ";

  var connectedNetworkText = document.createElement('label');
  connectedNetworkText.innerText = "checking...";

  networkTbl.appendChild(generateRow(connectedNetworkLabel, connectedNetworkText));

  networkForm.appendChild(networkTbl);

  var newConnectionSet = document.createElement("fieldset");
  newConnectionSet.disabled = true;
  networkForm.appendChild(newConnectionSet);

  function setNewConnectionEnabled(enabled){
    newConnectionSet.disabled = !enabled;
  }

  var newConnectionLegend = document.createElement("legend");
  newConnectionLegend.innerText = "New Connection";
  newConnectionSet.appendChild(newConnectionLegend);

  var newConTbl = document.createElement('table');

  var networksLabel = document.createElement("label");
  networksLabel.innerText = "Available networks: ";
  networksLabel.htmlFor = "networks-select";

  var networksSelect = document.createElement("select");
  networksSelect.id = "networks-select";
  newConTbl.appendChild(generateRow(networksLabel, networksSelect));

  var networkPassLabel = document.createElement('label');
  networkPassLabel.htmlFor = 'network-pass';
  networkPassLabel.innerText = 'Password: ';

  var networkPassInput = document.createElement('input');
  networkPassInput.type = 'password';
  networkPassInput.id = 'network-pass';

  newConTbl.appendChild(generateRow(networkPassLabel, networkPassInput));
  newConnectionSet.appendChild(newConTbl);
  //newConnectionSet.appendChild(document.createElement('br'));

  var connectBtn = createButton("Connect");
  connectBtn.onclick = function(){
    if(!networksSelect.value){
      connectingStatus.innerText = "Select a network first.";
      return;
    }
    connectBtn.disabled = true;
    connectingStatus.innerText = "Connecting...";
    connectToNewWifi(networksSelect.value, networkPassInput.value).then(function(connectData){
      if(!isCurrent()) return;
      connectBtn.disabled = false;
      connectingStatus.innerText = connectData;
      return getConnectionState().then(function(stateData){
        if(!isCurrent()) return;
        updateConnectionState(stateData);
      });
    });
  }
  newConnectionSet.appendChild(connectBtn);

  var connectingStatus = document.createElement('p');
  connectingStatus.innerText = "";
  newConnectionSet.appendChild(connectingStatus);

  popup.appendChild(networkForm);

  popup.appendChild(document.createElement('br'));

  var closeBtn = createButton("Close");
  closeBtn.onclick = function(){
    wifiManagerGeneration++;
    closePopups();
  };
  popup.appendChild(closeBtn);

  document.body.appendChild(popup);

  closeBtn.focus();

  //Kicked off only once every element a callback might touch has been created. Each of these
  //resolves on a microtask at the earliest now that wifi-manager.js's functions are all async, so
  //there is no risk of one firing before the DOM above exists - but every one still guards on
  //isCurrent(), since the dialog can close (or reopen, bumping the generation) before any of them
  //resolve.
  getWifiStatus().then(function(statData){
    if(!isCurrent()) return;
    updateWifiStatus(statData);
  });
  getIpAddress().then(function(addr){
    if(!isCurrent()) return;
    updateIpDisplay(addr);
  });
  getConnectionState().then(function(stateData){
    if(!isCurrent()) return;
    updateConnectionState(stateData);
  });
  getWifiNetworks().then(function(listData){
    if(!isCurrent()) return;
    updateNetworksList(listData);
  });

  function updateWifiStatus(statData){
    if(statData == 'enabled')
      enableWifiCheck.checked = true;
    else {
      enableWifiCheck.checked = false;
    }
    setNewConnectionEnabled(enableWifiCheck.checked);
  }

  function updateNetworksList(listData){
    removeOptions(networksSelect);
    if(listData && listData.length > 0){
      listData.forEach(function(op, i){
        var txtOp = document.createElement("option");
        txtOp.value = op.ssid;
        txtOp.innerText = op.ssid;
        networksSelect.appendChild(txtOp);
        if(op.isConnected === true){
          networksSelect.selectedIndex = i;
        }
      });
    }

  }

  function updateConnectionState(stateData){
    connectionStateText.innerText = stateData.state;
    connectedNetworkText.innerText = stateData.connection;
  }

  function updateIpDisplay(addr){
    ipDisplay.innerText = addr;
  }

  //Replaces the old setTimeout-recursion updateStateUntilConnected(). isCurrent() is checked at the
  //top of every iteration, which stops the loop from issuing another getConnectionState() call
  //once the dialog is gone, and again right after the await, which stops a call already in flight
  //when Close was clicked from writing its result into a dialog nobody can see any more - both are
  //independently mutation-tested (see wifi-manager_display.test.js), since dropping either one
  //alone leaves the other still passing.
  async function pollUntilConnected(){
    while(isCurrent()){
      var stateData = await getConnectionState();
      if(!isCurrent()) return;

      if(stateData.state == 'connected'){
        updateConnectionState(stateData);
        return;
      }

      await delay(250);
    }
  }
}

module.exports = showWifiManager;
