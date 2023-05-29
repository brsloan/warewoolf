function showAbout(){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var logo = document.createElement('img');
  logo.src = "assets/logo.png";
  logo.classList.add('logo');
  popup.appendChild(logo);

  var version = document.createElement('h1');
  version.innerText = "0.9.0";
  popup.appendChild(version);

  var descr = document.createElement('p');
  descr.innerText = "WareWoolf is open source software.";
  popup.appendChild(descr);

  var githubLink = document.createElement('p');
  githubLink.innerText = "github.com/brsloan/warewoolf";
  popup.appendChild(githubLink);

  var wwLink = document.createElement('a');
  wwLink.innerText = "WareWoolf.org";
  popup.appendChild(wwLink);

  var close = createButton("Close");
  close.onclick = function(){
    closePopups();
  };
  popup.appendChild(close);

  document.body.appendChild(popup);
  close.focus();
}
