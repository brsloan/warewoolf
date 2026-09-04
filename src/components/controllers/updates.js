const https = require('https');
const fs = require('node:fs');
const { logError } = require('./error-log');
const process = require('node:process');
const { spawn } = require('node:child_process');

function getUpdates(thisAppVersion, callback){
    fetchLatestReleaseData(function(latest){
        if(!latest){
            callback(null);
            return;
        }

        if(isUpdateAvailable(latest.tag, thisAppVersion)){
            latest.downloadInfo = extractUpdateDownloadInfo(latest);
            callback(latest);
        }
        else
            callback(null);
    });
}

function fetchLatestReleaseData(callback){

    const options = {
        hostname: 'api.github.com',
        path: '/repos/brsloan/warewoolf/releases/latest',
        method: 'GET',
        headers: {
            'User-Agent': 'warewoolf'
        },
        timeout: 10000
    };

    const req = https.request(options, function(res){
        let data = '';

        res.on('data', function(chunk){
            data += chunk;
        });

        res.on('end', function(){
            if(res.statusCode !== 200){
                logError(new Error('GitHub release check failed with status ' + res.statusCode + ': ' + data));
                callback(null);
                return;
            }

            var parsed;
            try {
                parsed = JSON.parse(data);
            }
            catch(err){
                logError(err);
                callback(null);
                return;
            }

            var packagedData = packageReleaseData(parsed);

            if(!packagedData){
                logError(new Error('Unexpected release data shape from GitHub API'));
                callback(null);
                return;
            }

            callback(packagedData);
        });

    });

    req.on('timeout', function(){
        req.destroy(new Error('Update check timed out'));
    });

    req.on('error', function(err){
        logError(err);
        callback(null);
    });

    req.end();
}

function packageReleaseData(releaseData){
    if(!releaseData || !Array.isArray(releaseData.assets))
        return null;

    var packagedData = {
        tag: releaseData.tag_name,
        prerelease: releaseData.prerelease,
        description: releaseData.body,
        date: releaseData.published_at,
        binaries: []
    };

    releaseData.assets.forEach(asset => {
        packagedData.binaries.push({
            name: asset.name,
            url: asset.browser_download_url
        })
    });

    return packagedData;
}

function extractUpdateDownloadInfo(releaseData){

    var binType = 'unsupported';

    if(process.platform == 'linux'){
        if(process.arch == 'x64')
            binType = 'amd64';
        else if(process.arch == 'arm64')
            binType = 'arm64';
    }
    else if(process.platform == 'win32'){
        if(process.arch == 'x64')
            binType = 'Windows_x64';
    }
    else if(process.platform == 'darwin'){
        if(process.arch == 'x64')
            binType = 'MacOS_Intel';
        else if(process.arch == 'arm64')
            binType = 'MacOS_AppleSilicon';
    }

    if(binType == 'unsupported')
        return undefined;

    return releaseData.binaries.find(function(bin){
        return bin.name.includes(binType);
    })
}

function isUpdateAvailable(latestTag, thisAppVersion = '1.0.0'){
    var avail = false;

    var parseVersion = function(tag){
        return tag.replace('v','').split('.').map(function(str){
            return parseInt(str, 10);
        });
    };

    var thisDigits = parseVersion(thisAppVersion);
    var latestDigits = parseVersion(latestTag);

    if(thisDigits.some(isNaN) || latestDigits.some(isNaN))
        return false;

    if(latestDigits[0] > thisDigits[0])
        avail = true;
    else if(latestDigits[0] == thisDigits[0]){
        if(latestDigits[1] > thisDigits[1])
            avail = true;
        else if(latestDigits[1] == thisDigits[1]){
            if(latestDigits[2] > thisDigits[2])
                avail = true;
        }
    }

    return avail;
}

function downloadUpdate(sysDirectories, downloadInfo, callback){
    if(!downloadInfo){
        logError(new Error('No compatible update binary found for this platform/architecture.'));
        return;
    }

    var filePath = '';

    if(process.platform == 'linux')
      filePath = sysDirectories.temp + '/' + downloadInfo.name;
    else {
      filePath = sysDirectories.downloads + '/' + downloadInfo.name;
    }

    if(fs.existsSync(filePath)){
      console.log('File already downloaded.');
      callback(filePath);
    }
    else {

      console.log('commence downloading at: ' + downloadInfo.url + ' to ' + filePath);

      const file = fs.createWriteStream(filePath);

      file.on('finish', function(){
          console.log("finished download: " + filePath);
          callback(filePath);
      });

      downloadRequest(file, filePath, downloadInfo.url);
    }
}

function downloadRequest(file, filePath, url){
    const request = https.get(url, response => {
        if(response.statusCode == 302){
            response.resume();
            downloadRequest(file, filePath, response.headers.location);
            return;
        }

        if(response.statusCode !== 200){
            response.resume();
            file.destroy();
            fs.unlink(filePath, () => {
                logError(new Error('Download failed: ' + response.statusCode));
            });
            return;
        }

        response.pipe(file);
    });

    request.on('error', function(err){
        file.destroy();
        fs.unlink(filePath, function(){
            logError(err);
        })
    });

    file.on('error', function(err){
        fs.unlink(filePath, function(){
            logError(err);
        })
    });


    request.end();
}

function installUpdate(pass, filePath, statusElement){

  const updater = spawn('sudo', ['-S', 'apt', 'install', filePath], {
    stdio: 'pipe'
  });

  updater.stdin.write(pass + '\n');
  updater.stdin.end();

  updater.stdout.on('data', function(data){
    console.log('updater: ' + data);
    statusElement.innerText = data;
  });

  updater.stderr.on('data', function(data){
    console.log('updater error: ' + data);
    statusElement.innerText = 'Error: ' + data;
  });

  updater.on('close', function(data){
    console.log('updater closed');
    statusElement.innerText += '\nInstallation Finished! Reboot to complete.';
  })

}

module.exports = {
    getUpdates,
    downloadUpdate,
    installUpdate
};
