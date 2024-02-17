function showNetworkManager(){

  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var header = document.createElement('h1');
  header.innerText = "Wifi Manager";
  popup.appendChild(header);

  var connectedNetworkLabel = document.createElement('label');
  connectedNetworkLabel.innerText = "Network: ";
  popup.appendChild(connectedNetworkLabel);

  var connectedNetworkText = document.createElement('label');
  connectedNetworkText.innerText = "checking...";
  popup.appendChild(connectedNetworkText);

  popup.appendChild(document.createElement('br'));

  var connectionStateLabel = document.createElement('label');
  connectionStateLabel.innerText = "State: ";
  popup.appendChild(connectionStateLabel);

  var connectionStateText = document.createElement('label');
  connectionStateText.innerText = "checking...";
  popup.appendChild(connectionStateText);
  getConnectionState(updateConnectionState);

  popup.appendChild(document.createElement('br'));

  var networkForm = document.createElement('form');

  var enableWifiLabel = document.createElement('label');
  enableWifiLabel.innerText = "Enable Wifi?";
  enableWifiLabel.for = 'enable-wifi-check';
  networkForm.appendChild(enableWifiLabel);

  var enableWifiCheck = document.createElement('input');
  enableWifiCheck.type = 'checkbox';
  enableWifiCheck.id = 'enable-wifi-check';
  networkForm.appendChild(enableWifiCheck);
  enableWifiCheck.onclick = function(){
    if(enableWifiCheck.checked){
      enableWifi(alertWifiEnabled);
    }
    else {
      disableWifi(alertWifiDisabled);
    }
  }
  getWifiStatus(updateWifiStatus);

  networkForm.appendChild(document.createElement('br'));

  var newConnectionSet = document.createElement("fieldset");
  networkForm.appendChild(newConnectionSet);

  var newConnectionLegend = document.createElement("legend");
  newConnectionLegend.innerText = "New Connection";
  newConnectionSet.appendChild(newConnectionLegend);

  var networksLabel = document.createElement("label");
  networksLabel.innerText = "Available networks: ";
  networksLabel.for = "networks-select";
  newConnectionSet.appendChild(networksLabel);

  var networksSelect = document.createElement("select");
  newConnectionSet.appendChild(networksSelect);
  getWifiNetworks(updateNetworksList);

  newConnectionSet.appendChild(document.createElement('br'));

  var networkPassLabel = document.createElement('label');
  networkPassLabel.for = 'network-pass';
  networkPassLabel.innerText = 'Password: ';
  newConnectionSet.appendChild(networkPassLabel);

  var networkPassInput = document.createElement('input');
  networkPassInput.type = 'password';
  networkPassInput.id = 'network-pass';
  newConnectionSet.appendChild(networkPassInput);

  newConnectionSet.appendChild(document.createElement('br'));

  var connectBtn = createButton("Connect");
  connectBtn.onclick = function(){
    connectingStatus.innerText = "Connecting...";
    connectToNewWifi(networksSelect.value, networkPassInput.value, alertNewConnection);
  }
  newConnectionSet.appendChild(connectBtn);

  var connectingStatus = document.createElement('p');
  connectingStatus.innerText = "";
  newConnectionSet.appendChild(connectingStatus);

  popup.appendChild(networkForm);

  popup.appendChild(document.createElement('br'));

  var closeBtn = createButton("Close");
  closeBtn.onclick = function(){
    closePopups();
  };
  popup.appendChild(closeBtn);

  document.body.appendChild(popup);

  closeBtn.focus();

  function updateWifiStatus(statData){
    if(statData == 'enabled')
      enableWifiCheck.checked = true;
    else {
      enableWifiCheck.checked = false;
    }
  }

  function updateNetworksList(listData){
    removeOptions(networksSelect);
    if(listData && listData.length > 0){
      listData.forEach(function(op, i){
        var txtOp = document.createElement("option");
        txtOp.value = op.SSID;
        txtOp.innerText = op.SSID;
        networksSelect.appendChild(txtOp);
        if(op.inUseBoolean === true){
          networksSelect.selectedIndex = i;
        }
      });
    }

  }

  function updateConnectionState(stateData){
    connectionStateText.innerText = stateData[0].state;
    connectedNetworkText.innerText = stateData[0].connection;
  }

  function updateStateUntilConnected(stateData){
    if(stateData[0].state == 'connected'){
      connectionStateText.innerText = stateData[0].state;
      connectedNetworkText.innerText = stateData[0].connection;
    }
    else {
      setTimeout(function(){
        getConnectionState(updateStateUntilConnected);
      }, 250);
    }
  }

  function alertWifiEnabled(msg){
    setTimeout(function(){
      getConnectionState(updateStateUntilConnected);
    }, 500);
  }

  function alertWifiDisabled(msg){
    getConnectionState(updateConnectionState);
  }

  function alertNewConnection(connectData){
    connectingStatus.innerText = connectData;
    getConnectionState(updateConnectionState);
  }
}
