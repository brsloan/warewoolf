function showErrorLog(){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var errorLogTextBox = document.createElement("pre");
  var errorLogText = loadErrorLog();
  errorLogTextBox.innerText = errorLogText != '' ? errorLogText : '(Log Empty)';
  errorLogTextBox.tabIndex = 1;
  popup.appendChild(errorLogTextBox);

  var crypt = getCrypto();
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
  if(userSettings.senderPass != null){
    var decrypedPass = crypt.decrypt(userSettings.senderPass);
    if(decrypedPass != null)
      senderPassInput.value = decrypedPass;
  }

  emailForm.appendChild(senderPassInput);

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

  emailForm.appendChild(document.createElement('br'));

  var sendButton = createButton('Send');
  sendButton.onclick = function(){
    sendButton.disabled = true;
    responseText.innerText = "Sending...";

    var attachments = [
      {
          filename: 'errorLog' + '.txt',
          content: errorLogText
      }
    ];

    emailFile(senderEmailInput.value,
      senderPassInput.value,
      receiverEmailInput.value,
      attachments,
      function(resp){
        responseText.innerText = resp;
        sendButton.disabled = false;
      });
  };
  emailForm.appendChild(sendButton);

  popup.appendChild(emailForm);

  var clearBtn = createButton("Clear Log");
  clearBtn.onclick = function(){
    clearErrorLog();
    errorLogText = loadErrorLog();
    errorLogTextBox.innerText = errorLogText != '' ? errorLogText : '(Log Empty)';
  }
  popup.appendChild(clearBtn);

  var closeBtn = createButton("Close");
  closeBtn.onclick = function(){
    closePopups();
  };
  popup.appendChild(closeBtn);


  document.body.appendChild(popup);
  errorLogTextBox.focus();
}