const { closePopups, createButton, removeElementsByClass, generateRow, removeOptions, describeDialog } = require('../controllers/utils');
const { startTransfer, stopTransfer, getTransferStatus, offerToPage, discardInboxFile, importKindFor } = require('../controllers/wifi-transfer');
const { adoptBackup } = require('../controllers/backup-project');
const { join } = require('../controllers/path-utils');
const { logError } = require('../controllers/error-log');

//Bumped on every showWifiTransfer() call and again on Close, the same guard as the Bluetooth
//Manager's: a start or an offer takes a moment, and its answer must not land in a dialog that has
//since closed or been reopened.
var wifiTransferGeneration = 0;

//How often the dialog asks the server how it is: often enough that a file sent from the phone
//shows in the inbox about as soon as the phone says it was sent.
var POLL_MS = 2000;

function formatSize(bytes){
  if(bytes < 1024) return bytes + ' B';
  if(bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

//File > Wi-Fi Transfer, Linux only. The server is off whenever this dialog opens and goes off
//again whenever it closes, however it closes - so the network page exists only while the writer
//is looking at this. The inbox can be worked through with the server off.
//
//`actions` is render.js's: importFile(filepath, fileTypeId) opens the Import dialog on one inbox
//file, and openProject(projectPath) opens a restored backup (after the unsaved-changes check).
function showWifiTransfer(project, userSettings, editorQuill, sysDirectories, actions){

  wifiTransferGeneration++;
  var myGeneration = wifiTransferGeneration;
  function isCurrent(){
    return myGeneration === wifiTransferGeneration && popup.isConnected;
  }

  var status = null;
  var running = false;
  var pollTimer = null;

  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var header = document.createElement('h1');
  header.innerText = "Wi-Fi Transfer";
  popup.appendChild(header);
  describeDialog(popup, header);

  var explanation = document.createElement('p');
  explanation.innerText = 'Switch it on, then open the address below in a browser on a phone or computer'
    + ' on the same Wi-Fi network and type the code. It switches off when this window closes, or after'
    + ' ten minutes with nothing sent.';
  popup.appendChild(explanation);

  var transferForm = document.createElement('form');
  transferForm.onsubmit = function(e){ e.preventDefault(); };
  var transferTbl = document.createElement('table');

  var switchLabel = document.createElement('label');
  switchLabel.innerText = "Switch On: ";
  switchLabel.htmlFor = 'wifi-transfer-check';

  var switchCheck = document.createElement('input');
  switchCheck.type = 'checkbox';
  switchCheck.id = 'wifi-transfer-check';

  transferTbl.appendChild(generateRow(switchLabel, switchCheck));

  var addressLabel = document.createElement('label');
  addressLabel.innerText = "Address: ";
  var addressText = document.createElement('label');
  addressText.id = 'wifi-transfer-address';
  addressText.innerText = '-';
  transferTbl.appendChild(generateRow(addressLabel, addressText));

  var codeLabel = document.createElement('label');
  codeLabel.innerText = "Code: ";
  var codeText = document.createElement('label');
  codeText.id = 'wifi-transfer-code';
  codeText.innerText = '-';
  transferTbl.appendChild(generateRow(codeLabel, codeText));

  transferForm.appendChild(transferTbl);

  var newCodeBtn = createButton("<span class='access-key'>N</span>ew Code");
  newCodeBtn.accessKey = 'n';
  newCodeBtn.disabled = true;
  transferForm.appendChild(newCodeBtn);

  //What to put on the page: the same three choices and file types as Send via Email, remembered
  //in the same settings, since a writer who emails the compiled .docx will want the same here.
  var sendSet = document.createElement('fieldset');
  sendSet.disabled = true;
  var sendLegend = document.createElement('legend');
  sendLegend.innerText = 'Send to the Other Device';
  sendSet.appendChild(sendLegend);

  function radioOption(labelText, value, id){
    var option = document.createElement('span');
    option.classList.add('radio-option');
    var label = document.createElement('label');
    label.innerText = labelText;
    label.htmlFor = id;
    option.appendChild(label);
    var radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'wifi-transfer-radio';
    radio.id = id;
    radio.value = value;
    option.appendChild(radio);
    sendSet.appendChild(option);
    return radio;
  }

  var chapRadio = radioOption('Chapter', 'chapter', 'wifi-transfer-radio-chap');
  var compiledRadio = radioOption(' | Compiled', 'compiled', 'wifi-transfer-radio-compiled');
  var projectRadio = radioOption(' | Project', 'project', 'wifi-transfer-radio-project');
  sendSet.appendChild(document.createElement('br'));

  var typeLabel = document.createElement("label");
  typeLabel.innerText = "File Type: ";
  typeLabel.htmlFor = "wifi-transfer-filetype-select";
  sendSet.appendChild(typeLabel);

  var typeSelect = document.createElement("select");
  typeSelect.id = "wifi-transfer-filetype-select";
  [".docx", ".txt", ".md", ".html", ".epub", ".mdfc"].forEach(function(op){
    var txtOp = document.createElement("option");
    txtOp.value = op;
    txtOp.innerText = op;
    typeSelect.appendChild(txtOp);
  });
  sendSet.appendChild(typeSelect);
  sendSet.appendChild(document.createElement('br'));

  if(userSettings.emailType == 'project')
    projectRadio.checked = true;
  else if(userSettings.emailType == 'compiled')
    compiledRadio.checked = true;
  else
    chapRadio.checked = true;
  if(userSettings.compileType)
    typeSelect.value = userSettings.compileType;
  typeSelect.disabled = projectRadio.checked;
  [chapRadio, compiledRadio, projectRadio].forEach(function(radio){
    radio.onclick = function(){ typeSelect.disabled = projectRadio.checked; };
  });

  var offerBtn = createButton("<span class='access-key'>A</span>dd to Page");
  offerBtn.accessKey = 'a';
  sendSet.appendChild(offerBtn);

  var offersText = document.createElement('p');
  offersText.id = 'wifi-transfer-offers';
  offersText.classList.add('popup-text-small');
  sendSet.appendChild(offersText);

  transferForm.appendChild(sendSet);

  var inboxSet = document.createElement('fieldset');
  var inboxLegend = document.createElement('legend');
  inboxLegend.innerText = 'Inbox';
  inboxSet.appendChild(inboxLegend);

  var inboxNote = document.createElement('p');
  inboxNote.classList.add('popup-text-small');
  inboxNote.innerText = 'Files sent from the other device wait here until you Import or Discard them.'
    + ' A .zip backup opens as a restored copy, like File > Restore Backup.';
  inboxSet.appendChild(inboxNote);

  var inboxSelect = document.createElement('select');
  inboxSelect.id = 'wifi-transfer-inbox-select';
  inboxSelect.size = 6;
  inboxSelect.setAttribute('aria-label', 'Inbox');
  inboxSet.appendChild(inboxSelect);
  inboxSet.appendChild(document.createElement('br'));

  var importBtn = createButton("<span class='access-key'>I</span>mport");
  importBtn.accessKey = 'i';
  inboxSet.appendChild(importBtn);

  var discardBtn = createButton("<span class='access-key'>D</span>iscard");
  discardBtn.accessKey = 'd';
  inboxSet.appendChild(discardBtn);

  transferForm.appendChild(inboxSet);

  var messageText = document.createElement('p');
  messageText.id = 'wifi-transfer-message';
  messageText.setAttribute('aria-live', 'polite');
  transferForm.appendChild(messageText);

  popup.appendChild(transferForm);

  var closeBtn = createButton("Close");
  closeBtn.onclick = function(){
    wifiTransferGeneration++;
    finish();
    closePopups();
  };
  popup.appendChild(closeBtn);

  document.body.appendChild(popup);
  switchCheck.focus();

  function showMessage(text){
    messageText.innerText = text || '';
  }

  //Switches the server off when this dialog stops being current, whichever way that happened.
  function finish(){
    clearTimeout(pollTimer);
    pollTimer = null;
    if(running){
      running = false;
      stopTransfer();
    }
  }

  function selectedInboxFile(){
    var index = inboxSelect.selectedIndex;
    return index < 0 || status == null ? null : status.inbox.files[index];
  }

  function updateInbox(files, previousName){
    removeOptions(inboxSelect);
    files.forEach(function(file, i){
      var option = document.createElement('option');
      option.value = file.name;
      option.innerText = file.name + ' (' + formatSize(file.size) + ')';
      inboxSelect.appendChild(option);
      if(file.name === previousName)
        inboxSelect.selectedIndex = i;
    });
    if(inboxSelect.selectedIndex < 0 && files.length > 0)
      inboxSelect.selectedIndex = 0;
    importBtn.disabled = files.length === 0;
    discardBtn.disabled = files.length === 0;
  }

  function update(next){
    var wasRunning = running;
    //Redrawn only when the files change, so a poll does not move the writer's place in the list.
    var inboxBefore = status == null ? null : status.inbox.files.map(function(f){ return f.name; }).join('\n');
    var inboxNow = next.inbox.files.map(function(f){ return f.name; }).join('\n');
    var previous = selectedInboxFile();

    status = next;
    if(inboxNow !== inboxBefore)
      updateInbox(next.inbox.files, previous == null ? null : previous.name);

    running = next.running;
    switchCheck.checked = next.running;
    newCodeBtn.disabled = !next.running;
    sendSet.disabled = !next.running;
    addressText.innerText = next.running ? next.url : '-';
    if(!next.running)
      codeText.innerText = '-';
    else if(next.connected)
      codeText.innerText = 'used - a device is connected';
    else
      codeText.innerText = next.code;
    offersText.innerText = next.offers.length > 0
      ? 'On the page: ' + next.offers.map(function(offer){ return offer.name; }).join(', ')
      : '';

    if(wasRunning && !next.running && next.stopReason)
      showMessage(next.stopReason);
  }

  function poll(){
    clearTimeout(pollTimer);
    pollTimer = setTimeout(function(){
      if(!isCurrent()){
        finish();
        return;
      }
      getTransferStatus().then(function(result){
        if(!isCurrent()){
          finish();
          return;
        }
        if(result.status != null)
          update(result.status);
        poll();
      });
    }, POLL_MS);
  }

  function setBusy(busy){
    switchCheck.disabled = busy;
    newCodeBtn.disabled = busy || !running;
    offerBtn.disabled = busy;
  }

  switchCheck.onclick = function(){
    var turningOn = switchCheck.checked;
    setBusy(true);
    showMessage(turningOn ? 'Switching on...' : 'Switching off...');
    var change = turningOn ? startTransfer() : stopTransfer().then(function(failure){
      return getTransferStatus().then(function(result){
        return { status: result.status, message: failure || result.message };
      });
    });
    change.then(function(result){
      if(!isCurrent()){
        //Switched on for a dialog that has gone: switch it straight back off.
        if(turningOn && result.status != null && result.status.running)
          stopTransfer();
        return;
      }
      setBusy(false);
      if(result.status != null)
        update(result.status);
      else
        switchCheck.checked = false;
      showMessage(result.message || (turningOn ? 'On. Open the address on the other device.' : 'Off.'));
    });
  };

  //A fresh code, which also disconnects whatever device was using the old one.
  newCodeBtn.onclick = function(){
    setBusy(true);
    showMessage('Making a new code...');
    stopTransfer().then(function(){
      return startTransfer();
    }).then(function(result){
      if(!isCurrent()){
        if(result.status != null && result.status.running)
          stopTransfer();
        return;
      }
      setBusy(false);
      if(result.status != null)
        update(result.status);
      showMessage(result.message || 'New code ready. Anything on the page before has been taken down.');
    });
  };

  offerBtn.onclick = function(){
    userSettings.emailType = projectRadio.checked ? 'project' : compiledRadio.checked ? 'compiled' : 'chapter';
    userSettings.compileType = typeSelect.value;
    userSettings.save();

    var compileOptions = {
      type: typeSelect.value,
      insertStrng: userSettings.compileChapMark,
      insertHead: userSettings.compileInsertHeaders,
      generateTitlePage: userSettings.compileGenTitlePage && compiledRadio.checked,
      styleHeadingAsChapter: true,
      compile: compiledRadio.checked
    };

    setBusy(true);
    showMessage('Getting it ready...');
    offerToPage(project, userSettings, editorQuill, projectRadio.checked ? '.zip' : typeSelect.value, compileOptions)
      .then(function(result){
        if(!isCurrent()) return;
        setBusy(false);
        if(result.status != null)
          update(result.status);
        showMessage(result.message);
      });
  };

  importBtn.onclick = function(){
    var file = selectedInboxFile();
    if(file == null){
      showMessage('Choose a file in the inbox first.');
      return;
    }
    var kind = importKindFor(file.name);
    var filepath = join(status.inbox.path, file.name);
    if(kind == null){
      showMessage('WareWoolf cannot import ' + file.name + '.');
      return;
    }

    if(kind === 'backup'){
      setBusy(true);
      showMessage('Restoring ' + file.name + '...');
      adoptBackup(filepath, userSettings, sysDirectories.docs).then(function(projectPath){
        if(!isCurrent()) return;
        wifiTransferGeneration++;
        finish();
        closePopups();
        actions.openProject(projectPath);
      }).catch(function(err){
        logError(err);
        if(!isCurrent()) return;
        setBusy(false);
        showMessage(err.message);
      });
      return;
    }

    //The Import dialog takes this one's place, so the server goes off here; the inbox keeps
    //anything else that was sent, for the next time this dialog is opened.
    wifiTransferGeneration++;
    finish();
    actions.importFile(filepath, kind);
  };

  discardBtn.onclick = function(){
    var file = selectedInboxFile();
    if(file == null){
      showMessage('Choose a file in the inbox first.');
      return;
    }
    discardInboxFile(status.inbox, file.name).then(function(failure){
      if(!isCurrent()) return;
      showMessage(failure || 'Discarded ' + file.name + '.');
      return getTransferStatus().then(function(result){
        if(!isCurrent()) return;
        if(result.status != null)
          update(result.status);
      });
    });
  };

  inboxSelect.onkeydown = function(e){
    if(e.key === 'Enter'){
      e.preventDefault();
      importBtn.onclick();
    }
    else if(e.key === 'Delete'){
      e.preventDefault();
      discardBtn.onclick();
    }
  };
  inboxSelect.ondblclick = function(){
    importBtn.onclick();
  };

  //Opens showing the inbox, with the server off until the writer switches it on.
  getTransferStatus().then(function(result){
    if(!isCurrent()) return;
    if(result.status != null)
      update(result.status);
    else{
      switchCheck.disabled = true;
      showMessage(result.message);
    }
    poll();
  });
}

module.exports = showWifiTransfer;
