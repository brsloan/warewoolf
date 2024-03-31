const { closePopups, createButton, removeElementsByClass } = require('../controllers/utils');


function showShortcutsHelp(isMac){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup", "popup-shortcuts");

    const cmdOrCtrl = isMac ? 'Cmd' : 'Ctrl';

    var shortcuts = [
      {
        title: "Navigation",
        shortcuts: [
          ['View Previous Chapter', cmdOrCtrl + ' + Up'],
          ['View Next Chapter', cmdOrCtrl + ' + Down'],
          ['Shift Focus To Editor', cmdOrCtrl + ' + Left'],
          ['Shift Focus To Notes', cmdOrCtrl + ' + Right']
        ]
      },
      {
        title: "Alteration",
        shortcuts: [
          ['Move Chapter Up', cmdOrCtrl + ' + Shift + Up'],
          ['Move Chapter Down', cmdOrCtrl + ' + Shift + Down'],
          ['Change Chapter Label', cmdOrCtrl + ' + Shift + Left']
        ]
      },
      {
        title: "Formatting",
        shortcuts: [
          ['Title (Heading 1, Centered)', cmdOrCtrl + ' + T'],
          ['Headings', cmdOrCtrl + ' + (1-4)'],
          ['Clear Heading', cmdOrCtrl + ' + 0'],
          ['Left Align', cmdOrCtrl + ' + L'],
          ['Right Align', cmdOrCtrl + ' + R'],
          ['Center Align', cmdOrCtrl + ' + E'],
          ['Justify Align', cmdOrCtrl + ' + J'],
          ['Strikethrough', cmdOrCtrl + ' + K'],
          ['Italics', cmdOrCtrl + ' + I'],
          ['Bold', cmdOrCtrl + ' + B'],
          ['Underline', cmdOrCtrl + ' + U']
        ]
      },
      {
        title: "Tool/Menu Navigation",
        shortcuts: [
          ['Open/Navigate File Menu', isMac ? 'Cmd + M, then arrow keys and Escape' : 'Alt, then arrow keys and Escape'],
          ['Close Tool Dialog', "Escape"],
          ['Any Button With A Bold/\rUnderlined Letter', 'Alt + (that letter)'],
          ['Move Between Inputs', 'Tab']
        ]
      },
      {
        title: "Display",
        shortcuts: [
          ['Adjust Editor Width', cmdOrCtrl + ' + < or >'],
          ['Adjust Font Size', cmdOrCtrl + ' + - or +'],
          ['Toggle Chapter List Display', 'F1'],
          ['Toggle Editor Display', 'F2'],
          ['Toggle Notes Display', 'F3'],
          ['Typewriter Mode', cmdOrCtrl + ' + Alt + T']
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

    popup.appendChild(document.createElement('br'));

    var closeBtn = createButton("Close");
    closeBtn.onclick = function(){
      closePopups();
    };
    popup.appendChild(closeBtn);

    document.body.appendChild(popup);
    closeBtn.focus();
    popup.scrollTop = 0;
}

module.exports = showShortcutsHelp;