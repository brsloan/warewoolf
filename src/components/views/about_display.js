const { closePopups, createButton, removeElementsByClass, describeDialog } = require('../controllers/utils');
const { getUpdates, downloadUpdate, startWindowsUpdate, finishWindowsUpdate } = require('../controllers/updates');
const { logError } = require('../controllers/error-log');
const showInstallUpdate = require('./install-update_display');
const { createPlatform } = require('../controllers/platform');
const { createIpcBacking } = require('../controllers/platform-ipc');

//platformInfo (platform.getPlatform()'s own shape, resolved once at boot - see render.js) replaces
//the direct `process.platform` read the Download handler used to do below - the last of the two
//Group A reads this file's own note in native-command-inventory.md left deferred to Phase 8 (the
//other, updates.js's own asset-matching, closed the same way in updates.js itself).
//
//confirmBeforeContinuing is render.js's own proceedOrConfirmSave: the same "you have unsaved
//changes - save first?" check exit-app-clicked already runs, threaded in so Restart To Finish can
//run it before calling finishWindowsUpdate() rather than discarding unsaved work the way calling
//quitAndInstallUpdate directly from this button would.
function showAbout(appVersion, platformInfo, confirmBeforeContinuing){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var popupTitle = document.createElement('h1');
  popupTitle.innerText = 'About';
  popup.appendChild(popupTitle);
  describeDialog(popup, popupTitle);

  var logo = document.createElement('img');
  logo.src = "assets/logo.png";
  logo.classList.add('logo');
  logo.alt = 'WareWoolf logo';
  popup.appendChild(logo);

  var version = document.createElement('h1');
  version.innerText = appVersion;
  version.classList.add('about-version');
  popup.appendChild(version);

  var wwLink = document.createElement('a');
  wwLink.innerText = "WareWoolf.org";
  wwLink.classList.add('about-url');
  popup.appendChild(wwLink);

  var descr = document.createElement('p');
  descr.innerText = "WareWoolf is free, open source software released under an MIT license.";
  popup.appendChild(descr);

  var checkUpdatesBtn = createButton('Check For Updates');
  popup.appendChild(checkUpdatesBtn);

  var displayLicBtn = createButton('View License');
  popup.appendChild(displayLicBtn);

  var updatesPanel = document.createElement('div');
  updatesPanel.classList.add('updates-panel');
  updatesPanel.style.display = 'none';

  var updatesTitle = document.createElement('label');
  updatesPanel.appendChild(updatesTitle);

  var downloadBtn = createButton('Download');
  updatesPanel.appendChild(downloadBtn);

  var updatesText = document.createElement('p');
  updatesText.classList.add('updates-text');
  updatesPanel.appendChild(updatesText);

  //Its own line rather than more text in updatesText, so the release notes stay readable while the
  //writer waits - waiting is exactly when someone is most likely to read them. Empty except while
  //a Windows download is in flight.
  var updatesStatus = document.createElement('p');
  updatesStatus.classList.add('updates-status');
  updatesPanel.appendChild(updatesStatus);

  popup.appendChild(updatesPanel);

  checkUpdatesBtn.onclick = function(){
    checkUpdatesBtn.disabled = true;
    checkUpdatesBtn.innerText = 'Checking...';
    getUpdates(appVersion, function(latest, err){
      console.log('gotten updates');
      console.log(latest);
      if(err){
        checkUpdatesBtn.innerText = 'Update Check Failed';
        checkUpdatesBtn.disabled = false;
      }
      else if(latest){
        updatesTitle.innerText = 'WareWoolf ' + latest.tag + ' Available: ';
        updatesText.innerText = 'Published ' + latest.date.slice(0,10) + ':\n' + latest.description;
        updatesPanel.style.display = 'block';
        checkUpdatesBtn.innerText = 'Updates Available!';

        if(platformInfo.platform == 'win32')
          downloadBtn.innerText = 'Install Update';

        //Falls back to the manual downloadUpdate path both on its own (the else branch, for
        //linux/mac) and as what a failed Windows install-in-place drops the writer into - the
        //happy path is not the only one, per the plan this implements.
        function useManualDownload(){
          downloadBtn.innerText = 'Downloading...';
          downloadBtn.disabled = true;
          downloadUpdate(latest.downloadInfo, function(fpath){
            downloadBtn.innerText = "Downloaded Into Downloads Folder";
          });
        }

        downloadBtn.onclick = function(){
          if(platformInfo.platform == 'linux'){
            downloadBtn.innerText = 'Downloading...';
            downloadBtn.disabled = true;
            downloadUpdate(latest.downloadInfo, showInstallUpdate);
          }
          else if(platformInfo.platform == 'win32'){
            downloadBtn.disabled = true;
            //No download-progress event exists on Electron's built-in autoUpdater, so there is
            //nothing to put in a progress bar - be honest about the wait rather than pretend one.
            downloadBtn.innerText = 'Downloading update...';
            updatesStatus.innerText = 'This can take several minutes on a slow connection. WareWoolf will say when it is ready.';

            var stopTicker = startStillWorkingTicker(updatesStatus);

            startWindowsUpdate(latest.tag, function(){
              stopTicker();
              updatesStatus.innerText = '';
              downloadBtn.disabled = false;
              downloadBtn.innerText = 'Restart To Finish';
              updatesText.innerText = 'Update ready.';
              downloadBtn.onclick = function(){
                confirmBeforeContinuing(finishWindowsUpdate);
              };
            }, function(message){
              stopTicker();
              updatesStatus.innerText = '';
              downloadBtn.disabled = false;
              downloadBtn.innerText = 'Download Installer';
              updatesText.innerText = message + '\nYou can install it yourself instead.';
              downloadBtn.onclick = useManualDownload;
            });
          }
          else
            useManualDownload();
        }
        downloadBtn.focus();
      }
      else {
        checkUpdatesBtn.innerText = 'No Updates Available';
        checkUpdatesBtn.disabled = false;
      }
    });
  }

  var licensePanel = document.createElement('div');
  licensePanel.style.display = "none";

  var licenseText = document.createElement('pre');
  licenseText.tabIndex = 0;

  licensePanel.appendChild(licenseText);

  popup.appendChild(licensePanel);

  //Loaded on demand rather than up front, now that reading it goes through the platform facade -
  //this keeps showAbout() itself synchronous, so the rest of the popup (version, links, Check For
  //Updates) still renders in one pass with nothing to await.
  displayLicBtn.onclick = async function(){
    licenseText.innerText = await loadLicenseText();
    licensePanel.style.display = "block";
    licenseText.focus();
  }

  var close = createButton("Close");
  close.onclick = function(){
    closePopups();
  };
  popup.appendChild(close);

  document.body.appendChild(popup);
  close.focus();
}

//How often the "still working" line updates while a Windows update downloads. Short enough that a
//writer who glances up sees it move, long enough not to be a flicker they have to sit next to.
var STILL_WORKING_TICK_MS = 15000;

//The one thing that can tell a writer the app has not frozen, given there is no progress to show:
//something on screen that keeps changing. Elapsed time is the honest version of that - it claims
//nothing about how far along a 163MB download is, only that WareWoolf is still waiting on it.
//
//Stops itself once its element leaves the document. A writer who closes About mid-download would
//otherwise leave this interval writing to a node nobody can see, forever; there is no close hook
//here to hang a clearInterval on, and checking isConnected covers closePopups(), Escape and every
//other route out of the popup at once, rather than one of them.
function startStillWorkingTicker(element){
  var startedAt = Date.now();

  var ticker = setInterval(function(){
    if(!element.isConnected){
      clearInterval(ticker);
      return;
    }

    element.innerText = 'Still downloading - ' + describeElapsed(Date.now() - startedAt) + ' so far.';
  }, STILL_WORKING_TICK_MS);

  return function(){
    clearInterval(ticker);
  };
}

//Minutes *and* seconds past the first minute, deliberately: rounded to whole minutes the line would
//stop changing for four ticks at a stretch, which is the one thing it exists not to do.
function describeElapsed(ms){
  var seconds = Math.floor(ms / 1000);
  var minutes = Math.floor(seconds / 60);
  var remainder = seconds % 60;

  if(minutes === 0)
    return countOf(seconds, 'second');
  if(remainder === 0)
    return countOf(minutes, 'minute');

  return countOf(minutes, 'minute') + ' ' + countOf(remainder, 'second');
}

function countOf(count, noun){
  return count + ' ' + noun + (count === 1 ? '' : 's');
}

//readLicenses used to need paths.app wired in, which is why this took sysDirectories. The main
//process owns that path now, so the argument is gone - and as of Phase 9c so is showAbout()'s own
//sysDirectories parameter, which outlived it only because downloadUpdate still composed the update
//asset's destination path here. That path is the backing's to choose now (see updates.js), so this
//view no longer names a filesystem location at all.
async function loadLicenseText(){
  try {
    var platform = createPlatform(createIpcBacking());
    return await platform.readLicenses();
  }
  catch(err){
    logError(err);
    return '';
  }
}

module.exports = showAbout;