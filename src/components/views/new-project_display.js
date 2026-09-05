const { closePopups, createButton, removeElementsByClass } = require('../controllers/utils');

function requestProjectTitle(callback){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var popupTitle = document.createElement('h1');
  popupTitle.innerText = 'New Project';
  popup.appendChild(popupTitle);

  var titleForm = document.createElement("form");

  var message = document.createElement("label");
  message.innerText = "What is the title of this project?";
  message.htmlFor = "title-input";
  titleForm.appendChild(message);

  titleForm.appendChild(document.createElement('br'));

  var titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.placeholder = "Mrs. Dalloway 2: Back In Action";
  titleInput.id = "title-input";
  titleForm.appendChild(titleInput);

  var createSubmit = document.createElement("input");
  createSubmit.type = "submit";
  createSubmit.value = "Create"
  titleForm.onsubmit = function(e){
    e.preventDefault();

    var title;
    if(titleInput.value.trim() != "")
      title = titleInput.value.trim();
    else
      title = "New Project";
    closePopups();
    callback(title);
  }

  titleForm.appendChild(createSubmit);

  var cancel = createButton("Cancel");
  cancel.onclick = function(){
    closePopups();
  };
  titleForm.appendChild(cancel);

  popup.appendChild(titleForm);
  document.body.appendChild(popup);
  titleInput.focus();
}

module.exports = requestProjectTitle;