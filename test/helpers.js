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

module.exports = { normalizeDelta, makeChapter, makeUnloadableChapter, makeProject, scopedTmpdir };
