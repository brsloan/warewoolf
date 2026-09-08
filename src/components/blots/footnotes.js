const Quill = require('quill');
const Parchment = Quill.import('parchment');
const Embed = Quill.import('blots/embed');

//The footnote marker: a length-1 atomic embed, so a writer can never half-delete the number or
//land the caret inside it - blots/embed.js's U+FEFF guard nodes make typing on either side of it
//behave, for free. `data-n` is what CSS reads to render the visible number (see src/css/index.css)
//and what static value(node) reads back on paste - matchBlot (modules/clipboard.js) calls it to
//reconstruct the embed, which is also how a copied marker's body payload survives the clipboard
//(see footnote-navigation.js's copy/cut handling).
class FootnoteRef extends Embed {
  static create(value){
    var node = super.create(value);
    node.setAttribute('data-n', value && value.n != null ? String(value.n) : '');

    //Only ever present on a marker that has just arrived from a paste - the reconcile pass
    //materializes it into a real body and strips this the moment it next runs.
    if(value && value.payload != null)
      node.setAttribute('data-fn-body', JSON.stringify(value.payload));
    else
      node.removeAttribute('data-fn-body');

    return node;
  }

  static value(node){
    var value = { n: node.getAttribute('data-n') || '' };
    var payloadRaw = node.getAttribute('data-fn-body');

    if(payloadRaw){
      try{
        value.payload = JSON.parse(payloadRaw);
      }
      catch(err){
        //A malformed payload is worth ignoring rather than throwing the whole paste away - the
        //marker still comes back, just as an orphan rather than with a body attached.
      }
    }

    return value;
  }
}
FootnoteRef.blotName = 'footnote';
FootnoteRef.tagName = 'sup';
FootnoteRef.className = 'ww-fnref';

//The footnote body: a plain attribute on whatever block already exists there, the same mechanism
//align already uses, rather than a Blot that replaces the block's own element the way
//blockquote/header do. It has to work this way rather than as a Blot: a body paragraph can be a
//list item at the same time (see docs/footnotes-plan.md's "[>c] [^1]: - item" example), and only
//one block-replacing Blot can own a line at once - an attribute stacks with whichever one is there.
//
//Named "footnoteBody" rather than "footnote", even though the marker embed above is happy to be
//named "footnote" as the plan documents it: Quill.register() keys its whole imports table by that
//one string regardless of whether what's registered is a Blot or an Attributor, so a marker and a
//body sharing a name make the second registration silently clobber the first there - the symptom
//is `BlotClass.create is not a function` the first time either format is actually used, since
//whichever one lost the race no longer has a working entry. Parchment's own registry does keep
//blots and attributes separate; this is purely a Quill 1.3.7 constraint on top of it.
const FootnoteBodyAttributor = new Parchment.Attributor.Attribute('footnoteBody', 'data-footnote', {
  scope: Parchment.Scope.BLOCK
});

var registered = false;

function registerFootnoteBlots(){
  if(registered)
    return;

  Quill.register(FootnoteRef);
  Quill.register(FootnoteBodyAttributor);
  registered = true;
}

module.exports = { FootnoteRef, FootnoteBodyAttributor, registerFootnoteBlots };
