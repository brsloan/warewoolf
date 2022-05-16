function showShortcutsHelp(){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    popup.innerHTML =
    "<h1>Shortcuts</h1>" +
    "<h2>Navigation</h2>" +
    "<p>View Previous Chapter: Ctrl + Up</p>" +
    "<p>View Next Chapter: Ctrl + Down</p>" +
    "<p>Shift Focus To Editor: Ctrl + Left</p>" +
    "<p>Shift Focus To Notes: Ctrl + Right</p>" +
    "<h2>Alteration</h2>" +
    "<p>Move Chapter Up: Ctrl + Shift + Up</p>" +
    "<p>Move Chapter Down: Ctrl + Shift + Down</p>" +
    "<p>Change Chapter Label: Ctrl + Shift + Left</p>" +
    "<h2>Formatting</h2>" +
    "<p>Title (Heading 1, Centered): Ctrl + T</p>" +
    "<p>Headings: Ctrl + (1-4)</p>" +
    "<p>Left Align: Ctrl + L</p>" +
    "<p>Right Align: Ctrl + R</p>" +
    "<p>Center Align: Ctrl + E</p>" +
    "<p>Justify Align: Ctrl + J</p>" +
    "<p>Strikethrough: Ctrl + -</p>" +
    "<p>Italics: Ctrl + I</p>" +
    "<p>Bold: Ctrl + B</p>" +
    "<p>Underline: Ctrl + U</p>";

    var closeBtn = createButton("Close");
    closeBtn.onclick = function(){
      popup.remove();
    };
    popup.appendChild(closeBtn);

    document.body.appendChild(popup);
    closeBtn.focus();
}
