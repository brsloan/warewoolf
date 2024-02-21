const { spawn } = require("child_process");

function getConnectionState(cback){
  const args = ["-t", "device", "status"];

  nmcliMulti(args, function(body){
    var statusData = body.split('\n');
    var wifiDataLine = statusData.find(function(line, index, arr){
      return line.split(':')[1] == 'wifi';
    });
    var splitData = wifiDataLine.split(':');

    cback({state: splitData[2], connection: splitData[3]});
  });
}

function nmcliMulti(args, cback){
  const nmcli = spawn('nmcli', args);
  var body = [];
  nmcli.stdout.on('data', function(data){
    body.push(data);
  });

  nmcli.stderr.on('data', function(data){
    logError(data.toString());
  });

  nmcli.on('close', function(code){
    cback(body.join());
  });
}

function nmcliSingle(args, cback){
  const nmcli = spawn('nmcli', args);

  var responseHasData = false;

  nmcli.stdout.on('data', function(data){
    responseHasData = true;
    cback(data.toString().trim());
  });

  nmcli.stderr.on('data', function(data){
    logError(data.toString().trim());
  })

  nmcli.stdout.on('close', function(code){
    if(!responseHasData)
      cback('no data');
  });
}

function getWifiStatus(cback){
  nmcliSingle(['radio', 'wifi'], cback);
}

function getWifiNetworks(cback){
  nmcliMulti(["-t", "device", "wifi", "list", "--rescan", "yes"], function(body){
    var dataLines = body.split('\n');

    var connections = dataLines.map(function(line, index, arr){
      var splitLine = line.split(':');
      return {
        ssid: splitLine[7],
        isConnected: splitLine[0] == '*'
      }
    }).filter(function(obj, index, arr){
      return obj.ssid && obj.ssid != "";
    });

    cback(connections);
  });
}

function disableWifi(cback){
  nmcliSingle(['radio', 'wifi', 'off'], cback);
};

function enableWifi(cback){
  nmcliSingle(['radio', 'wifi', 'on'], cback);
}

function connectToNewWifi(ssidString, passString, cback){
  nmcliSingle(['device','wifi','connect', ssidString, 'password', passString], cback);
}
