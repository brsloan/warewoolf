const { closePopups, createButton, removeElementsByClass, describeDialog } = require('../controllers/utils');

function requestProjectTitle(callback, defaultType){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var popupTitle = document.createElement('h1');
  popupTitle.innerText = 'New Project';
  popup.appendChild(popupTitle);
  describeDialog(popup, popupTitle);

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

  titleForm.appendChild(document.createElement('br'));

  //Novel or screenplay - see docs/screenplay-plan.md. A radio group named so a screen reader
  //reads the two as one question, defaulting to the kind of project already open: someone
  //writing a screenplay is likelier to start another than to switch kinds mid-session.
  var startingType = defaultType === 'screenplay' ? 'screenplay' : 'novel';

  var typeGroup = document.createElement('fieldset');
  typeGroup.id = 'project-type';
  var typeLegend = document.createElement('legend');
  typeLegend.textContent = 'What kind of project?';
  typeGroup.appendChild(typeLegend);

  var typeInputs = [
    { value: 'novel', label: 'Novel' },
    { value: 'screenplay', label: 'Screenplay' }
  ].map(function(option){
    var radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'project-type';
    radio.value = option.value;
    radio.id = 'project-type-' + option.value;
    radio.checked = option.value === startingType;

    var label = document.createElement('label');
    label.htmlFor = radio.id;
    label.textContent = option.label;

    //The pair in one .radio-option, so a narrow dialog breaks between the two kinds of project
    //rather than between a kind and the button that chooses it.
    var typeOption = document.createElement('span');
    typeOption.classList.add('radio-option');
    typeOption.appendChild(radio);
    typeOption.appendChild(label);
    typeGroup.appendChild(typeOption);
    return radio;
  });

  titleForm.appendChild(typeGroup);

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

    var chosen = typeInputs.find(function(radio){ return radio.checked; });
    var type = chosen && chosen.value === 'screenplay' ? 'screenplay' : 'novel';

    closePopups();
    callback(title, type);
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