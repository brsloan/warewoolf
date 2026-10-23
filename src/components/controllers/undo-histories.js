//One undo history per document, for an editor that shows many documents in turn - the manuscript
//editor its chapters and script, the notes panel each chapter's notes and the project's. Quill keeps
//a single history per instance, and it belongs to whatever document was in the editor when it was
//recorded, so each load used to throw the last one away (render.js's loadIntoEditor): a writer who
//went to another chapter, or ran a Find through the book that came back empty, came home to a
//Ctrl+Z that did nothing.
//
//A history is a list of edits at character positions, which makes it good for exactly one text:
//the one it was recorded on. Plenty changes a chapter while it is out of the editor - Replace All,
//the Convert commands, a screenplay rename, footnotes reconciled on save, a save's round trip
//through MarkdownFic - and a history handed back to a document that has moved under it replays its
//edits in the wrong places. So the text goes in the record with the history, as a hash, and the
//history comes back only to a document whose text hashes the same. Anything else gets an empty
//history, as every load did before - which means no command that edits chapters off-screen has to
//know this exists.
//
//Quill 1.x has no public way to swap a history in and out. history.stack is a plain property its
//own clear() reassigns, and taking it this way reaches into Quill the same way autocorrect.js
//already does for history.ignoreChange.

//cyrb53: 53 bits, cheap enough to run over a whole chapter on every load (well under a millisecond
//for the longest chapter of the bundled Frankenstein, against several for the load itself), and
//wide enough that two different texts sharing a hash is not a case worth a branch.
function hashText(str){
  var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for(var i = 0; i < str.length; i++){
    var ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

//The editor's own reading of its document, after Quill has normalized it, so the same text loaded
//twice - from memory once and from its file the next time - fingerprints the same.
function fingerprint(quill){
  var text = JSON.stringify(quill.getContents().ops);
  return text.length + ':' + hashText(text);
}

function createUndoHistories(quill){
  //Keyed by the document itself - a chapter, or the project's notes chapter - so a history goes
  //wherever its chapter is moved and is let go of along with it, and is never a property of the
  //chapter: stringifyProject would write that, deleted text and all, into the project file.
  var saved = new WeakMap();
  //The document whose text is in the editor now. Tracked here rather than asked of
  //project.getActiveChapter(), which by the time of the next load can already name another one: a
  //chapter moved to the Trash leaves its list before the chapter that slid into its place is shown.
  var showing = null;

  return {
    //Puts `owner`'s document into the editor by `load`, keeping the history of the one it replaces.
    //`owner` is null for a document nothing is kept for (the empty editor of an empty project).
    load: function(owner, load){
      if(showing)
        saved.set(showing, { stack: quill.history.stack, text: fingerprint(quill) });

      //Detached before the load, not after: the editors keep their history in userOnly mode,
      //which transforms the stack against an 'api' change, and against a load - which replaces the
      //whole document - that leaves every deletion waiting to be undone as an insert at the end of
      //the new one.
      quill.history.clear();
      load();

      var kept = owner ? saved.get(owner) : null;
      if(kept){
        saved.delete(owner);
        if(kept.text === fingerprint(quill))
          quill.history.stack = kept.stack;
      }

      //So the first thing typed after the load starts an entry of its own, rather than merging
      //into one recorded before the writer left - the history's merge window is about time, and
      //knows nothing of the document having been away.
      quill.history.cutoff();
      showing = owner || null;
    }
  };
}

module.exports = {
  createUndoHistories,
  fingerprint
};
