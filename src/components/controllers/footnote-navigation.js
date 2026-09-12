const { isFootnoteMarker } = require('./quill-utils');
const { toLines } = require('./reconcile-footnotes');

//Ctrl+Alt+F (SHORTCUT_DEFS's insertFootnote). Context-sensitive, which gives the back-jump a home
//without overloading a key that already means something - see docs/footnotes-plan.md's Phase 3:
//
//  caret immediately before a marker -> jump to that note's body
//  caret inside a note body          -> jump back to its marker
//  otherwise                         -> insert a marker, append an empty body, put the caret in it
function insertOrJumpFootnote(quill){
  var range = quill.getSelection(true);
  if(!range)
    return;

  var beforeMarker = markerAt(quill, range.index);
  if(beforeMarker != null){
    jumpToFootnoteBody(quill, beforeMarker);
    return;
  }

  var format = quill.getFormat(range);
  if(format && format.footnoteBody != null){
    jumpToFootnoteMarker(quill, String(format.footnoteBody));
    return;
  }

  insertNewFootnote(quill, range.index);
}

//Quill's own Enter handler is added unconditionally in the Keyboard constructor, after the named
//`options.bindings` loop - so quillBindingsToDisable() in render.js cannot reach it, and this has
//to be unshifted directly onto keyboard.bindings[13] instead (see render.js's setup). listen() stops
//at the first handler that returns something other than literal `true`, so returning true here is
//what lets Quill's own Enter handler still run on everything but the one case this owns.
//
//The whole binding rather than a bare handler, so the one condition that decides whether this
//owns the keypress at all travels with it. `collapsed: true` is that condition: markerAt() below
//looks at range.index, which for a selection is where it *starts*, so without it a writer who had
//selected a run of text beginning immediately before a marker would find Enter jumping to the note
//instead of replacing what they had selected. Quill checks it in listen() before calling any
//handler, which is what makes Enter with a selection fall to Quill's own handler untouched.
function footnoteEnterBinding(quill){
  return {
    key: 13,
    collapsed: true,
    handler: function(range){
      var beforeMarker = markerAt(quill, range.index);
      if(beforeMarker == null)
        return true;

      jumpToFootnoteBody(quill, beforeMarker);
      return false;
    }
  };
}

//Detection is getContents(index, 1) and a check for an object insert - no leaf walking.
function markerAt(quill, index){
  var op = quill.getContents(index, 1).ops[0];
  return isFootnoteMarker(op && op.insert) ? String(op.insert.footnote.n) : null;
}

function jumpToFootnoteBody(quill, id){
  var target = footnoteBodyStart(quill, id);
  if(target === -1)
    return;

  quill.setSelection(target, 0, 'user');
  scrollIntoView(quill, target);
}

//The caret lands immediately *before* the marker, not after it: that is the one position
//insertOrJumpFootnote reads as "jump to this note's body", so the shortcut round-trips - press it
//again and you are back in the body you came from, and again to return here.
function jumpToFootnoteMarker(quill, id){
  var target = footnoteMarkerIndex(quill, id);
  if(target === -1)
    return;

  quill.setSelection(target, 0, 'user');
  scrollIntoView(quill, target);
}

function footnoteMarkerIndex(quill, id){
  var index = 0;
  var found = -1;

  quill.getContents().ops.forEach(function(op){
    var len = typeof op.insert === 'string' ? op.insert.length : 1;
    if(found === -1 && isFootnoteMarker(op.insert) && String(op.insert.footnote.n) === id)
      found = index;
    index += len;
  });

  return found;
}

function footnoteBodyStart(quill, id){
  var lines = toLines(quill.getContents().ops);
  var index = 0;

  for(let i = 0; i < lines.length; i++){
    if(lines[i].line.attributes && String(lines[i].line.attributes.footnoteBody) === id)
      return index;

    index += lines[i].content.reduce(function(sum, op){
      return sum + (typeof op.insert === 'string' ? op.insert.length : 1);
    }, 0) + 1;
  }

  return -1;
}

//Every line whose body carries `id`, as delta ops - the shape footnote-navigation's copy/cut
//handling attaches to a marker as its clipboard payload, and reconcile-footnotes.js's
//materializePayloads reads back on paste. Scans the whole document rather than assuming
//contiguity, matching reconcileFootnotes' own grouping.
function footnoteBodyOps(quill, id){
  var ops = [];

  toLines(quill.getContents().ops).forEach(function(l){
    if(l.line.attributes && String(l.line.attributes.footnoteBody) === id){
      ops = ops.concat(l.content);
      ops.push(l.line);
    }
  });

  return ops.length > 0 ? ops : null;
}

function insertNewFootnote(quill, index){
  var Quill = require('quill');
  var Delta = Quill.import('delta');
  var n = nextFootnoteNumber(quill);
  var originalLength = quill.getLength();

  //One delta, one undo entry: the marker goes in inline at the caret, and a fresh empty body is
  //appended at the true end of the document (retaining all the way through the original trailing
  //'\n' before inserting again is what lands the new line's own attributed '\n' after it, rather
  //than stealing the caret's own paragraph as the body).
  var delta = new Delta()
    .retain(index)
    .insert({ footnote: { n: n } })
    .retain(originalLength - index)
    .insert('\n', { footnoteBody: n });

  quill.updateContents(delta, 'user');

  var newBodyIndex = originalLength + 1;
  quill.setSelection(newBodyIndex, 0, 'user');
  scrollIntoView(quill, newBodyIndex);
}

function nextFootnoteNumber(quill){
  var highest = 0;

  quill.getContents().ops.forEach(function(op){
    if(isFootnoteMarker(op.insert)){
      var n = Number(op.insert.footnote.n);
      if(!isNaN(n) && n > highest)
        highest = n;
    }
  });

  return String(highest + 1);
}

function scrollIntoView(quill, index){
  var bounds = quill.getBounds(index);
  if(!bounds)
    return;

  if(bounds.top < 0 || bounds.bottom > quill.root.clientHeight)
    quill.root.scrollTop += bounds.top - quill.root.clientHeight / 2;
}

//Copy and cut are intercepted on quill.root so a footnote's body - which lives elsewhere in the
//document, or in a document that isn't even open - can ride along with a copied marker. Nothing in
//the live editor is mutated by this, so Quill's MutationObserver never sees any of it, and copying
//into Word or a browser still behaves exactly as it does today when no marker is involved.
function attachFootnoteClipboard(quill){
  quill.root.addEventListener('copy', function(e){ handleCopy(quill, e); });
  quill.root.addEventListener('cut', function(e){ handleCut(quill, e); });
}

//Returns whether it took the event over. Only a selection that actually contains a marker needs
//this treatment at all; everything else is left entirely to the browser's own copy/cut, which is
//what Quill has always relied on. handleCut below reads the answer rather than assuming one -
//deleting the text itself while the native cut is still armed leaves two mechanisms racing to
//remove the same characters, with no clipboard written by either.
function handleCopy(quill, e){
  var selection = window.getSelection();
  if(!selection || selection.rangeCount === 0)
    return false;

  var range = selection.getRangeAt(0);
  if(range.collapsed)
    return false;

  var container = document.createElement('div');
  container.appendChild(range.cloneContents());

  var markers = container.querySelectorAll('.ww-fnref[data-n]');
  if(markers.length === 0)
    return false;

  markers.forEach(function(markerEl){
    var bodyOps = footnoteBodyOps(quill, markerEl.getAttribute('data-n'));
    if(bodyOps)
      markerEl.setAttribute('data-fn-body', JSON.stringify(bodyOps));
  });

  e.preventDefault();
  e.clipboardData.setData('text/html', container.innerHTML);
  e.clipboardData.setData('text/plain', plainTextForSelection(quill, container));

  return true;
}

//The plain-text flavour, spelling each marker "[^N]" rather than carrying the (invisible, in plain
//text) guard characters an embed's DOM leaves behind - what a writer would have typed by hand.
//
//Built from the selection's own delta rather than from the cloned DOM's textContent, which is
//where the paragraph breaks come from: textContent runs the blocks together, so copying several
//paragraphs and pasting them anywhere outside the app produced one unbroken line. The delta has a
//real '\n' at every paragraph end, so they survive.
function plainTextForSelection(quill, container){
  var range = quill.getSelection();

  //Nothing but a guard: the DOM selection this was called for is a non-collapsed one inside this
  //editor, so Quill has a range for it. Falling back to the flattened text is still better than
  //writing nothing, since preventDefault has left this the only plain text the clipboard will get.
  if(range == null || range.length === 0)
    return container.textContent;

  return quill.getContents(range.index, range.length).ops.map(function(op){
    if(typeof op.insert === 'string')
      return op.insert;

    return isFootnoteMarker(op.insert) ? '[^' + op.insert.footnote.n + ']' : '';
  }).join('');
}

function handleCut(quill, e){
  var selection = quill.getSelection();

  //Nothing to carry, so the native cut does both halves itself, exactly as it did before footnotes
  //existed. Deleting the text here as well would be deleting it twice over - and since handleCopy
  //never called preventDefault or wrote anything to the clipboard on this path, the browser would
  //be left to copy a selection this function had already removed.
  if(!handleCopy(quill, e))
    return;

  //Ordering is load-bearing: the clipboard is written first (handleCopy, above, already has
  //everything it needs off the live DOM), the deletion applies second, and only then does the
  //structural half of the reconcile pass - run from render.js's own text-change handler - delete
  //the now-orphaned body.
  if(selection && selection.length > 0)
    quill.deleteText(selection.index, selection.length, 'user');
}

module.exports = {
  insertOrJumpFootnote,
  footnoteEnterBinding,
  attachFootnoteClipboard,
  markerAt,
  footnoteBodyOps
};
