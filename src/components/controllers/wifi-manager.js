const { spawn } = require("child_process");
const { logError } = require('./error-log');
const { createPlatform } = require('./platform');
const { createNodeBacking } = require('./platform-node');

//wifiListNetworks/wifiConnect/wifiGetAddress (group K) take no injected config, so this holds its
//own standing instance, the same reason file-manager.js/corkboard.js/epub.js do. Only three of this
//file's seven functions have a contract command behind them - getConnectionState, getWifiStatus,
//enableWifi and disableWifi have no group K equivalent (see the note above each, and the inventory
//and plan docs' Phase 8 write-up) and still spawn nmcli directly below, unconverted.
var platform = createPlatform(createNodeBacking({}));

//nmcli's -t (terse) output escapes literal ':' and '\' inside a field as '\:' and '\\',
//so a plain split(':') misaligns fields whenever a value (e.g. an SSID) contains a colon.
//platform-node.js keeps its own copy of this for wifiListNetworks' own parsing - the two are
//independent on purpose, so this file staying unconverted for four functions never puts a
//dependency on internals the facade does not expose.
function splitNmcliFields(line){
  return line.split(/(?<!\\):/).map(function(field){
    return field.replace(/\\(.)/g, '$1');
  });
}

//Logging is skipped for UNAVAILABLE specifically - nmcli/hostname simply not being installed is
//the ordinary case on every machine that isn't a writerDeck, and this dialog gets opened by anyone
//who clicks Wi-Fi Manager, not only on a Pi. A genuine failure (IO_ERROR and the rest) still logs.
function reportUnlessUnavailable(err){
  if(err == null || err.code !== 'UNAVAILABLE')
    logError(err);
}

function getIpAddress(cback){
  platform.wifiGetAddress().then(function(address){
    cback(address || 'no data');
  }).catch(function(err){
    reportUnlessUnavailable(err);
    cback('no data');
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
  platform.wifiListNetworks().then(cback).catch(function(err){
    reportUnlessUnavailable(err);
    cback([]);
  });
}

function disableWifi(cback){
  nmcliSingle(['radio', 'wifi', 'off'], cback);
};

function enableWifi(cback){
  nmcliSingle(['radio', 'wifi', 'on'], cback);
}

function connectToNewWifi(ssidString, passString, cback){
  platform.wifiConnect({ ssid: ssidString, psk: passString }).then(function(){
    cback('Connected.');
  }).catch(function(err){
    reportUnlessUnavailable(err);
    cback(err.message);
  });
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