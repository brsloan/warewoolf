const { spawn } = require("child_process");
const { logError } = require('./error-log');

//nmcli's -t (terse) output escapes literal ':' and '\' inside a field as '\:' and '\\',
//so a plain split(':') misaligns fields whenever a value (e.g. an SSID) contains a colon.
function splitNmcliFields(line){
  return line.split(/(?<!\\):/).map(function(field){
    return field.replace(/\\(.)/g, '$1');
  });
}

function getIpAddress(cback){
  const hostname = spawn('hostname', ['-I']);
  var body = [];
  var called = false;

  function finish(result){
    if(called) return;
    called = true;
    cback(result);
  }

  hostname.stdout.on('data', function(data){
    body.push(data);
  });

  hostname.stderr.on('data', function(data){
    logError(data.toString().trim());
  })

  hostname.on('error', function(err){
    logError(err);
    finish('no data');
  });

  hostname.stdout.on('close', function(code){
    var text = Buffer.concat(body).toString().trim().split(' ')[0];
    finish(text || 'no data');
  });
}

function getConnectionState(cback){
  const args = ["-t", "device", "status"];

  nmcliMulti(args, function(body){
    var statusData = body.split('\n');
    var wifiDataLine = statusData.find(function(line, index, arr){
      return splitNmcliFields(line)[1] == 'wifi';
    });

    if(!wifiDataLine){
      cback({state: 'unknown', connection: null});
      return;
    }

    var splitData = splitNmcliFields(wifiDataLine);
    cback({state: splitData[2], connection: splitData[3]});
  });
}

function nmcliMulti(args, cback){
  const nmcli = spawn('nmcli', args);
  var body = [];
  var called = false;

  function finish(result){
    if(called) return;
    called = true;
    cback(result);
  }

  nmcli.stdout.on('data', function(data){
    body.push(data);
  });

  nmcli.stderr.on('data', function(data){
    logError(data.toString());
  });

  nmcli.on('error', function(err){
    logError(err);
    finish('');
  });

  nmcli.on('close', function(code){
    finish(Buffer.concat(body).toString());
  });
}

function nmcliSingle(args, cback){
  const nmcli = spawn('nmcli', args);
  var body = [];
  var called = false;

  function finish(result){
    if(called) return;
    called = true;
    cback(result);
  }

  nmcli.stdout.on('data', function(data){
    body.push(data);
  });

  nmcli.stderr.on('data', function(data){
    logError(data.toString().trim());
  })

  nmcli.on('error', function(err){
    logError(err);
    finish('no data');
  });

  nmcli.on('close', function(code){
    var text = Buffer.concat(body).toString().trim();
    finish(text || 'no data');
  });
}

function getWifiStatus(cback){
  nmcliSingle(['radio', 'wifi'], cback);
}

function getWifiNetworks(cback){
  nmcliMulti(["-t", "device", "wifi", "list", "--rescan", "yes"], function(body){
    var dataLines = body.split('\n');

    var connections = dataLines.map(function(line, index, arr){
      var splitLine = splitNmcliFields(line);
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

module.exports = {
  getConnectionState,
  getWifiStatus,
  getWifiNetworks,
  disableWifi,
  enableWifi,
  connectToNewWifi,
  getIpAddress
}