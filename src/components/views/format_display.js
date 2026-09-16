const { ELEMENT_NAMES } = require('../blots/screenplay');

//The Format block: the foot of the notes panel, which while a script is in the editor says what
//the line the caret is on is - "Scene Heading", "Dialogue", "Action". A script's elements are
//invisible in the way a heading level is not: the layout is the only thing that distinguishes a
//cue from a transition, and two types can be laid out alike (a section and a synopsis, an action
//line and a centered one), so a writer who reformats by Tab has nothing that tells them which of
//the two they landed on. This is that.
//
//It lives in the notes panel rather than a bar of its own so it goes away with the rest of the
//panel: a writer who has hidden the notes has asked for the manuscript and nothing else, and this
//is of a piece with the notes, not with the script. Hidden entirely for prose, where a line has no
//element to show.
//
//Deliberately not a live region. It changes because the caret moved, and a screen reader has just
//read the line the caret moved to - announcing the type on top of that would be a second voice on
//every arrow key. A reader that wants it can navigate to the block, which is named by its heading.
function showElementFormat(type){
  var block = document.getElementById('format-block');
  var value = document.getElementById('format-element');

  if(!block || !value)
    return;

  block.hidden = type == null;

  //An unknown type would be a delta carrying an element the blots module does not define, which
  //Parchment's whitelist does not allow through - but the block says what it has rather than going
  //blank if one ever arrives.
  value.textContent = type == null ? '' : (ELEMENT_NAMES[type] || type);
}

module.exports = { showElementFormat };
