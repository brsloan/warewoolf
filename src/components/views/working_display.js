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

module.exports = {
    showWorking,
    showWorkingAndThen,
    hideWorking
};