const { substitutionFor, MAX_PREFIX_LOOKBACK } = require('../models/autocorrect');

//The Tools > Convert Straight Quotes Etc. tool: the same substitutions the editors make as a
//writer types (see models/autocorrect.js), applied to a whole manuscript at once. That is what
//makes the typing feature worth having on an existing project - everything written before it
//existed, and everything imported or pasted in since, still has its straight quotes.
//
//Reads exactly as though every character had been typed in order: each one is put to the same
//rules, with the text already converted ahead of it standing in for what the writer would have
//had on screen. So a bulk conversion and a retyping of the same chapter produce the same text,
//and nothing here has to know why a quote opens or closes.

//Indexed loop rather than forEach because reading a chapter off disk is asynchronous - see
//convert-tabs.js, whose shape this follows.
async function convertSubstitutionsForAllChapters(project, rules){
  var anyChanged = false;

  for(let i = 0; i < project.chapters.length; i++){
    let chap = project.chapters[i];
    var result = convertSubstitutions(await chap.getContentsOrFile(), rules);
    if(result.changed > 0){
      chap.contents = result.delta;
      chap.hasUnsavedChanges = true;
      anyChanged = true;
    }
  }

  if(anyChanged)
    project.hasUnsavedChanges = true;
}

//Works on the delta's ops directly rather than through a temp Quill, so every run of formatting
//comes out the other side exactly as it went in: an em dash made from two italic hyphens stays
//italic, and no line's heading or alignment is touched.
function convertSubstitutions(delt, rules){
  if(delt == null || !Array.isArray(delt.ops))
    return { changed: 0, delta: delt };

  var output = [];
  //The converted text of the current line so far, capped at what a rule can look at. Carried
  //across ops, because a run of formatting can end in the middle of a line.
  var linePrefix = '';
  var changed = 0;

  delt.ops.forEach(function(op){
    //An embed - an image, say - is neither text nor a line break. It passes through untouched, and
    //clears the prefix: nothing before it should be read as context for the quote after it.
    if(typeof op.insert !== 'string'){
      output.push(op);
      linePrefix = '';
      return;
    }

    var text = '';

    for(let i = 0; i < op.insert.length; i++){
      var character = op.insert[i];

      if(character === '\n'){
        text += character;
        linePrefix = '';
        continue;
      }

      var substitution = substitutionFor(linePrefix, character, rules);

      if(substitution == null){
        text += character;
        linePrefix = appendToPrefix(linePrefix, character);
        continue;
      }

      //deleteBack counts the character just read along with the ones before it, so this is how
      //many already-emitted characters have to come back off.
      var toDrop = substitution.deleteBack - 1;
      var fromThisOp = Math.min(toDrop, text.length);

      text = text.slice(0, text.length - fromThisOp);

      //Only reached when a run of formatting ends between two characters a rule matched - the
      //first hyphen italic and the second roman, say - so the rest comes off the op before this
      //one. Safe to reach back for: a rule only ever matches characters it saw go by verbatim.
      if(toDrop > fromThisOp)
        dropFromOutput(output, toDrop - fromThisOp);

      text += substitution.insert;
      linePrefix = appendToPrefix(linePrefix.slice(0, linePrefix.length - toDrop), substitution.insert);
      changed++;
    }

    if(text !== '')
      output.push(op.attributes ? { insert: text, attributes: Object.assign({}, op.attributes) } : { insert: text });
  });

  //Handing back the delta that came in, rather than an identical rebuild of it, is what keeps a
  //chapter with nothing to convert from being marked as changed.
  if(changed === 0)
    return { changed: 0, delta: delt };

  return { changed: changed, delta: { ops: output } };
}

//Only the tail of the line is ever consulted, so the prefix is kept to the length a rule can
//actually see rather than growing with the paragraph. An empty prefix means the start of a line,
//which is why the cap has to be longer than the longest rule and not merely as long.
function appendToPrefix(prefix, character){
  return (prefix + character).slice(-MAX_PREFIX_LOOKBACK);
}

function dropFromOutput(output, count){
  while(count > 0 && output.length > 0){
    var last = output[output.length - 1];

    if(typeof last.insert !== 'string')
      return;

    var taken = Math.min(count, last.insert.length);
    count -= taken;

    var remaining = last.insert.slice(0, last.insert.length - taken);

    if(remaining === '')
      output.pop();
    else
      last.insert = remaining;
  }
}

module.exports = {
  convertSubstitutions,
  convertSubstitutionsForAllChapters
};
