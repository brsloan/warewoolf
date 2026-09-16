const { createButton, describeDialog } = require('../controllers/utils');

//What Characters/Locations asks before it rewrites a script. A rename is not one edit but every
//line the name is written into, and for a character that reaches past his cues into action,
//dialogue and the headings of the rooms he owns - so the writer is told how far it goes, and what
//it can get wrong, before any of it is written.
//
//What it can get wrong is one thing: a capital at the start of a sentence belongs to the sentence
//as much as to a name, so a character called WILL turns "Will you come?" into "Ben you come?".
//That is said rather than shown. Listing those lines was tried and taken out again: on a feature
//script there are far more of them than anyone would read through, and a list too long to be read
//is a worse warning than a sentence, not a better one. Ctrl+Z takes the whole rename back, which
//is the answer when it does happen.
//
//Stacked over the Characters/Locations popup rather than replacing it, the way the delete
//confirmation stacks: answering it returns the writer to the list they were working in.
//
//`change` is { from, to, nameNoun, nameLines, otherLines }.
function showRenameConfirmation(change, onConfirm){
  //Holding Enter on the rename field, or clicking through twice, would otherwise stack a second
  //copy over the first and leave one behind once the visible one was answered - the guard
  //delete-confirmation_display.js makes for the same reason.
  if(document.querySelector('.rename-confirm-popup'))
    return null;

  var popup = document.createElement('div');
  popup.classList.add('popup', 'rename-confirm-popup');

  var heading = document.createElement('h1');
  heading.innerText = 'Rename ' + change.from + ' to ' + change.to + '?';
  popup.appendChild(heading);
  describeDialog(popup, heading, 'alertdialog');

  var message = document.createElement('p');
  message.innerText = 'This rewrites ' + describeCounts(change) + '.';
  popup.appendChild(message);

  if(change.otherLines > 0){
    var caution = document.createElement('p');
    caution.classList.add('warning-text');
    caution.innerText = 'Outside its own ' + change.nameNoun + 's the name is replaced everywhere it is '
      + 'written with a capital or all caps. '
      + 'A word spelled like the name may be replaced by mistake where a sentence begins with it. '
      + 'Ctrl+Z takes the whole rename back.';
    popup.appendChild(caution);
  }

  //Named for what it does rather than Yes, so the button and the heading answer each other, and
  //focused the way the delete confirmation focuses its Yes: the writer asked for this, and undo is
  //behind it either way.
  var renameBtn = createButton('Rename');
  renameBtn.onclick = function(){
    popup.remove();
    return onConfirm();
  };

  var cancelBtn = createButton('Cancel');
  cancelBtn.onclick = function(){
    popup.remove();
  };

  popup.appendChild(renameBtn);
  popup.appendChild(cancelBtn);
  document.body.appendChild(popup);
  renameBtn.focus();

  return popup;
}

//"1 cue and 5 other lines of the script", never a count of zero, which reads as a warning about
//something that is not going to happen.
function describeCounts(change){
  var parts = [];

  if(change.nameLines > 0)
    parts.push(plural(change.nameLines, change.nameNoun, change.nameNoun + 's'));
  if(change.otherLines > 0)
    parts.push(plural(change.otherLines, 'other line', 'other lines') + ' of the script');

  return parts.join(' and ');
}

function plural(n, one, many){
  return n + ' ' + (n === 1 ? one : many);
}

module.exports = showRenameConfirmation;
