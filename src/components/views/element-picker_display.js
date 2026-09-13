const { describeDialog } = require('../controllers/utils');
const { insertElement, setElement } = require('../controllers/screenplay-editor');
const { ELEMENT_NAMES } = require('../blots/screenplay');

//The element picker, the Insert/Convert Menu: every type a script line can be, in one list, for
//the types with no key of their own - a section, a synopsis, a note, a lyric, a page break - and
//for a writer who has not learned the keys. Enter
//opens a new line of the chosen type the way the element shortcuts do (insertElement); Shift+Enter
//makes the current line the type instead (setElement), which is the reformat shortcuts' job;
//Escape closes it. Hand-built DOM in the style of blocked-action_display.js, and one at a time:
//opening it again replaces the one showing.

//Every type but boneyard, which is text commented out of the script rather than something to
//insert. Its own order - the types a writer reaches for most, first - rather than the blots
//module's; the names come from there (ELEMENT_NAMES), so the list here and the Format block at the
//foot of the notes panel always call the same type the same thing.
const INSERTABLE = ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition',
  'centered', 'section', 'synopsis', 'note', 'lyric', 'pagebreak'];

const ELEMENTS = INSERTABLE.map(function(type){ return [type, ELEMENT_NAMES[type]]; });

function showElementPicker(quill){
  var range = quill.getSelection(true);
  if(!range)
    return;

  closeElementPicker();

  var popup = document.createElement('div');
  popup.id = 'element-picker';
  popup.classList.add('popup');

  var heading = document.createElement('p');
  heading.innerText = 'Insert/Convert Menu';
  popup.appendChild(heading);
  describeDialog(popup, heading, 'dialog');

  var hint = document.createElement('p');
  hint.className = 'element-picker-hint';
  hint.innerText = 'Enter inserts a new line of the type. Shift+Enter makes the current line the type. Escape cancels.';
  popup.appendChild(hint);

  var list = document.createElement('div');
  list.className = 'element-picker-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Element');
  list.tabIndex = 0;
  popup.appendChild(list);

  var selected = 0;

  function render(){
    while(list.firstChild)
      list.removeChild(list.firstChild);

    ELEMENTS.forEach(function(pair, i){
      var item = document.createElement('div');
      item.className = 'suggestion' + (i === selected ? ' suggestion-selected' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', i === selected ? 'true' : 'false');
      item.textContent = pair[1];
      item.onmousedown = function(e){
        e.preventDefault();
        selected = i;
        pick(false);
      };
      list.appendChild(item);
    });
  }

  function pick(reformat){
    var type = ELEMENTS[selected][0];
    closeElementPicker();
    quill.focus();
    if(reformat)
      setElement(quill, type, range);
    else
      insertElement(quill, type, range);
  }

  list.onkeydown = function(e){
    if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + ELEMENTS.length) % ELEMENTS.length;
      render();
      e.preventDefault();
    }
    else if(e.key === 'Enter'){
      pick(e.shiftKey);
      e.preventDefault();
    }
    else if(e.key === 'Escape'){
      closeElementPicker();
      quill.focus();
      quill.setSelection(range.index, range.length, 'silent');
      e.preventDefault();
    }
  };

  render();
  document.body.appendChild(popup);
  list.focus();
}

function closeElementPicker(){
  var popup = document.getElementById('element-picker');
  if(popup)
    popup.remove();
}

module.exports = showElementPicker;
module.exports.ELEMENTS = ELEMENTS;
