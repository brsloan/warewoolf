function showEmailOptions(){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var header = document.createElement('h1');
    header.innerText = "Send Via Email";
    popup.appendChild(header);

    var emailForm = document.createElement('form');

    var senderEmailLabel = document.createElement('label');
    senderEmailLabel.for = 'sender-email-input';
    senderEmailLabel.innerText = 'Sender Email:';
    emailForm.appendChild(senderEmailLabel);

    var senderEmailInput = document.createElement('input');
    senderEmailInput.type = 'text';
    senderEmailInput.placeholder = '____@gmail.com';
    senderEmailInput.id = 'sender-email-input';
    if(userSettings.senderEmail != null)
      senderEmailInput.value = userSettings.senderEmail;
    emailForm.appendChild(senderEmailInput);

    emailForm.appendChild(document.createElement('br'));

    var senderPassLabel = document.createElement('label');
    senderPassLabel.for = 'sender-email-pass';
    senderPassLabel.innerText = 'Sender Password:';
    emailForm.appendChild(senderPassLabel);

    var senderPassInput = document.createElement('input');
    senderPassInput.type = 'password';
    senderPassInput.id = 'sender-email-pass';
    if(userSettings.senderPass != null)
      senderPassInput.value = userSettings.senderPass;
    emailForm.appendChild(senderPassInput);

    emailForm.appendChild(document.createElement('br'));

    var rememberPassLabel = document.createElement('label');
    rememberPassLabel.innerText = "Remember Password? (Will be saved on local machine as plain text.)";
    rememberPassLabel.for = 'remember-pass-check';
    emailForm.appendChild(rememberPassLabel);

    var rememberPassCheck = document.createElement('input');
    rememberPassCheck.type = 'checkbox';
    rememberPassCheck.id = 'remember-pass-check';
    if(userSettings.senderPass != null)
      rememberPassCheck.checked = true;
    emailForm.appendChild(rememberPassCheck);

    emailForm.appendChild(document.createElement('br'));

    var receiverEmailLabel = document.createElement('label');
    receiverEmailLabel.for = 'receiver-email-input';
    receiverEmailLabel.innerText = 'Receiver Email:';
    emailForm.appendChild(receiverEmailLabel);

    var receiverEmailInput = document.createElement('input');
    receiverEmailInput.type = 'text';
    receiverEmailInput.placeholder = '____@whatever.com';
    receiverEmailInput.id = 'receiver-email-input';
    if(userSettings.receiverEmail != null)
      receiverEmailInput.value = userSettings.receiverEmail;
    emailForm.appendChild(receiverEmailInput);

    emailForm.appendChild(document.createElement('br'));

    var responseText = document.createElement('p');
    responseText.innerText = "";
    emailForm.appendChild(responseText);

    var sendButton = createButton('Send');
    sendButton.onclick = function(){
      sendButton.disabled = true;
      responseText.innerText = "Sending...";

      userSettings.senderEmail = senderEmailInput.value;
      userSettings.receiverEmail = receiverEmailInput.value;
      if(rememberPassCheck.checked){
        userSettings.senderPass = senderPassInput.value;
      }
      userSettings.save();
      emailDoc(senderEmailInput.value, senderPassInput.value, receiverEmailInput.value, function(resp){
        responseText.innerText = resp;
        sendButton.disabled = false;
      });
    };
    emailForm.appendChild(sendButton);

    popup.appendChild(emailForm);

    var closeBtn = createButton("Close");
    closeBtn.onclick = function(){
      closePopups();
    };
    popup.appendChild(closeBtn);

    document.body.appendChild(popup);

    if(userSettings.senderEmail == null)
      senderEmailInput.focus();
    else if(userSettings.senderPass == null)
      senderPassInput.focus();
    else
      sendButton.focus();
  };
