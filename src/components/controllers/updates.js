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

//The legacy mac build is a second, permanently-older lineage. Electron 44 needs macOS 13 Ventura,
//so every mac between 10.15 Catalina and 12 Monterey gets its own asset, built from this same
//source against a pinned Electron 32 (the last line that runs on Catalina). Both lineages ship
//this same file, so a running build has to sort itself onto the right track.
//
//What identifies it is the Electron it was packaged against, not the host OS: the legacy build
//runs fine on a new mac - under Rosetta on Apple Silicon, where process.arch reports x64 like any
//other Intel build - and when it does it must keep following the legacy asset rather than jumping
//to a mainline one its Electron predates.
//
//The legacy asset's name deliberately shares no substring with 'MacOS_Intel'. The find() below
//takes the first name that merely *includes* binType, so calling it MacOS_Intel_Legacy would hand
//it to modern Intel users - or hand them the mainline build on Catalina, where it cannot launch -
//depending on nothing more than the order the GitHub API happens to list assets in. That is the
//same collision release.yml already avoids by naming the Apple Silicon asset 'AppleSilicon'
//rather than 'arm64'.
var LEGACY_MACOS_ELECTRON_MAJOR = 32;

function isLegacyMacBuild(electronVersion){
    if(!electronVersion)
        return false;

    var major = parseInt(String(electronVersion).split('.')[0], 10);

    return !isNaN(major) && major <= LEGACY_MACOS_ELECTRON_MAJOR;
}

//Windows has the same two-lineage problem macOS does just above, arriving from the other direction.
//There, one source is packaged twice and a running build has to sort itself onto the track its own
//Electron belongs to. Here, one package is *distributed* twice - the Squirrel installer and a
//portable zip - and a running copy has to stay on the track it was installed along. Handing a
//portable copy the installer turns it into an installed one somewhere else on the disk, leaving the
//folder the writer is running out of untouched and stale; handing an installed copy the portable zip
//gives it a second WareWoolf in its Downloads folder and leaves the installed one behind.
//
//'Windows_Portable_x64' and 'Windows_x64' are each chosen so neither contains the other, for the
//same find()-over-includes() reason MacOS_Legacy shares no substring with MacOS_Intel. release.yml
//asserts that of the built asset names on every release, and updates.test.js of the names
//themselves.
function canUpdateInPlace(platformInfo){
    return platformInfo != null && platformInfo.platform == 'win32'
        && platformInfo.windowsInstall == 'squirrel';
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
            binType = platformInfo.windowsInstall == 'portable' ? 'Windows_Portable_x64' : 'Windows_x64';
    }
    else if(platformInfo.platform == 'darwin'){
        if(platformInfo.arch == 'x64'){
            if(isLegacyMacBuild(platformInfo.electron))
                binType = 'MacOS_Legacy';
            else
                binType = 'MacOS_Intel';
        }
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

//Phase 9c: sysDirectories is gone from this function's signature, and that removal is the point
//rather than a tidy-up. This is where the destination path used to be composed - temp on linux,
//downloads elsewhere - and a path composed here is a path the renderer chose, which is exactly what
//made installUpdate's vouch forgeable once the renderer became untrusted at Phase 9b. The native
//command picks the directory now (same platform split, decided on the far side) and reports back a
//path this file could not have produced; all that crosses outbound is the asset URL, which the
//backing checks against the project's own releases prefix before fetching anything.
//
//downloadInfo/callback are otherwise unchanged, and the extra getPlatform() round trip this used to
//need for the temp-vs-downloads decision is gone with it.
//onFail is optional and new, and it exists because the two returns below used to leave the caller
//waiting forever: about_display.js disables its button and sets it to "Downloading..." before
//calling, so a download that ends by logging and returning left a writer watching a dead button with
//no way to find out why. Reachable whenever a release carries no asset this copy can use - a legacy
//mac build looking at a release older than that lineage, or a portable Windows copy looking at one
//older than the portable zip (v2.5.0 and earlier) - and reachable on any network error.
function downloadUpdate(downloadInfo, callback, onFail){
    function fail(err){
        logError(err);
        if(typeof onFail === 'function')
            onFail(err.message);
    }

    if(!downloadInfo){
        fail(new Error('This release has no download for your platform. Please download it yourself from the releases page.'));
        return;
    }

    platform.downloadUpdate({ url: downloadInfo.url }).then(function(result){
        callback(result.path);
    }).catch(fail);
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

//Windows' happy path: subscribe to both outcome events, start the Squirrel check, and unsubscribe
//as soon as either one fires - a writer who clicks Install, hits an error, and clicks again must
//not end up with two live listeners. test/fake-bridge.js's listenerCount exists to catch exactly
//that leak.
function startWindowsUpdate(tag, onDownloaded, onFailed){
    var unsubscribeDownloaded, unsubscribeFailed;

    function cleanUp(){
        unsubscribeDownloaded();
        unsubscribeFailed();
    }

    unsubscribeDownloaded = platform.on('app-update-downloaded', function(){
        cleanUp();
        onDownloaded();
    });
    unsubscribeFailed = platform.on('app-update-failed', function(message){
        cleanUp();
        onFailed(message);
    });

    platform.startSquirrelUpdate({ tag: tag }).catch(function(err){
        cleanUp();
        logError(err);
        onFailed(err.message);
    });
}

//The Restart button's other half, once the caller's own unsaved-work check has run.
function finishWindowsUpdate(){
    platform.quitAndInstallUpdate().catch(function(err){
        logError(err);
    });
}

module.exports = {
    getUpdates,
    canUpdateInPlace,
    downloadUpdate,
    installUpdate,
    startWindowsUpdate,
    finishWindowsUpdate
};
