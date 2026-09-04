//Shared helpers for the converter tests.
const newChapter = require('../src/components/models/chapter');

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

  return { ops: ops };
}

function normalizeAttributes(attributes){
  var normalized = {};
  Object.keys(attributes).sort().forEach(function(key){
    normalized[key] = attributes[key] === 'true' ? true : attributes[key];
  });
  return normalized;
}

module.exports = { normalizeDelta, makeChapter, makeUnloadableChapter, makeProject };
