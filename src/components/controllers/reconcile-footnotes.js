const { flattenInserts, isFootnoteMarker } = require('./quill-utils');

//Everything here is pure delta-in/delta-out, with no Quill instance and no DOM - see
//docs/footnotes-plan.md's "The reconcile pass". That is what lets the live editor, save, split,
//import and compile all share one implementation instead of five approximations of it, and what
//lets it be tested the way test/delta-to-docx.test.js already tests delta transforms: plain
//literal ops in, plain literal ops compared out.

//A "line" is a paragraph's content ops plus the op that terminates it - the same shape parseDelta
//in quill-utils.js builds, but keeping the terminating op itself (not just its attributes) rather
//than discarding it is what lets fromLines() below reproduce the delta exactly.
//
//Every op is copied on the way in, which is what makes the passes below genuinely pure. They do
//not all rewrite a marker by building a new line the way the body steps build a new line object -
//materializePayloads, renumberAndReorder and namespaceFootnotes each assign straight to
//`op.insert` - and flattenInserts hands back the caller's own op object, untouched, for anything
//whose insert is not a string (which is every embed, footnote markers included). Without this
//copy those assignments reach back into the delta the caller passed in, and every caller here
//diffs its result against that same delta to decide what to apply: render.js's two live-editor
//passes, chapter.js's save, and compile.js's per-chapter namespacing. A mutated base makes the
//marker half of the diff cancel out, so marker numbers never reach the editor and a pasted
//marker's payload is never stripped - which materializes a fresh copy of the note body on every
//keystroke after a paste. A shallow copy is enough: nothing below edits an insert object in
//place, they replace it wholesale.
function toLines(ops){
  var lines = [];
  var content = [];

  flattenInserts(ops || []).forEach(function(original){
    var op = Object.assign({}, original);

    if(op.insert === '\n'){
      lines.push({ content: content, line: op });
      content = [];
    }
    //flattenInserts leaves a trailing empty-string op behind whenever a multi-line insert's text
    //ends exactly on a '\n' (splitting "wait--\n" on '\n' yields ['wait--', ''], and that '' has
    //no partner newline of its own to close a real line with) - contributing nothing, and skipped
    //rather than carried into `content`, which is what stops the trailing-content guard below from
    //mistaking it for real, unterminated text and inventing a phantom empty paragraph after it.
    else if(op.insert !== ''){
      content.push(op);
    }
  });

  //A well-formed delta always ends with a line-terminating '\n', so this should never fire - but
  //guard rather than silently drop trailing content if it ever does.
  if(content.length > 0)
    lines.push({ content: content, line: { insert: '\n' } });

  return lines;
}

function fromLines(lines){
  var ops = [];

  lines.forEach(function(l){
    ops = ops.concat(l.content);
    ops.push(l.line);
  });

  return ops;
}

function finalizeDelta(ops){
  return { ops: ops.length > 0 ? ops : [ { insert: '\n' } ] };
}

function footnoteMarkerId(op){
  return op && isFootnoteMarker(op.insert) && op.insert.footnote.n != null
    ? String(op.insert.footnote.n)
    : null;
}

//The marker embed and the body attribute are deliberately different format names, footnote and
//footnoteBody: Quill 1.3.7 keys its whole format registry by that one string, so an embed blot and
//a line attributor sharing a name silently clobber each other there (the second Quill.register()
//call overwrites the first's entry), even though nothing stops Parchment itself from telling an
//embed and an attribute apart. See blots/footnotes.js.
function footnoteBodyId(line){
  return line.attributes && line.attributes.footnoteBody != null ? String(line.attributes.footnoteBody) : null;
}

//The highest number any marker or body in the document is currently using, ignoring ids that are
//not numbers at all - compile.js namespaces a chapter's ids as "c0_1" before concatenating, and
//those are never in the same document as one this has to pick a number alongside. Bodies count as
//well as markers so that a number chosen here cannot land on an orphaned body still waiting to be
//pruned, which would silently adopt it into the note being materialized.
function highestFootnoteNumber(lines){
  var highest = 0;

  function consider(id){
    var n = Number(id);
    if(id != null && isFinite(n) && n > highest)
      highest = n;
  }

  lines.forEach(function(l){
    l.content.forEach(function(op){ consider(footnoteMarkerId(op)); });
    consider(footnoteBodyId(l.line));
  });

  return highest;
}

//Step 3 of the reconcile pass: a marker pasted in from footnote-navigation.js's copy/cut handling
//carries its body as delta JSON on the embed itself, since the body lives elsewhere in the
//document - or in a document that isn't even open - and cannot ride along in the DOM the way plain
//text does. Turns that payload into a real body, appended onto the end of `lines` (renumberAndReorder
//below is what actually relocates it next to the rest of the footnote region), and strips the
//payload from the marker so this step is a no-op the next time it runs.
//
//Mutates `lines` in place - appending during a forEach is safe here (forEach captures the length
//once, so newly appended lines are never revisited by this same pass) and matches the shape every
//other step in this file returns instead, rather than making this one an exception.
//
//The id a materialized note is given is the next number free in the document rather than an
//internal placeholder, because it is on screen the moment this pass is applied: the marker and the
//body both render their number straight from the id with a CSS ::before (see src/css/index.css),
//so a placeholder is a placeholder the writer can read. renumberAndReorder gives it its real
//number immediately afterwards - a number here only has to be plausible and unused until it does.
function materializePayloads(lines){
  var nextId = highestFootnoteNumber(lines) + 1;

  lines.forEach(function(l){
    l.content.forEach(function(op){
      if(!(isFootnoteMarker(op.insert) && op.insert.footnote.payload != null))
        return;

      var payload = op.insert.footnote.payload;
      var payloadOps = Array.isArray(payload) ? payload : (payload.ops || []);
      var tempId = String(nextId++);

      toLines(payloadOps).forEach(function(pl){
        pl.line = Object.assign({}, pl.line, {
          attributes: Object.assign({}, pl.line.attributes, { footnoteBody: tempId })
        });
        lines.push(pl);
      });

      op.insert = { footnote: { n: tempId } };
    });
  });
}

//A body whose marker no longer exists anywhere in the document - the marker itself was deleted, in
//the live editor's own text-change handling, this is what "deleting a marker deletes its body"
//actually does. Returns a new array; a body with a surviving marker (however far away) is kept.
function pruneOrphanBodies(lines){
  var markerIds = {};

  lines.forEach(function(l){
    l.content.forEach(function(op){
      var id = footnoteMarkerId(op);
      if(id != null)
        markerIds[id] = true;
    });
  });

  return lines.filter(function(l){
    var bodyId = footnoteBodyId(l.line);
    return bodyId == null || markerIds[bodyId];
  });
}

//Steps 1 and 2: numbers every marker 1..n in document order, and relocates each body group to sit
//after the prose, in that same order - multi-paragraph notes moving as one unit, since every line
//in the group is carried along together. A body whose marker is gone (pruneOrphanBodies wasn't run
//first, or the id was never valid to begin with) has no number to sort by, so it is left exactly
//where it already sits rather than invented a place in the footnote region - see the decision on
//pre-existing orphans in docs/footnotes-plan.md.
function renumberAndReorder(lines){
  var orderedOldIds = [];

  lines.forEach(function(l){
    l.content.forEach(function(op){
      var id = footnoteMarkerId(op);
      if(id != null && orderedOldIds.indexOf(id) === -1)
        orderedOldIds.push(id);
    });
  });

  var idMap = {};
  orderedOldIds.forEach(function(oldId, i){ idMap[oldId] = String(i + 1); });

  lines.forEach(function(l){
    l.content.forEach(function(op){
      var id = footnoteMarkerId(op);
      if(id != null)
        op.insert = { footnote: { n: idMap[id] } };
    });
  });

  var proseLines = [];
  var groupsByOldId = {};
  var groupOrder = [];

  lines.forEach(function(l){
    var oldId = footnoteBodyId(l.line);

    if(oldId == null || idMap[oldId] == null){
      proseLines.push(l);
      return;
    }

    if(!groupsByOldId[oldId]){
      groupsByOldId[oldId] = [];
      groupOrder.push(oldId);
    }
    groupsByOldId[oldId].push(l);
  });

  var bodyLines = [];
  groupOrder
    .sort(function(a, b){ return Number(idMap[a]) - Number(idMap[b]); })
    .forEach(function(oldId){
      groupsByOldId[oldId].forEach(function(l, indexInGroup){
        var attributes = Object.assign({}, l.line.attributes, { footnoteBody: idMap[oldId] });

        //Only a note's opening paragraph prints its number, so every paragraph after it in the
        //same group is marked as continuing it - and the opening one has any stale mark cleared,
        //since a group's paragraphs can have been reordered or its first one deleted since this
        //last ran. See blots/footnotes.js for why the document has to carry this rather than the
        //stylesheet working it out.
        if(indexInGroup > 0)
          attributes.footnoteBodyCont = true;
        else
          delete attributes.footnoteBodyCont;

        l.line = Object.assign({}, l.line, { attributes: attributes });
        bodyLines.push(l);
      });
    });

  return proseLines.concat(bodyLines);
}

//The structural half of the pass: materializing a pasted body and deleting an orphaned one. Kept
//separate from renumberFootnotes below because the two halves apply to the live editor under
//different rules - see docs/footnotes-plan.md's "Source discipline". A structural change is a real
//edit and belongs in the same undo entry as whatever triggered it (source 'user', applied
//synchronously); renumbering/reordering is cosmetic and must not itself become undoable (source
//'silent').
//True when the delta holds anything either structural step could act on. materializePayloads only
//touches marker embeds carrying a payload, and pruneOrphanBodies only lines carrying a
//footnoteBody attribute - so on a delta with neither, both are provably no-ops and the rebuild
//below is pure cost. A pasted note's payload always rides on its marker rather than standing on
//its own, which is what makes these two checks exhaustive rather than merely likely.
//
//Worth the special case because of where this runs: render.js calls it from the editor's
//text-change handler, so the walk it guards happens on every keystroke, and the overwhelming
//majority of chapters contain no footnotes at all. One allocation-free pass over the ops replaces
//rebuilding every op and line in the document.
function containsFootnotes(delta){
  var ops = (delta && delta.ops) || [];

  for(var i = 0; i < ops.length; i++){
    if(isFootnoteMarker(ops[i].insert))
      return true;

    //Read off the raw op rather than a flattened one: a line attribute sits on the newline that
    //terminates the line, and a multi-line string insert carries it for every newline inside
    //itself, so either shape is caught here without splitting anything first.
    if(ops[i].attributes && ops[i].attributes.footnoteBody != null)
      return true;
  }

  return false;
}

function applyStructuralFootnoteChanges(delta){
  //Returned as its own array so the result is still the caller's to keep or discard, matching what
  //the rebuilt path hands back. The op objects inside are shared rather than copied, which is safe
  //precisely because this branch ran: nothing was rewritten, and every pass that would rewrite one
  //goes through toLines() and copies first.
  if(!containsFootnotes(delta))
    return finalizeDelta(((delta && delta.ops) || []).slice());

  var lines = toLines((delta && delta.ops) || []);
  materializePayloads(lines);
  lines = pruneOrphanBodies(lines);
  return finalizeDelta(fromLines(lines));
}

function renumberFootnotes(delta){
  var lines = renumberAndReorder(toLines((delta && delta.ops) || []));
  return finalizeDelta(fromLines(lines));
}

//The full pass, for every caller that just wants a clean result in one shot rather than the two
//separately-sourced live-editor steps above: save, split, import, compile.
function reconcileFootnotes(delta){
  return renumberFootnotes(applyStructuralFootnoteChanges(delta));
}

//Rewrites every marker/body id in `delta` to `prefix + '_' + <original id>`. A single chapter's own
//numbering restarts at 1, so concatenating several chapters for a whole-project compile puts a
//"note 1" from one chapter directly alongside an unrelated "note 1" from another - renumberAndReorder
//matches a marker to a body by that shared id, and cannot otherwise tell those two apart from one
//marker genuinely referenced twice. compile.js calls this once per chapter, with that chapter's own
//index as the prefix, before concatenating - which is what keeps every id globally unique going into
//the reconcile pass that assigns the compiled document's real, sequential footnote numbers.
function namespaceFootnotes(delta, prefix){
  var lines = toLines((delta && delta.ops) || []);

  lines.forEach(function(l){
    l.content.forEach(function(op){
      var id = footnoteMarkerId(op);
      if(id != null)
        op.insert = { footnote: Object.assign({}, op.insert.footnote, { n: prefix + '_' + id }) };
    });

    var bodyId = footnoteBodyId(l.line);
    if(bodyId != null){
      l.line = Object.assign({}, l.line, {
        attributes: Object.assign({}, l.line.attributes, { footnoteBody: prefix + '_' + bodyId })
      });
    }
  });

  return finalizeDelta(fromLines(lines));
}

//Phase 6: splitting a chapter, or breaking an import at several chapter markers, produces an array
//of fragments that started life as one document - so a footnote's marker and its body can land in
//different fragments purely because of where the split points fell. Sends each body group to
//whichever fragment holds its marker, appended after that fragment's own existing bodies (in
//marker order), then reconciles each fragment on its own so every chapter numbers from 1.
//
//"Footnotes on both sides" needs no special case: every body starts out in whichever fragment it
//was already in, and only the ones whose marker moved to a *different* fragment get pulled across.
function redistributeFootnotes(deltas){
  var fragments = deltas.map(function(d){ return toLines((d && d.ops) || []); });

  var markerFragment = {};
  fragments.forEach(function(frLines, fi){
    frLines.forEach(function(l){
      l.content.forEach(function(op){
        var id = footnoteMarkerId(op);
        if(id != null)
          markerFragment[id] = fi;
      });
    });
  });

  var split = fragments.map(function(frLines){
    var prose = [];
    var groupsByOldId = {};
    var groupOrder = [];

    frLines.forEach(function(l){
      var oldId = footnoteBodyId(l.line);

      if(oldId == null){
        prose.push(l);
        return;
      }

      if(!groupsByOldId[oldId]){
        groupsByOldId[oldId] = [];
        groupOrder.push(oldId);
      }
      groupsByOldId[oldId].push(l);
    });

    return { prose: prose, groupsByOldId: groupsByOldId, groupOrder: groupOrder };
  });

  var result = split.map(function(fr){ return fr.prose.slice(); });

  split.forEach(function(fr, fi){
    fr.groupOrder.forEach(function(oldId){
      //A body whose marker cannot be found in any fragment (should not happen - every group here
      //came from a document that had one) stays where it started rather than being dropped.
      var destination = markerFragment[oldId] != null ? markerFragment[oldId] : fi;
      result[destination] = result[destination].concat(fr.groupsByOldId[oldId]);
    });
  });

  return result.map(function(lines){ return reconcileFootnotes({ ops: fromLines(lines) }); });
}

module.exports = {
  reconcileFootnotes,
  applyStructuralFootnoteChanges,
  containsFootnotes,
  renumberFootnotes,
  namespaceFootnotes,
  redistributeFootnotes,
  toLines,
  fromLines
};
