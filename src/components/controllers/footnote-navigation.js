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
function footnoteEnterBinding(quill){
  return function(range){
    var beforeMarker = markerAt(quill, range.index);
    if(beforeMarker == null)
      return true;

    jumpToFootnoteBody(quill, beforeMarker);
    return false;
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

function jumpToFootnoteMarker(quill, id){
  var target = footnoteMarkerIndex(quill, id);
  if(target === -1)
    return;

  quill.setSelection(target + 1, 0, 'user');
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

function handleCopy(quill, e){
  var selection = window.getSelection();
  if(!selection || selection.rangeCount === 0)
    return;

  var range = selection.getRangeAt(0);
  if(range.collapsed)
    return;

  var container = document.createElement('div');
  container.appendChild(range.cloneContents());

  var markers = container.querySelectorAll('.ww-fnref[data-n]');
  if(markers.length === 0)
    return;

  markers.forEach(function(markerEl){
    var bodyOps = footnoteBodyOps(quill, markerEl.getAttribute('data-n'));
    if(bodyOps)
      markerEl.setAttribute('data-fn-body', JSON.stringify(bodyOps));
  });

  //A plain-text flavour spells the marker as "[^N]" rather than carrying the (invisible, in plain
  //text) guard characters an embed's DOM leaves behind - matching what a writer would type by hand.
  var plainContainer = container.cloneNode(true);
  plainContainer.querySelectorAll('.ww-fnref[data-n]').forEach(function(markerEl){
    markerEl.replaceWith(document.createTextNode('[^' + markerEl.getAttribute('data-n') + ']'));
  });

  e.preventDefault();
  e.clipboardData.setData('text/html', container.innerHTML);
  e.clipboardData.setData('text/plain', plainContainer.textContent);
}

function handleCut(quill, e){
  var selection = quill.getSelection();

  handleCopy(quill, e);

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
