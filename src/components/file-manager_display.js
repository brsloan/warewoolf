function showFileManager(docPath){
    
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var fileList = document.createElement("ul");
    popup.appendChild(fileList);


    var close = createButton("Close");
    close.onclick = function(){
        closePopups();
    };
    popup.appendChild(close);

    populateFileList(docPath, fileList);

    document.body.appendChild(popup);
    close.focus();
}

function populateFileList(docPath, listElement){
    var files = getFileList(docPath);

    files.forEach(file => {
        var fileLabel = document.createElement("li");
        fileLabel.innerText = file.name;
        listElement.appendChild(fileLabel);
        console.log(file);
    });
}

function getFileList(dirPath){
    try {
        return fs.readdirSync(dirPath, {withFileTypes: true});
    } catch (err) {
        logErrror(err);
    }
}

function packageFileList(files){

}