function requestProjectTitle(project, callback){
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var popupTitle = document.createElement('h1');
  popupTitle.innerText = 'New Project';
  popup.appendChild(popupTitle);

  var titleForm = document.createElement("form");

  var message = document.createElement("label");
  message.innerText = "Title:";
  message.for = "title-input";
  titleForm.appendChild(message);

  titleForm.appendChild(document.createElement('br'));

  var titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.placeholder = "Mrs. Dalloway 2: Back In Action";
  titleInput.id = "title-input";
  titleForm.appendChild(titleInput);

  var novelRadio = document.createElement('input');
  novelRadio.type = 'radio';
  novelRadio.id = 'novel-radio';
  novelRadio.name = 'project-type';
  novelRadio.value = 'novel';
  novelRadio.checked = !project.screenplay;
  titleForm.appendChild(novelRadio);
  var novelLabel = document.createElement('label');
  novelLabel.innerText = 'Novel';
  novelLabel.for = 'novel-radio';
  titleForm.appendChild(novelLabel);

  var screenplayRadio = document.createElement('input');
  screenplayRadio.type = 'radio';
  screenplayRadio.id = 'screenplay-radio';
  screenplayRadio.name = 'project-type';
  screenplayRadio.value = 'screenplay';
  screenplayRadio.checked = project.screenplay;
  titleForm.appendChild(screenplayRadio);
  var screenplayLabel = document.createElement('label');
  screenplayLabel.innerText = 'Screenplay';
  screenplayLabel.for = 'screenplay-radio';
  titleForm.appendChild(screenplayLabel);

  titleForm.appendChild(document.createElement('br'));

  var createButton = document.createElement("input");
  createButton.type = "submit";
  createButton.value = "Create"
  titleForm.onsubmit = function(e){
    e.preventDefault();

    var title;
    if(titleInput.value != "")
      title = titleInput.value;
    else
      title = "New Project";
    popup.remove();
    callback(title, screenplayRadio.checked);
  }

  titleForm.appendChild(createButton);
  popup.appendChild(titleForm);
  document.body.appendChild(popup);
  titleInput.focus();
}

module.exports = requestProjectTitle;