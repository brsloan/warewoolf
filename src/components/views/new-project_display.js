function requestProjectTitle(callback){
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var popupTitle = document.createElement('h1');
  popupTitle.innerText = 'New Project';
  popup.appendChild(popupTitle);

  var titleForm = document.createElement("form");

  var message = document.createElement("label");
  message.innerText = "What is the title of this project?";
  message.for = "title-input";
  titleForm.appendChild(message);

  titleForm.appendChild(document.createElement('br'));

  var titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.placeholder = "Mrs. Dalloway 2: Back In Action";
  titleInput.id = "title-input";
  titleForm.appendChild(titleInput);

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
    callback(title);
  }

  titleForm.appendChild(createButton);
  popup.appendChild(titleForm);
  document.body.appendChild(popup);
  titleInput.focus();
}
