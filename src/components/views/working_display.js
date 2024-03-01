function showWorking(status = 'Working...'){

    var workups = document.getElementsByClassName('working-popup');

    if(workups.length == 0){
        var workingPopup = document.createElement('div');
        workingPopup.classList.add('working-popup');

        var hardhat = document.createElement('img');
        hardhat.src = "assets/warewoolf_at_work.png";
        hardhat.classList.add('working-img');
        workingPopup.appendChild(hardhat);

        var title = document.createElement('h1');
        title.id = 'working-status';
        title.innerText = status;
        workingPopup.appendChild(title);


        document.body.appendChild(workingPopup);
    }
    else {
        document.getElementById('working-status').innerText = status;
    }

    
}

function hideWorking(){
    removeElementsByClass('working-popup');
}