function showShortcutsHelp(){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    popup.innerHTML =
    "<h1>Shortcuts</h1>" +
    "<h2>Navigation</h2>" +
    "<table class='shortcuts-table'>" +
    "<tr><td>View Previous Chapter</td><td>Ctrl + Up</td></tr>" +
    "<tr><td>View Next Chapter</td><td>Ctrl + Down</td></tr>" +
    "<tr><td>Shift Focus To Editor</td><td>Ctrl + Left</td></tr>" +
    "<tr><td>Shift Focus To Notes</td><td>Ctrl + Right</td></tr>" +
    "</table>" +
    "<h2>Alteration</h2>" +
    "<table class='shortcuts-table'>" +
    "<tr><td>Move Chapter Up</td><td>Ctrl + Shift + Up</td></tr>" +
    "<tr><td>Move Chapter Down</td><td>Ctrl + Shift + Down</td></tr>" +
    "<tr><td>Change Chapter Label</td><td>Ctrl + Shift + Left</td></tr>" +
    "</table>" +
    "<h2>Formatting</h2>" +
    "<table class='shortcuts-table'>" +
    "<tr><td>Title (Heading 1, Centered)</td><td>Ctrl + T</td></tr>" +
    "<tr><td>Headings</td><td>Ctrl + (1-4)</td></tr>" +
    "<tr><td>Clear Heading</td><td>Ctrl + 0</td></tr>" +
    "<tr><td>Left Align</td><td>Ctrl + L</td></tr>" +
    "<tr><td>Right Align</td><td>Ctrl + R</td></tr>" +
    "<tr><td>Center Align</td><td>Ctrl + E</td></tr>" +
    "<tr><td>Justify Align</td><td>Ctrl + J</td></tr>" +
    "<tr><td>Strikethrough</td><td>Ctrl + -</td></tr>" +
    "<tr><td>Italics</td><td>Ctrl + I</td></tr>" +
    "<tr><td>Bold</td><td>Ctrl + B</td></tr>" +
    "<tr><td>Underline</td><td>Ctrl + U</td></tr>" +
    "</table>";

    var closeBtn = createButton("Close");
    closeBtn.onclick = function(){
      closePopups();
    };
    popup.appendChild(closeBtn);

    document.body.appendChild(popup);
    closeBtn.focus();
}
