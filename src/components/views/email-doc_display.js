const { closePopups, createButton, removeElementsByClass } = require('../controllers/utils');
const getCrypto = require('../controllers/crypto');
const { prepareAndEmail } = require('../controllers/email-doc');

function showEmailOptions(userSettings){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var crypt = getCrypto();

    var header = document.createElement('h1');
    header.innerText = "Send Via Email";
    popup.appendChild(header);

    var emailForm = document.createElement('form');

    var emTbl = document.createElement('table');

    var senderEmailLabel = document.createElement('label');
    senderEmailLabel.for = 'sender-email-input';
    senderEmailLabel.innerText = 'Sender Email:';

    var senderEmailInput = document.createElement('input');
    senderEmailInput.type = 'text';
    senderEmailInput.placeholder = '____@gmail.com';
    senderEmailInput.id = 'sender-email-input';
    if(userSettings.senderEmail != null)
      senderEmailInput.value = userSettings.senderEmail;

    emTbl.appendChild(generateRow(senderEmailLabel, senderEmailInput));

    var senderPassLabel = document.createElement('label');
    senderPassLabel.for = 'sender-email-pass';
    senderPassLabel.innerText = 'Sender Password:';

    var senderPassInput = document.createElement('input');
    senderPassInput.type = 'password';
    senderPassInput.id = 'sender-email-pass';
    if(userSettings.senderPass != null){
      var decrypedPass = crypt.decrypt(userSettings.senderPass);
      if(decrypedPass != null)
        senderPassInput.value = decrypedPass;
    }

    emTbl.appendChild(generateRow(senderPassLabel, senderPassInput));

    var rememberPassLabel = document.createElement('label');
    rememberPassLabel.innerText = "Remember Password?";
    rememberPassLabel.for = 'remember-pass-check';

    var rememberPassCheck = document.createElement('input');
    rememberPassCheck.type = 'checkbox';
    rememberPassCheck.id = 'remember-pass-check';
    if(userSettings.senderPass != null)
      rememberPassCheck.checked = true;

    emTbl.appendChild(generateRow(rememberPassLabel, rememberPassCheck));

    var receiverEmailLabel = document.createElement('label');
    receiverEmailLabel.for = 'receiver-email-input';
    receiverEmailLabel.innerText = 'Receiver Email:';

    var receiverEmailInput = document.createElement('input');
    receiverEmailInput.type = 'text';
    receiverEmailInput.placeholder = '____@whatever.com';
    receiverEmailInput.id = 'receiver-email-input';
    if(userSettings.receiverEmail != null)
      receiverEmailInput.value = userSettings.receiverEmail;

    emTbl.appendChild(generateRow(receiverEmailLabel, receiverEmailInput));

    emailForm.appendChild(emTbl);

    var attachSet = document.createElement('fieldset');
    var attachLeg = document.createElement('legend');
    attachLeg.innerText = 'Attachment Options';
    attachSet.appendChild(attachLeg);

    var responseText = document.createElement('p');
    responseText.innerText = "";
    attachSet.appendChild(responseText);

    var chapRadioLabel = document.createElement('label');
    chapRadioLabel.innerText = "Send Chapter";
    chapRadioLabel.for = 'email-radio-chap';
    attachSet.appendChild(chapRadioLabel);

    var chapRadio = document.createElement('input');
    chapRadio.type = 'radio';
    chapRadio.name = 'email-radio';
    chapRadio.id = 'email-radio-chap';
    chapRadio.value = 'chapter';
    attachSet.appendChild(chapRadio);

    var compiledRadioLabel = document.createElement('label');
    compiledRadioLabel.innerText = " | Send Compiled";
    compiledRadioLabel.for = 'email-radio-compiled';
    attachSet.appendChild(compiledRadioLabel);

    var compiledRadio = document.createElement('input');
    compiledRadio.type = 'radio';
    compiledRadio.name = 'email-radio';
    compiledRadio.id = 'email-radio-compiled';
    compiledRadio.value = 'compiled';
    attachSet.appendChild(compiledRadio);

    var projectRadioLabel = document.createElement('label');
    projectRadioLabel.innerText = " | Send Project";
    projectRadioLabel.for = 'email-radio-project';
    attachSet.appendChild(projectRadioLabel);

    var projectRadio = document.createElement('input');
    projectRadio.type = 'radio';
    projectRadio.name = 'email-radio';
    projectRadio.id = 'email-radio-project';
    projectRadio.value = 'project';
    attachSet.appendChild(projectRadio);

    attachSet.appendChild(document.createElement('br'));

    var typeLabel = document.createElement("label");
    typeLabel.innerText = "File Type: ";
    typeLabel.for = "filetype-select";
    attachSet.appendChild(typeLabel);

    var typeSelect = document.createElement("select");
    const typeOptions = [".docx", ".txt", ".mdfc"];
    typeOptions.forEach(function(op){
      var txtOp = document.createElement("option");
      txtOp.value = op;
      txtOp.innerText = op;
      typeSelect.appendChild(txtOp);
    });
    attachSet.appendChild(typeSelect);

    emailForm.appendChild(attachSet);

    emailForm.appendChild(document.createElement('br'));

    //set defaults
    if(userSettings.emailType == 'project'){
      projectRadio.checked = true;
      typeSelect.disabled = true;
    }
    else if(userSettings.emailType == 'chapter')
      chapRadio.checked = true;
    else if(userSettings.emailType == 'compiled')
      compiledRadio.checked = true;
    typeSelect.value = userSettings.compileType;

    var sendButton = createButton('Send');
    sendButton.onclick = function(){
      sendButton.disabled = true;
      responseText.innerText = "Sending...";

      userSettings.senderEmail = senderEmailInput.value;
      userSettings.receiverEmail = receiverEmailInput.value;
      if(projectRadio.checked)
        userSettings.emailType = 'project';
      else if(chapRadio.checked)
        userSettings.emailType = 'chapter';
      else if(compiledRadio.checked)
        userSettings.emailType = 'compiled';
      if(rememberPassCheck.checked){
        userSettings.senderPass = crypt.encrypt(senderPassInput.value);
      }
      userSettings.save();

      let compileOptions = null;
      if(compiledRadio.checked){
        compileOptions = {
          type: typeSelect.value,
          insertStrng: userSettings.compileChapMark,
          insertHead: userSettings.compileInsertHeaders,
          generateTitlePage: userSettings.compileGenTitlePage
        }
      }

      prepareAndEmail(project, userSettings, editorQuill, senderEmailInput.value,
        senderPassInput.value,
        receiverEmailInput.value,
        projectRadio.checked ? '.zip' : typeSelect.value,
        compileOptions,
        function(resp){
          responseText.innerText = resp;
          sendButton.disabled = false;
        });
    };
    emailForm.appendChild(sendButton);

    var closeBtn = createButton("Close");
    closeBtn.onclick = function(){
      closePopups();
    };
    emailForm.appendChild(closeBtn);

    popup.appendChild(emailForm);


    chapRadio.onclick = function(){
      typeSelect.disabled = false;
    }
    compiledRadio.onclick = function(){
      typeSelect.disabled = false;
    }
    projectRadio.onclick = function(){
      typeSelect.disabled = true;
    }



    document.body.appendChild(popup);

    if(userSettings.senderEmail == null)
      senderEmailInput.focus();
    else if(userSettings.senderPass == null)
      senderPassInput.focus();
    else
      sendButton.focus();
  };

  module.exports = showEmailOptions;