function showWifiManager(){

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
  enableWifiLabel.for = 'enable-wifi-check';

  var enableWifiCheck = document.createElement('input');
  enableWifiCheck.type = 'checkbox';
  enableWifiCheck.id = 'enable-wifi-check';

  networkTbl.appendChild(generateRow(enableWifiLabel, enableWifiCheck));
  enableWifiCheck.onclick = function(){
    if(enableWifiCheck.checked){
      enableWifi(alertWifiEnabled);
    }
    else {
      disableWifi(alertWifiDisabled);
    }
  }
  getWifiStatus(updateWifiStatus);

  var connectionStateLabel = document.createElement('label');
  connectionStateLabel.innerText = "State: ";

  var connectionStateText = document.createElement('label');
  connectionStateText.innerText = "checking...";

  networkTbl.appendChild(generateRow(connectionStateLabel, connectionStateText));
  getConnectionState(updateConnectionState);

  var connectedNetworkLabel = document.createElement('label');
  connectedNetworkLabel.innerText = "Network: ";

  var connectedNetworkText = document.createElement('label');
  connectedNetworkText.innerText = "checking...";

  networkTbl.appendChild(generateRow(connectedNetworkLabel, connectedNetworkText));

  networkForm.appendChild(networkTbl);

  var newConnectionSet = document.createElement("fieldset");
  networkForm.appendChild(newConnectionSet);

  var newConnectionLegend = document.createElement("legend");
  newConnectionLegend.innerText = "New Connection";
  newConnectionSet.appendChild(newConnectionLegend);

  var newConTbl = document.createElement('table');

  var networksLabel = document.createElement("label");
  networksLabel.innerText = "Available networks: ";
  networksLabel.for = "networks-select";

  var networksSelect = document.createElement("select");
  newConTbl.appendChild(generateRow(networksLabel, networksSelect));

  getWifiNetworks(updateNetworksList);

  var networkPassLabel = document.createElement('label');
  networkPassLabel.for = 'network-pass';
  networkPassLabel.innerText = 'Password: ';

  var networkPassInput = document.createElement('input');
  networkPassInput.type = 'password';
  networkPassInput.id = 'network-pass';

  newConTbl.appendChild(generateRow(networkPassLabel, networkPassInput));
  newConnectionSet.appendChild(newConTbl);
  //newConnectionSet.appendChild(document.createElement('br'));

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

  function updateStateUntilConnected(stateData){
    if(stateData.state == 'connected'){
      connectionStateText.innerText = stateData.state;
      connectedNetworkText.innerText = stateData.connection;
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
