function showEmailOptions(){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

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

    var rememberPassLabel = document.createElement('label');
    rememberPassLabel.innerText = "Remember Password?";
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


    var chapRadioLabel = document.createElement('label');
    chapRadioLabel.innerText = "Send Chapter";
    chapRadioLabel.for = 'email-radio-chap';
    emailForm.appendChild(chapRadioLabel);

    var chapRadio = document.createElement('input');
    chapRadio.type = 'radio';
    chapRadio.name = 'email-radio';
    chapRadio.id = 'email-radio-chap';
    chapRadio.value = 'chap';
    chapRadio.checked = true;
    emailForm.appendChild(chapRadio);

    var compiledRadioLabel = document.createElement('label');
    compiledRadioLabel.innerText = "Send Compiled";
    compiledRadioLabel.for = 'email-radio-compiled';
    emailForm.appendChild(compiledRadioLabel);

    var compiledRadio = document.createElement('input');
    compiledRadio.type = 'radio';
    compiledRadio.name = 'email-radio';
    compiledRadio.id = 'email-radio-compiled';
    compiledRadio.value = 'compiled';
    emailForm.appendChild(compiledRadio);

    emailForm.appendChild(document.createElement('br'));

    var typeLabel = document.createElement("label");
    typeLabel.innerText = "File Type: ";
    typeLabel.for = "filetype-select";
    emailForm.appendChild(typeLabel);

    var typeSelect = document.createElement("select");
    const typeOptions = [".docx", ".txt", ".mdfc"];
    typeOptions.forEach(function(op){
      var txtOp = document.createElement("option");
      txtOp.value = op;
      txtOp.innerText = op;
      typeSelect.appendChild(txtOp);
    });
    emailForm.appendChild(typeSelect);

    emailForm.appendChild(document.createElement('br'));

    var compileOptionsSet = document.createElement('fieldset');

    var compileOptionsLabel = document.createElement('legend');
    compileOptionsLabel.innerText = 'Compile Options';
    compileOptionsSet.appendChild(compileOptionsLabel);

    var insertStrLabel = document.createElement("label");
    insertStrLabel.innerText = "Insert string to mark chapter breaks: ";
    insertStrLabel.for = "insert-str-input";
    compileOptionsSet.appendChild(insertStrLabel);

    var insertStrInput = document.createElement("input");
    insertStrInput.type = "text";
    insertStrInput.value = "";
    insertStrInput.id = "insert-str-input";
    compileOptionsSet.appendChild(insertStrInput);

    compileOptionsSet.appendChild(document.createElement('br'));

    var insertHeadLabel = document.createElement("label");
    insertHeadLabel.innerText = "Insert chapter titles as headings: ";
    insertHeadLabel.for = "insert-head-check";
    compileOptionsSet.appendChild(insertHeadLabel);

    var insertHeadCheck = document.createElement("input");
    insertHeadCheck.type = "checkbox";
    insertHeadCheck.id = "insert-head-check";
    compileOptionsSet.appendChild(insertHeadCheck);

    compileOptionsSet.style.display = 'none';
    emailForm.appendChild(compileOptionsSet);

    emailForm.appendChild(document.createElement('br'));

    var sendButton = createButton('Send');
    sendButton.onclick = function(){
      sendButton.disabled = true;
      responseText.innerText = "Sending...";

      userSettings.senderEmail = senderEmailInput.value;
      userSettings.receiverEmail = receiverEmailInput.value;
      if(rememberPassCheck.checked){
        userSettings.senderPass = crypt.encrypt(senderPassInput.value);
      }
      userSettings.save();

      let compileOptions = null;
      if(compiledRadio.checked){
        compileOptions = {
          type: typeSelect.value,
          insertStrng: insertStrInput.value,
          insertHead: insertHeadCheck.checked
        }
      }

      prepareAndEmail(senderEmailInput.value,
        senderPassInput.value,
        receiverEmailInput.value,
        typeSelect.value,
        compileOptions,
        function(resp){
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

    chapRadio.onclick = function(){
      compileOptionsSet.style.display = 'none';
    }
    compiledRadio.onclick = function(){
      compileOptionsSet.style.display = 'block';
    }



    document.body.appendChild(popup);

    if(userSettings.senderEmail == null)
      senderEmailInput.focus();
    else if(userSettings.senderPass == null)
      senderPassInput.focus();
    else
      sendButton.focus();
  };
