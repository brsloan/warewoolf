function showAbout(sysDirectories, appVersion){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var logo = document.createElement('img');
  logo.src = "assets/logo.png";
  logo.classList.add('logo');
  popup.appendChild(logo);

  var version = document.createElement('h1');
  version.innerText = appVersion;
  popup.appendChild(version);

  var descr = document.createElement('p');
  descr.innerText = "WareWoolf is free, open source software released under an MIT license.";
  popup.appendChild(descr);

  var githubLink = document.createElement('p');
  githubLink.innerText = "github.com/brsloan/warewoolf";
  popup.appendChild(githubLink);

  var wwLink = document.createElement('a');
  wwLink.innerText = "WareWoolf.org";
  popup.appendChild(wwLink);

  var displayLicBtn = createButton('View License');
  popup.appendChild(displayLicBtn);

  var licensePanel = document.createElement('div');
  licensePanel.style.display = "none";

  var licenseText = document.createElement('pre');
  licenseText.innerText = loadLicenseText(sysDirectories.app + '/licenses.txt');
  licenseText.tabIndex = 0;

  licensePanel.appendChild(licenseText);

  popup.appendChild(licensePanel);

  displayLicBtn.onclick = function(){
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

function loadLicenseText(licensesPath){
  //var licenseLocation = 'licenses.txt';
  var licenseText = '';

  try {
    if(fs.existsSync(licensesPath)){
      licenseText = fs.readFileSync(licensesPath, "utf8");
    }
  }
  catch(err){
    logError(err);
  }

  return licenseText;
}
