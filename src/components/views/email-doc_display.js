const { closePopups, createButton, removeElementsByClass, generateRow } = require('../controllers/utils');
const { describeCredentialBackend, APP_PASSWORD_HINT } = require('../controllers/credential-help');
const { prepareAndEmail } = require('../controllers/email-doc');
const { logError } = require('../controllers/error-log');
const { showWorkingAndThen, hideWorking } = require('./working_display');

function showEmailOptions(project, userSettings, credentialStore, editorQuill){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var credentials = credentialStore.describe();
    //Null while a passphrase protected password is still locked, which is how the send handler
    //tells "unchanged" from "the writer typed a new one".
    var savedPassword = credentials.locked ? null : credentialStore.getPassword();
    var wasProtectedByPassphrase = credentials.hasPassword && credentials.backend === 'passphrase';

    var header = document.createElement('h1');
    header.innerText = "Send Via Email";
    popup.appendChild(header);

    var emailForm = document.createElement('form');

    var emTbl = document.createElement('table');

    var senderEmailLabel = document.createElement('label');
    senderEmailLabel.htmlFor = 'sender-email-input';
    senderEmailLabel.innerText = 'Sender Email:';

    var senderEmailInput = document.createElement('input');
    senderEmailInput.type = 'text';
    senderEmailInput.placeholder = '____@gmail.com';
    senderEmailInput.id = 'sender-email-input';
    if(userSettings.senderEmail != null)
      senderEmailInput.value = userSettings.senderEmail;

    emTbl.appendChild(generateRow(senderEmailLabel, senderEmailInput));

    var senderPassLabel = document.createElement('label');
    senderPassLabel.htmlFor = 'sender-email-pass';
    senderPassLabel.innerText = 'Sender Password:';

    var senderPassInput = document.createElement('input');
    senderPassInput.type = 'password';
    senderPassInput.id = 'sender-email-pass';
    if(savedPassword != null)
      senderPassInput.value = savedPassword;

    emTbl.appendChild(generateRow(senderPassLabel, senderPassInput));

    //Shown only while a passphrase protected password is locked, so the writer can bring back what
    //they saved instead of retyping the email password itself.
    var unlockLabel = document.createElement('label');
    unlockLabel.htmlFor = 'unlock-passphrase-input';
    unlockLabel.innerText = 'Passphrase:';

    var unlockInput = document.createElement('input');
    unlockInput.type = 'password';
    unlockInput.id = 'unlock-passphrase-input';

    var unlockButton = createButton('Unlock');
    var unlockRow = generateRow(unlockLabel, unlockInput);
    unlockRow.lastChild.appendChild(unlockButton);
    if(!credentials.locked)
      unlockRow.style.display = 'none';

    emTbl.appendChild(unlockRow);

    var rememberPassLabel = document.createElement('label');
    rememberPassLabel.innerText = "Remember Password?";
    rememberPassLabel.htmlFor = 'remember-pass-check';

    var rememberPassCheck = document.createElement('input');
    rememberPassCheck.type = 'checkbox';
    rememberPassCheck.id = 'remember-pass-check';
    rememberPassCheck.checked = credentials.hasPassword;

    emTbl.appendChild(generateRow(rememberPassLabel, rememberPassCheck));

    var protectLabel = document.createElement('label');
    protectLabel.innerText = "Protect With Passphrase?";
    protectLabel.htmlFor = 'protect-pass-check';

    var protectCheck = document.createElement('input');
    protectCheck.type = 'checkbox';
    protectCheck.id = 'protect-pass-check';
    protectCheck.checked = wasProtectedByPassphrase;

    var protectRow = generateRow(protectLabel, protectCheck);
    emTbl.appendChild(protectRow);

    var newPassphraseLabel = document.createElement('label');
    newPassphraseLabel.htmlFor = 'new-passphrase-input';
    newPassphraseLabel.innerText = 'New Passphrase:';

    var newPassphraseInput = document.createElement('input');
    newPassphraseInput.type = 'password';
    newPassphraseInput.id = 'new-passphrase-input';

    var newPassphraseRow = generateRow(newPassphraseLabel, newPassphraseInput);
    emTbl.appendChild(newPassphraseRow);

    var confirmPassphraseLabel = document.createElement('label');
    confirmPassphraseLabel.htmlFor = 'confirm-passphrase-input';
    confirmPassphraseLabel.innerText = 'Confirm Passphrase:';

    var confirmPassphraseInput = document.createElement('input');
    confirmPassphraseInput.type = 'password';
    confirmPassphraseInput.id = 'confirm-passphrase-input';

    var confirmPassphraseRow = generateRow(confirmPassphraseLabel, confirmPassphraseInput);
    emTbl.appendChild(confirmPassphraseRow);

    var receiverEmailLabel = document.createElement('label');
    receiverEmailLabel.htmlFor = 'receiver-email-input';
    receiverEmailLabel.innerText = 'Receiver Email:';

    var receiverEmailInput = document.createElement('input');
    receiverEmailInput.type = 'text';
    receiverEmailInput.placeholder = '____@whatever.com';
    receiverEmailInput.id = 'receiver-email-input';
    if(userSettings.receiverEmail != null)
      receiverEmailInput.value = userSettings.receiverEmail;

    emTbl.appendChild(generateRow(receiverEmailLabel, receiverEmailInput));

    emailForm.appendChild(emTbl);

    var appPasswordNote = document.createElement('p');
    appPasswordNote.classList.add('popup-text-small');
    appPasswordNote.innerText = APP_PASSWORD_HINT;
    emailForm.appendChild(appPasswordNote);

    var storageNote = document.createElement('p');
    storageNote.classList.add('popup-text-small');
    emailForm.appendChild(storageNote);

    function refreshCredentialRows(){
      //While a saved password is still locked there is nothing to re-protect, so the passphrase
      //fields stay out of the way of the unlock row — until the writer types a new password over
      //the empty field, which is them replacing what's stored rather than unlocking it. Comparing
      //against the known value (rather than just !credentials.locked) also keeps the fields hidden
      //right after a successful unlock, when nothing has actually changed yet.
      var settingANewPassword = senderPassInput.value !== (savedPassword == null ? '' : savedPassword);
      var showPassphraseFields = rememberPassCheck.checked && protectCheck.checked && settingANewPassword;
      protectRow.style.display = rememberPassCheck.checked ? '' : 'none';
      newPassphraseRow.style.display = showPassphraseFields ? '' : 'none';
      confirmPassphraseRow.style.display = showPassphraseFields ? '' : 'none';
      //Describes where the password would land given the boxes as they stand, not where the last
      //one landed, so unticking the passphrase box shows the unattended backend it would fall to.
      var unattendedBackend = credentials.secureStorageAvailable ? 'safeStorage' : 'keyfile';
      storageNote.innerText = rememberPassCheck.checked
        ? describeCredentialBackend(protectCheck.checked ? 'passphrase' : unattendedBackend)
        : '';
      storageNote.style.display = storageNote.innerText === '' ? 'none' : '';
    }

    rememberPassCheck.onchange = refreshCredentialRows;
    protectCheck.onchange = refreshCredentialRows;
    senderPassInput.oninput = refreshCredentialRows;
    refreshCredentialRows();

    unlockButton.onclick = function(){
      if(credentialStore.unlock(unlockInput.value)){
        credentials = credentialStore.describe();
        savedPassword = credentialStore.getPassword();
        senderPassInput.value = savedPassword == null ? '' : savedPassword;
        unlockInput.value = '';
        unlockRow.style.display = 'none';
        responseText.innerText = "";
        refreshCredentialRows();
        sendButton.focus();
      }
      else {
        responseText.innerText = "Wrong passphrase.";
        unlockInput.focus();
      }
    };

    var attachSet = document.createElement('fieldset');
    var attachLeg = document.createElement('legend');
    attachLeg.innerText = 'Attachment Options';
    attachSet.appendChild(attachLeg);

    var responseText = document.createElement('p');
    responseText.innerText = "";
    attachSet.appendChild(responseText);

    var chapRadioLabel = document.createElement('label');
    chapRadioLabel.innerText = "Send Chapter";
    chapRadioLabel.htmlFor = 'email-radio-chap';
    attachSet.appendChild(chapRadioLabel);

    var chapRadio = document.createElement('input');
    chapRadio.type = 'radio';
    chapRadio.name = 'email-radio';
    chapRadio.id = 'email-radio-chap';
    chapRadio.value = 'chapter';
    attachSet.appendChild(chapRadio);

    var compiledRadioLabel = document.createElement('label');
    compiledRadioLabel.innerText = " | Send Compiled";
    compiledRadioLabel.htmlFor = 'email-radio-compiled';
    attachSet.appendChild(compiledRadioLabel);

    var compiledRadio = document.createElement('input');
    compiledRadio.type = 'radio';
    compiledRadio.name = 'email-radio';
    compiledRadio.id = 'email-radio-compiled';
    compiledRadio.value = 'compiled';
    attachSet.appendChild(compiledRadio);

    var projectRadioLabel = document.createElement('label');
    projectRadioLabel.innerText = " | Send Project";
    projectRadioLabel.htmlFor = 'email-radio-project';
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
    typeLabel.htmlFor = "filetype-select";
    attachSet.appendChild(typeLabel);

    var typeSelect = document.createElement("select");
    typeSelect.id = "filetype-select";
    const typeOptions = [".docx", ".txt", ".md", ".html", ".epub", ".mdfc"];
    typeOptions.forEach(function(op){
      var txtOp = document.createElement("option");
      txtOp.value = op;
      txtOp.innerText = op;
      typeSelect.appendChild(txtOp);
    });
    attachSet.appendChild(typeSelect);

    emailForm.appendChild(attachSet);

    emailForm.appendChild(document.createElement('br'));

    //set defaults - anything other than 'project'/'compiled' (including a first run with no
    //emailType set yet) falls back to 'chapter' so a radio is always selected.
    if(userSettings.emailType == 'project'){
      projectRadio.checked = true;
      typeSelect.disabled = true;
    }
    else if(userSettings.emailType == 'compiled')
      compiledRadio.checked = true;
    else
      chapRadio.checked = true;
    typeSelect.value = userSettings.compileType;

    //Rewrites the stored password only when something about it actually changed, so a writer with a
    //passphrase protected password isn't asked to retype the passphrase on every send. Returns an
    //error string when the form can't be honoured, or null when it's been dealt with. The dialog
    //stays open after a send, so the "what's stored now" state is refreshed rather than left as it
    //was when the dialog opened.
    function saveCredentials(){
      if(!rememberPassCheck.checked){
        if(credentials.hasPassword)
          credentialStore.clear();

        rememberStoredState(null, false);

        return null;
      }

      //A locked passphrase-protected password has never been read into savedPassword this
      //session, so senderPassInput.value (whatever it holds) can never legitimately match it -
      //without this guard the "unchanged" check below always fails while locked, and a writer
      //who responds to the resulting error by typing just a new passphrase (without unlocking)
      //would silently overwrite the real saved password with an empty one.
      if(credentials.locked)
        return "Unlock the saved password first, or uncheck \"Remember Password?\" to send without it.";

      var passphraseWanted = protectCheck.checked;
      var passphrase = newPassphraseInput.value;
      var unchanged = credentials.hasPassword
        && senderPassInput.value === savedPassword
        && passphraseWanted === wasProtectedByPassphrase
        && passphrase === '';

      if(unchanged)
        return null;

      if(passphraseWanted){
        if(passphrase === '')
          return "Enter a passphrase to protect the saved password.";
        if(passphrase !== confirmPassphraseInput.value)
          return "The passphrases don't match.";
      }

      var options = passphraseWanted ? { passphrase: passphrase } : null;

      if(!credentialStore.savePassword(senderPassInput.value, options))
        return "Couldn't save the password.";

      newPassphraseInput.value = '';
      confirmPassphraseInput.value = '';
      rememberStoredState(senderPassInput.value, passphraseWanted);

      return null;
    }

    function rememberStoredState(password, protectedByPassphrase){
      credentials = credentialStore.describe();
      savedPassword = password;
      wasProtectedByPassphrase = protectedByPassphrase;
      refreshCredentialRows();
    }

    var sendButton = createButton('Send');
    sendButton.onclick = function(){
      var credentialError = saveCredentials();

      if(credentialError != null){
        responseText.innerText = credentialError;
        if(credentials.locked)
          unlockInput.focus();
        else
          newPassphraseInput.focus();
        return;
      }

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
      userSettings.compileType = typeSelect.value;
      userSettings.save();

      let compileOptions = {
          type: typeSelect.value,
          insertStrng: userSettings.compileChapMark,
          insertHead: userSettings.compileInsertHeaders,
          generateTitlePage: userSettings.compileGenTitlePage && compiledRadio.checked,
          styleHeadingAsChapter: true,
          compile: compiledRadio.checked
        }

      //Building the attachment (compiling chapters, generating a docx/epub) can be slow on a large
      //project. Deferring it behind showWorkingAndThen gives "Sending..." a chance to paint first
      //instead of freezing with no feedback.
      showWorkingAndThen('Sending...', function(){
        //Promise.resolve so a backing that hands back nothing at all is as safe as one that returns a
        //promise.
        Promise.resolve(prepareAndEmail(project, userSettings, editorQuill, senderEmailInput.value,
          senderPassInput.value,
          receiverEmailInput.value,
          projectRadio.checked ? '.zip' : typeSelect.value,
          compileOptions,
          function(resp){
            hideWorking();
            responseText.innerText = resp;
            sendButton.disabled = false;
          })).catch(function(err){
            //prepareAndEmail is async now (compiling reads chapters through the platform facade),
            //so a failure while building the attachment arrives as a rejection rather than a
            //throw. Caught here so "Sending..." always comes down and the button comes back -
            //unhandled, the dialog would be stuck with nothing to say.
            logError(err);
            hideWorking();
            responseText.innerText = 'Error preparing the document to send.';
            sendButton.disabled = false;
          });
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
    else if(credentials.locked)
      unlockInput.focus();
    else if(savedPassword == null)
      senderPassInput.focus();
    else
      sendButton.focus();
  };

  module.exports = showEmailOptions;