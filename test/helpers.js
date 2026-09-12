//Shared helpers for the converter tests, plus scopedTmpdir for the ones that touch real files.
const fs = require('fs');
const os = require('os');
const path = require('path');
const newChapter = require('../src/components/models/chapter');

//Points os.tmpdir() at a private directory for the rest of one test, for the tests that assert a
//command wrote nothing to the temp directory.
//
//Those assertions cannot be made against the real os.tmpdir(): `node --test` runs the suite's files
//as parallel processes, two dozen of them create and remove fs.mkdtempSync() directories in there,
//and every other process on the machine is writing to it too - so a before/after comparison of that
//directory races all of them and fails intermittently, on whichever test happened to be holding the
//window open. Scoping makes the measurement this test's own.
//
//os.tmpdir() re-reads these variables on every call, and every temp directory the node backing
//creates goes through it, so setting them redirects the code under test without it knowing. Call it
//*after* the fixtures are in place, so the only thing that can appear in the scoped directory is
//what the command under test put there.
function scopedTmpdir(t){
  var scoped = fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-scoped-tmp-'));
  var saved = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP };

  process.env.TMPDIR = process.env.TMP = process.env.TEMP = scoped;

  t.after(function(){
    Object.keys(saved).forEach(function(key){
      if(saved[key] === undefined)
        delete process.env[key];
      else
        process.env[key] = saved[key];
    });
    fs.rmSync(scoped, { recursive: true, force: true });
  });

  return scoped;
}

//A real chapter model rather than a hand-rolled stub, so getContentsOrFile() behaves exactly like
//it does in the app. filename stays null, so getContentsOrFile() always returns `contents` as-is.
function makeChapter(contents){
  var chap = newChapter();
  chap.contents = contents;
  return chap;
}

//Simulates a chapter whose file failed to load (missing file, corrupt encoding, bad JSON, etc.):
//getFile() already catches and logs that case and returns undefined, so getContentsOrFile() does
//too. filename must be set or getContentsOrFile() would just treat null contents as a blank chapter.
function makeUnloadableChapter(){
  var chap = newChapter();
  chap.filename = 'unreadable.txt';
  chap.contents = null;
  chap.getFile = function(){ return undefined; };
  return chap;
}

//The controllers under test only ever touch chapters, reference, activeChapterIndex and
//hasUnsavedChanges, so the fake project needs nothing else.
function makeProject(chapters, reference, activeChapterIndex){
  return {
    chapters: chapters || [],
    reference: reference || [],
    activeChapterIndex: activeChapterIndex || 0,
    hasUnsavedChanges: false
  };
}

//A delta that has been through convertDeltaToMDF -> parseMDF comes back semantically equal to the
//original but not literally identical: parseMDF emits zero-length inserts where a paragraph ends,
//and boolean run attributes arrive as the strings Quill also accepts ("true"). Normalising both
//sides lets a round-trip test assert on the parts that carry meaning without pinning down those
//two artifacts. Anything else that differs is a real difference and will fail the comparison.
function normalizeDelta(delta){
  var ops = (delta.ops || [])
    .filter(function(op){ return op.insert !== ''; })
    .map(function(op){
      var normalized = { insert: op.insert };
      if(op.attributes)
        normalized.attributes = normalizeAttributes(op.attributes);
      return normalized;
    });

  return { ops: mergeAdjacentRuns(ops) };
}

//Quill's delta model does not distinguish two adjacent inserts carrying the same attributes from
//the one insert holding both - the editor writes the merged form and merges them again on load - so
//neither does a comparison here. Without this an assertion on a split-run delta fails against its
//own document, which is a difference in the input rather than in what the code under test did.
function mergeAdjacentRuns(ops){
  var merged = [];

  ops.forEach(function(op){
    var last = merged[merged.length - 1];

    if(last && typeof last.insert === 'string' && typeof op.insert === 'string' &&
        last.insert !== '\n' && op.insert !== '\n' &&
        JSON.stringify(last.attributes) === JSON.stringify(op.attributes)){
      last.insert += op.insert;
      return;
    }

    merged.push(op);
  });

  return merged;
}

function normalizeAttributes(attributes){
  var normalized = {};
  Object.keys(attributes).sort().forEach(function(key){
    normalized[key] = attributes[key] === 'true' ? true : attributes[key];
  });
  return normalized;
}

//What a screen reader needs from a popup, checked the way the reader would resolve it: a dialog
//role, aria-modal, and a name - either aria-label text or an aria-labelledby that points at an
//element in the document with text in it. jsdom does not lay text out, and the views set headings
//through innerText, which jsdom keeps as a plain property - so the name is read back through
//either, whichever the view used.
function assertDialogDescribed(popup, expectedRole){
  var assert = require('node:assert');
  var role = popup.getAttribute('role');

  if(expectedRole)
    assert.strictEqual(role, expectedRole);
  else
    assert.ok(role === 'dialog' || role === 'alertdialog', 'popup has role ' + JSON.stringify(role));
  assert.strictEqual(popup.getAttribute('aria-modal'), 'true');

  var label = popup.getAttribute('aria-label');
  if(label != null){
    assert.ok(label.trim().length > 0, 'aria-label is empty');
    return;
  }

  var labelledBy = popup.getAttribute('aria-labelledby');
  assert.ok(labelledBy, 'popup has neither aria-label nor aria-labelledby');
  var heading = popup.ownerDocument.getElementById(labelledBy);
  assert.ok(heading, 'aria-labelledby points at #' + labelledBy + ', which is not in the document');
  assert.ok(textOf(heading).trim().length > 0, 'the element naming the dialog has no text');
}

//Every form control inside `root` has an accessible name: a <label for> pointing at its id, a
//<label> wrapping it, aria-label, or aria-labelledby. Submit and button inputs name themselves
//from their value; hidden inputs are not presented at all.
function assertControlsNamed(root){
  var assert = require('node:assert');
  var doc = root.ownerDocument;
  var controls = Array.from(root.querySelectorAll('input, select, textarea'));

  controls.forEach(function(control){
    var type = (control.getAttribute('type') || '').toLowerCase();
    if(type === 'hidden' || type === 'submit' || type === 'button')
      return;

    var named = false;
    var ariaLabel = control.getAttribute('aria-label');
    if(ariaLabel != null && ariaLabel.trim() !== '')
      named = true;
    var labelledBy = control.getAttribute('aria-labelledby');
    if(!named && labelledBy){
      var el = doc.getElementById(labelledBy);
      named = el != null && textOf(el).trim() !== '';
    }
    if(!named && control.id){
      var labels = Array.from(doc.querySelectorAll('label')).filter(function(l){ return l.htmlFor === control.id; });
      named = labels.some(function(l){ return textOf(l).trim() !== ''; });
    }
    if(!named && control.closest('label'))
      named = textOf(control.closest('label')).trim() !== '';

    assert.ok(named, describeControl(control) + ' has no accessible name');
  });

  return controls.length;
}

function textOf(el){
  return (el.textContent && el.textContent.trim() !== '') ? el.textContent : (el.innerText || '');
}

function describeControl(control){
  return '<' + control.tagName.toLowerCase()
    + (control.getAttribute('type') ? ' type=' + control.getAttribute('type') : '')
    + (control.id ? ' id=' + control.id : '')
    + (control.className ? ' class=' + control.className : '') + '>';
}

module.exports = { normalizeDelta, makeChapter, makeUnloadableChapter, makeProject, scopedTmpdir,
  assertDialogDescribed, assertControlsNamed };
