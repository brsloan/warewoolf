function showErrorLog(){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var errorLogTextBox = document.createElement("pre");
  errorLogTextBox.innerText = loadErrorLog();
  errorLogTextBox.tabIndex = 1;
  popup.appendChild(errorLogTextBox);

  var closeBtn = createButton("Close");
  closeBtn.onclick = function(){
    closePopups();
  };
  popup.appendChild(closeBtn);

  errorLogTextBox.focus();

  document.body.appendChild(popup);
}

function loadErrorLog(){
  var logLocation = 'error_log.txt';
  try {
    if(fs.existsSync(logLocation)){
      return fs.readFileSync(logLocation, "utf8");
    }
  }
  catch(err){
    logError(err);
  }
}
