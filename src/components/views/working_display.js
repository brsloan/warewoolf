const { removeElementsByClass } = require('../controllers/utils');

//Shared DOM builder for showWorking/showWorkingAndThen. When onImageSettled is given, it's
//wired to the hardhat image's load/error events before src is set, so a cached or failed
//load can't fire before the handler is attached.
function buildWorkingPopup(status, onImageSettled){
    var workingPopup = document.createElement('div');
    workingPopup.classList.add('working-popup');

    var hardhat = document.createElement('img');
    hardhat.classList.add('working-img');
    if(onImageSettled){
        hardhat.onload = onImageSettled;
        hardhat.onerror = onImageSettled;
    }
    hardhat.src = "assets/warewoolf_at_work.png";
    workingPopup.appendChild(hardhat);

    var title = document.createElement('h1');
    title.id = 'working-status';
    title.innerText = status;
    workingPopup.appendChild(title);

    document.body.appendChild(workingPopup);
}

function showWorking(status = 'Working...'){

    var workups = document.getElementsByClassName('working-popup');

    if(workups.length == 0){
        buildWorkingPopup(status);
    }
    else {
        document.getElementById('working-status').innerText = status;
    }
}

function showWorkingAndThen(status = 'Working...', callback){
    var workups = document.getElementsByClassName('working-popup');

    if(workups.length > 0){
        document.getElementById('working-status').innerText = status;
        callback();
        return;
    }

    buildWorkingPopup(status, callback);
}

function hideWorking(){
    removeElementsByClass('working-popup');
}

//The other long-running-operation popup: same idea as showWorking(), but it reports a run of
//progress messages from backup-project.js rather than a single status, and on the way out of the
//app it carries a button to leave without waiting for the backup. It gets its own class because
//the two used to share 'working-popup', where each broke the other - hideWorking() swept this one
//away, and showWorking() mistook it for its own popup and went looking for a #working-status that
//is not there.
function showBackupAlert(message, onExitWithoutBackup){
    var backupAlert = document.getElementById('backup-alert');
    var backupAlertText = document.getElementById('backup-alert-text');

    if(backupAlert == null){
        backupAlert = document.createElement('div');
        backupAlert.id = 'backup-alert';
        backupAlert.classList.add('popup');
        backupAlert.classList.add('backup-alert-popup');
        document.body.appendChild(backupAlert);
        backupAlertText = document.createElement('p');
        backupAlertText.id = 'backup-alert-text';
        backupAlert.appendChild(backupAlertText);
    }

    backupAlertText.innerText = message;
    setExitWithoutBackupButton(backupAlert, onExitWithoutBackup);
}

//This same alert reports backups started from the menu, where the app is not on its way out and a
//button that quits it, skipping the usual check for unsaved work, has no business being. So it is
//only added when the caller passes something for it to do.
function setExitWithoutBackupButton(backupAlert, onExitWithoutBackup){
    var exitBtn = document.getElementById('backup-alert-exit');

    if(onExitWithoutBackup && exitBtn == null){
        exitBtn = document.createElement('button');
        exitBtn.id = 'backup-alert-exit';
        exitBtn.innerText = 'Exit Without Backup';
        exitBtn.onclick = function(e){
            onExitWithoutBackup();
        };
        backupAlert.appendChild(exitBtn);
    }
    else if(!onExitWithoutBackup && exitBtn != null)
        exitBtn.remove();
}

function hideBackupAlert(){
    var backupAlert = document.getElementById('backup-alert');
    if(backupAlert)
        backupAlert.remove();
}

module.exports = {
    showWorking,
    showWorkingAndThen,
    hideWorking,
    showBackupAlert,
    hideBackupAlert
};