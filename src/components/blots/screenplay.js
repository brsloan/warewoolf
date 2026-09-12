const Quill = require('quill');
const Parchment = Quill.import('parchment');

//The screenplay formats: three block-level attributors and no blots of their own. See
//docs/screenplay-plan.md, "Representation", and "What the old branch taught" for why an attributor
//and not a Block subclass per element type - changing a line's type is then one class swap rather
//than a blot replacement, and Quill's own Backspace merge (modules/keyboard.js handleBackspace),
//which diffs the two lines' formats, gives the joined line the previous line's type with no
//override needed.
//
//`element` is the line's type, absent for action - Fountain's own default and the editor's, so a
//plain paragraph pasted in is already right. Rendered by CSS on the class (`sp-scene`,
//`sp-character`, ...); nothing reads the class back except Parchment itself.
const ELEMENT_TYPES = ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition',
  'centered', 'section', 'synopsis', 'note', 'boneyard', 'lyric', 'pagebreak'];

const ElementAttributor = new Parchment.Attributor.Class('element', 'sp', {
  scope: Parchment.Scope.BLOCK,
  whitelist: ELEMENT_TYPES.filter(function(type){ return type !== 'action'; })
});

//A boolean block flag. Parchment stores every attributor's value as a string on the node and
//hands the string back, so a delta that said `tight: true` would come back from the DOM saying
//`tight: 'true'` and no two deltas would ever compare equal. Coerced both ways here, once, so the
//codec, the editor and every test speak in booleans. A data attribute rather than a class, so its
//name cannot share a prefix with `sp-` above: Parchment's class attributor matches its classes by
//prefix, and `element` removing every `sp-*` class on a type change would take a `sp-tight` with it.
class FlagAttributor extends Parchment.Attributor.Attribute {
  canAdd(node, value){
    return super.canAdd(node, value === true ? 'true' : value);
  }

  add(node, value){
    return super.add(node, value === true ? 'true' : value);
  }

  //Only ever asked for a node that carries the attribute - the store is built from the attributes
  //present - so the answer is true, never false: a `tight: false` in a delta is a different delta.
  value(node){
    return true;
  }
}

//This line followed the one above with no blank line between them in the file. Quill has no soft
//line break, so each line is its own block and this is what lets the codec put a multi-line
//element back without a blank line. Shift+Enter makes one; rendered with no top margin.
const TightAttributor = new FlagAttributor('tight', 'data-sp-tight', {
  scope: Parchment.Scope.BLOCK,
  whitelist: ['true']
});

//The ^ dual-dialogue marker on a character cue. Preserved and shown with a marker, not laid out
//side by side - that is a print concern.
const DualAttributor = new FlagAttributor('dual', 'data-sp-dual', {
  scope: Parchment.Scope.BLOCK,
  whitelist: ['true']
});

var registered = false;

//Must run before the editor is constructed - scroll.js's whitelist is built from the `formats`
//option, and Parchment has to know the attributor exists before that whitelist can name it. Same
//constraint, and same one-shot guard, as registerFootnoteBlots.
function registerScreenplayFormats(){
  if(registered)
    return;

  Quill.register(ElementAttributor);
  Quill.register(TightAttributor);
  Quill.register(DualAttributor);
  registered = true;
}

module.exports = {
  ELEMENT_TYPES,
  SCREENPLAY_FORMATS: ['element', 'tight', 'dual'],
  ElementAttributor,
  TightAttributor,
  DualAttributor,
  registerScreenplayFormats
};
