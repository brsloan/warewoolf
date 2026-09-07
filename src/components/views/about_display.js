const { closePopups, createButton, removeElementsByClass } = require('../controllers/utils');
const { getUpdates, downloadUpdate } = require('../controllers/updates');
const { logError } = require('../controllers/error-log');
const showInstallUpdate = require('./install-update_display');
const { createPlatform } = require('../controllers/platform');
const { createNodeBacking } = require('../controllers/platform-node');

function showAbout(sysDirectories, appVersion){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var popupTitle = document.createElement('h1');
  popupTitle.innerText = 'About';
  popup.appendChild(popupTitle);

  var logo = document.createElement('img');
  logo.src = "assets/logo.png";
  logo.classList.add('logo');
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
        downloadBtn.onclick = function(){
          downloadBtn.innerText = 'Downloading...';
          downloadBtn.disabled = true;
          if(process.platform == 'linux')
            downloadUpdate(sysDirectories, latest.downloadInfo, showInstallUpdate);
          else {
            downloadUpdate(sysDirectories, latest.downloadInfo, function(fpath){
              downloadBtn.innerText = "Downloaded Into Downloads Folder";
            });
          }
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
    licenseText.innerText = await loadLicenseText(sysDirectories);
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

async function loadLicenseText(sysDirectories){
  try {
    var platform = createPlatform(createNodeBacking({ paths: sysDirectories }));
    return await platform.readLicenses();
  }
  catch(err){
    logError(err);
    return '';
  }
}

module.exports = showAbout;