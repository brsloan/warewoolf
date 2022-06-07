function showProperties(){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var filename = document.createElement('p');
    filename.innerText = "Filename: " + project.filename;
    popup.appendChild(filename);

    var directory = document.createElement('p');
    directory.innerText = "Directory: " + project.directory;
    popup.appendChild(directory);

    var pupDir = document.createElement('p');
    pupDir.innerText = "Chapters Directory: " + project.directory + project.filename.split(".")[0].concat("_pups/");
    popup.appendChild(pupDir);

    var propForm = document.createElement("form");

    var titleLabel = document.createElement("label");
    titleLabel.innerText = "Project Title: ";
    titleLabel.for = "title-input";
    propForm.appendChild(titleLabel);

    var titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.value = project.title;
    titleInput.id = "title-input";
    propForm.appendChild(titleInput);

    propForm.appendChild(document.createElement('br'));

    var authorLabel = document.createElement("label");
    authorLabel.innerText = "Author: ";
    authorLabel.for = "author-input";
    propForm.appendChild(authorLabel);

    var authorInput = document.createElement("input");
    authorInput.type = "text";
    authorInput.value = project.author;
    authorInput.id = "author-input";
    propForm.appendChild(authorInput);

    propForm.appendChild(document.createElement('br'));

    var apply = document.createElement("input");
    apply.type = "submit";
    apply.value = "Apply";
    propForm.onsubmit = function(e){
      e.preventDefault();
      project.title = titleInput.value;
      project.author = authorInput.value;
      closePopups();
    }
    propForm.appendChild(apply);
    var cancel = createButton("Cancel");
    cancel.onclick = function(){
      closePopups();
    };
    propForm.appendChild(cancel);

    popup.appendChild(propForm);
    document.body.appendChild(popup);
    titleInput.focus();
  }
