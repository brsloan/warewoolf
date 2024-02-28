function showWorking(){
    var workingPopup = document.createElement('div');
    workingPopup.classList.add('working-popup');

    var hardhat = document.createElement('img');
    hardhat.src = "assets/warewoolf_at_work.png";
    hardhat.classList.add('working-img');
    workingPopup.appendChild(hardhat);

    var title = document.createElement('h1');
    title.innerText = "Working...";
    workingPopup.appendChild(title);

    document.body.appendChild(workingPopup);
}

function removeWorking(){
    removeElementsByClass('working-popup');
}