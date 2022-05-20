function showShortcutsHelp(){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup", "popup-shortcuts");

    var shortcuts = [
      {
        title: "Navigation",
        shortcuts: [
          ['View Previous Chapter', 'Ctrl + Up'],
          ['View Next Chapter', 'Ctrl + Down'],
          ['Shift Focus To Editor', 'Ctrl + Left'],
          ['Shift Focus To Notes', 'Ctrl + Right']
        ]
      },
      {
        title: "Alteration",
        shortcuts: [
          ['Move Chapter Up', 'Ctrl + Shift + Up'],
          ['Move Chapter Down', 'Ctrl + Shift + Down'],
          ['Change Chapter Label', 'Ctrl + Shift + Left']
        ]
      },
      {
        title: "Formatting",
        shortcuts: [
          ['Title (Heading 1, Centered)', 'Ctrl + T'],
          ['Headings', 'Ctrl + (1-4)'],
          ['Clear Heading', 'Ctrl + 0'],
          ['Left Align', 'Ctrl + L'],
          ['Right Align', 'Ctrl + R'],
          ['Center Align', 'Ctrl + E'],
          ['Justify Align', 'Ctrl + J'],
          ['Strikethrough', 'Ctrl + -'],
          ['Italics', 'Ctrl + I'],
          ['Bold', 'Ctrl + B'],
          ['Underline', 'Ctrl + U']
        ]
      },
      {
        title: "Tool/Menu Navigation",
        shortcuts: [
          ['Open/Navigate File Menu', 'Alt, then arrow keys'],
          ['Close Tool Dialog', "Escape"],
          ['Any Button With A Bold/\rUnderlined Letter', 'Alt + (that letter)']
        ]
      }
    ];

    shortcuts.forEach(function(short){
      var title = document.createElement('h2');
      title.innerText = short.title;
      popup.appendChild(title);

      var shortcutsTable = document.createElement('table');
      shortcutsTable.classList.add('shortcuts-table');

      short.shortcuts.forEach(function(cut){
        var row = document.createElement('tr');

        var shortLabel = document.createElement('td');
        shortLabel.innerText = cut[0];
        row.appendChild(shortLabel);

        var shortKeys = document.createElement('td');
        shortKeys.innerText = cut[1];
        row.appendChild(shortKeys);

        shortcutsTable.appendChild(row);
      });

      popup.appendChild(shortcutsTable);
    });

    var closeBtn = createButton("Close");
    closeBtn.onclick = function(){
      closePopups();
    };
    popup.appendChild(closeBtn);

    document.body.appendChild(popup);
    closeBtn.focus();
}
