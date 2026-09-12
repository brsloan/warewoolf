const { parseDelta } = require('./quill-utils');
const { ELEMENT_TYPES } = require('../blots/screenplay');

//The editor side of screenplay mode - see docs/screenplay-plan.md, "The editor". Everything here
//is a function of a Quill instance and a delta; nothing reads the DOM for content.

//Loads a script into the editor by building its HTML and letting Parchment read it in one pass,
//rather than through setContents(). setContents is quadratic in the number of lines in Quill
//1.3.7: applyDelta (core/editor.js) formats each line with a scroll.formatAt that finds its line
//by walking the scroll's children from the head, so a 2,700-line script took seconds. Assigning
//the HTML and calling update() is the same path a native paste takes - the MutationObserver's
//records are taken and every added node is built into a blot in one linear walk - and measured
//at a third of the cost with attributors and a sixth with the old branch's blots.
//
//One invariant makes this safe: the HTML only ever comes from the delta, through
//deltaToScreenplayHtml below, never from a file or the clipboard. Silent, so the text-change
//handler (which acts on 'user' only) marks nothing dirty; the history is cleared because a load
//is not something to undo.
function loadScreenplayDelta(quill, delta){
  quill.root.innerHTML = deltaToScreenplayHtml(delta);
  quill.update('silent');
  quill.history.clear();
}

//One <p> per line with the element class Parchment's attributor reads back, the flags as the
//data attributes theirs read, and the three inline formats as the tags Quill's own blots match.
function deltaToScreenplayHtml(delta){
  var html = '';

  parseDelta(delta || { ops: [{ insert: '\n' }] }).paragraphs.forEach(function(para){
    var attributes = para.attributes || {};
    var open = '<p';
    if(ELEMENT_TYPES.indexOf(attributes.element) !== -1 && attributes.element !== 'action')
      open += ' class="sp-' + attributes.element + '"';
    if(attributes.tight)
      open += ' data-sp-tight="true"';
    if(attributes.dual)
      open += ' data-sp-dual="true"';
    open += '>';

    var inner = '';
    para.textRuns.forEach(function(run){
      if(typeof run.text !== 'string' || run.text === '')
        return;

      var text = escapeHtml(run.text);
      var styles = run.attributes || {};
      if(styles.underline) text = '<u>' + text + '</u>';
      if(styles.italic) text = '<em>' + text + '</em>';
      if(styles.bold) text = '<strong>' + text + '</strong>';
      inner += text;
    });

    //Quill's own empty line, which is what setContents would have built.
    html += open + (inner === '' ? '<br>' : inner) + '</p>';
  });

  return html;
}

function escapeHtml(text){
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = {
  loadScreenplayDelta,
  deltaToScreenplayHtml
};
