const { logError } = require('./error-log');
const { createPlatform } = require('./platform');
const { createIpcBacking } = require('./platform-ipc');

//checkForUpdate/downloadUpdate/installUpdate take no injected config - every argument is already a
//full path/URL, or nothing at all - so this holds its own standing instance, the same reason
//file-manager.js/corkboard.js/epub.js/backup-project.js do.
//
//installUpdate only accepts a path a prior downloadUpdate call vouched for, and before Phase 9a
//that made this file's single shared instance load-bearing: about_display.js's Download button and
//install-update_display.js's Install button call two different exports here, and a fresh backing
//per call would have thrown the vouch away between them. The vouching now lives in the one node
//backing the main process holds, so it is the process boundary keeping the set rather than this
//variable - stronger, since no renderer instance can hold a set at all.
var platform = createPlatform(createIpcBacking());

function getUpdates(thisAppVersion, callback){
    platform.checkForUpdate().then(function(releaseData){
        var packagedData = packageReleaseData(releaseData);

        if(!packagedData){
            var shapeErr = new Error('Unexpected release data shape from GitHub API');
            logError(shapeErr);
            callback(null, shapeErr);
            return;
        }

        if(isUpdateAvailable(packagedData.tag, thisAppVersion)){
            platform.getPlatform().then(function(platformInfo){
                packagedData.downloadInfo = extractUpdateDownloadInfo(packagedData, platformInfo);
                callback(packagedData);
            });
        }
        else
            callback(null);
    }).catch(function(err){
        logError(err);
        callback(null, err);
    });
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

function extractUpdateDownloadInfo(releaseData, platformInfo){

    var binType = 'unsupported';

    if(platformInfo.platform == 'linux'){
        if(platformInfo.arch == 'x64')
            binType = 'amd64';
        else if(platformInfo.arch == 'arm64')
            binType = 'arm64';
    }
    else if(platformInfo.platform == 'win32'){
        if(platformInfo.arch == 'x64')
            binType = 'Windows_x64';
    }
    else if(platformInfo.platform == 'darwin'){
        if(platformInfo.arch == 'x64')
            binType = 'MacOS_Intel';
        else if(platformInfo.arch == 'arm64')
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

//sysDirectories/downloadInfo/callback is unchanged from before this conversion - about_display.js
//needs no changes at all. Only the platform/arch check moved off process.* (deferred to this phase
//since Phase 2 - see native-command-inventory.md's group A note) and the download itself moved
//native, behind platform.downloadUpdate.
function downloadUpdate(sysDirectories, downloadInfo, callback){
    if(!downloadInfo){
        logError(new Error('No compatible update binary found for this platform/architecture.'));
        return;
    }

    platform.getPlatform().then(function(platformInfo){
        var destPath = platformInfo.platform == 'linux'
            ? sysDirectories.temp + '/' + downloadInfo.name
            : sysDirectories.downloads + '/' + downloadInfo.name;

        return platform.downloadUpdate({ url: downloadInfo.url, destPath: destPath });
    }).then(function(result){
        callback(result.path);
    }).catch(function(err){
        logError(err);
    });
}

//pass/filePath/statusElement/onDone is unchanged from before this conversion -
//install-update_display.js needs no changes at all. The live per-chunk stdout/stderr streaming the
//original had is not preserved: piping process output live across the platform boundary would need
//a genuine event (like the 36 in platform.js's own EVENTS list), and those are reserved for real
//Electron main-process channels, cross-checked against index.js by test - grafting a node-backing-
//only event onto that list for one Linux-only dialog was not worth the mismatch it would create.
//statusElement gets a single "Installing..." while the native command runs, then the final result -
//still whatever installUpdate's own stdout/stderr said on failure, via the rejection's message.
function installUpdate(pass, filePath, statusElement, onDone){
    statusElement.innerText = 'Installing...';

    platform.installUpdate({ path: filePath, password: pass }).then(function(){
        statusElement.innerText += '\nInstallation Finished! Reboot to complete.';
        if(typeof onDone === 'function')
            onDone(0);
    }).catch(function(err){
        logError(err);
        var exitCode = err.exitCode != null ? err.exitCode : 1;
        statusElement.innerText += '\n' + err.message;
        if(typeof onDone === 'function')
            onDone(exitCode);
    });
}

module.exports = {
    getUpdates,
    downloadUpdate,
    installUpdate
};
