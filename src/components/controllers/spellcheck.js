var nspell = require('nspell');
const { logError } = require('./error-log');
const { createPlatform } = require('./platform');
const { createIpcBacking } = require('./platform-ipc');
const { getIndexableText } = require('./quill-utils');

//Group I used to need the app/userData paths wired in, so this module took sysDirectories from
//every caller and built a node backing out of it. Phase 9a moved the backing into the main process,
//which already knows where the dictionaries live - so the paths stop crossing at all and this
//becomes a standing instance like every other module's.
var platform = createPlatform(createIpcBacking());

//Only the first entry's .aff governs nspell's own array form (other .dic entries get parsed against
//it), which is wrong across languages in a way that produces confidently incorrect results rather
//than an error. So one nspell instance per selected dictionary instead - a word is correct if *any*
//instance calls it correct, and suggestions are round-robin interleaved rather than concatenated, so
//a bilingual writer's second dictionary is not permanently outranked by the first.
var MAX_SUGGESTIONS = 10;

//The ids a writer has ticked in the Dictionaries dialog (userSettings.spellcheckDictionaries), and
//the words a project carries beyond the personal dictionary (project.projectDictionary). Set from
//outside via the two functions below rather than threaded as a parameter, matching setPlatform in
//error-log.js/user-settings.js - runSpellcheck is called from showSpellcheck, which recurses through
//its own Ignore/Change buttons, so a parameter here would have to be carried through every one of
//those call sites and would be dropped by whichever one forgot.
var selectedDictionaries = [];
var extraWords = [];

//The built instance list, cached for the length of a spellcheck pass rather than resident for the
//life of the app - a parsed en_US-large is tens of megabytes, and holding two or three of those
//forever to save a parse the writer takes minutes to trigger again is the wrong trade on a
//writerDeck. Keyed by a signature of the selected ids, so a change of selection rebuilds on its own
//without an explicit release.
var cached = null; // { signature, instances }

function setSelectedDictionaries(ids){
  selectedDictionaries = Array.isArray(ids) ? ids : [];
  releaseSpellchecker();
}

function setProjectWords(words){
  //Not cloned: Add To Project (spellcheck_display.js) pushes straight onto project.projectDictionary,
  //and this is that same array by reference - so a word added mid-pass is already visible to the next
  //getSpellchecker() rebuild with no second call needed to keep the two in sync.
  extraWords = Array.isArray(words) ? words : [];
  releaseSpellchecker();
}

function releaseSpellchecker(){
  cached = null;
}

//One instance per id in selectedDictionaries, each carrying the merged personal+project word list.
//An id that is not on disk is skipped, and a selection that resolves to nothing at all - empty,
//absent, or every entry missing - falls back to the shared default, both handled by
//platform.loadDictionaries itself; this only has to ask for what is selected.
async function getSpellchecker(){
  var signature = selectedDictionaries.join(',');

  if(cached != null && cached.signature === signature)
    return cached.instances;

  try{
    var dicts = await platform.loadDictionaries({ ids: selectedDictionaries });
    var personal = await platform.loadPersonalDictionary();
    var mergedWords = personal.concat(extraWords).join('\n');

    var instances = dicts.map(function(dict){
      var instance = nspell({ aff: dict.aff, dic: dict.dic });
      instance.personal(mergedWords);
      return instance;
    });

    cached = { signature: signature, instances: instances };
    return instances;
  }
  catch(err){
    logError(err);
    return null;
  }
}

//A word is correct if any selected dictionary calls it correct.
function correct(instances, word){
  return instances.some(function(instance){ return instance.correct(word); });
}

//Round-robin interleaved rather than concatenated - take each instance's first suggestion, then
//each instance's second, and so on, dropping duplicates and capping at MAX_SUGGESTIONS.
//Concatenating would let the primary dictionary's tenth-best suggestion outrank a second
//dictionary's best, which for a bilingual writer means the right word is never in the list.
//Interleaving needs no notion of a "primary" dictionary at all, which is what keeps dictionary
//selection an unordered set.
function suggest(instances, word){
  var lists = instances.map(function(instance){ return instance.suggest(word); });
  var maxLength = lists.reduce(function(max, list){ return Math.max(max, list.length); }, 0);
  var merged = [];

  for(var i = 0; i < maxLength && merged.length < MAX_SUGGESTIONS; i++){
    for(var j = 0; j < lists.length && merged.length < MAX_SUGGESTIONS; j++){
      var candidate = lists[j][i];
      if(candidate != null && merged.indexOf(candidate) === -1)
        merged.push(candidate);
    }
  }

  return merged;
}

async function runSpellcheck(editorQuill, startingIndex = 0, wordsToIgnore){
    var instances = await getSpellchecker();
    if(!instances)
      return null;
    return findInvalidWord(editorQuill, instances, startingIndex, wordsToIgnore)
}

function findInvalidWord(editorQuill, instances, startingIndex = 0, wordsToIgnore = []) {
    var invalidWord = null;

    var text = getIndexableText(editorQuill).slice(startingIndex);

    //A contraction may be written with either apostrophe: a straight one, or the curly one the
    //editors' smart quotes produce (see models/autocorrect.js). Without the second, "don’t"
    //tokenizes as "don" and "t", and the writer is stopped on a word they spelled correctly.
    var wordRegx = /\w+(?:['’]\w+)*/;
    var numberRegx = /['’]*\d+['’]*s*/;
    var nextWord = {};
    var masterIndex = 0;
    var wordIsValid = true;

    while(nextWord != null && wordIsValid){
        nextWord = text.match(wordRegx);
        if(nextWord){
            var currentWordPosition = masterIndex + nextWord.index;
            var nextStart = nextWord.index + nextWord[0].length;
            masterIndex += nextStart;
            text = text.slice(nextStart);

            wordIsValid = correct(instances, forDictionary(nextWord[0]));
            if(!wordIsValid){
                invalidWord = {
                    //The word as it is written in the manuscript, not as the dictionary was asked
                    //about it: this is what gets shown, selected, and searched for by Change All,
                    //all of which have to match the text on the page character for character.
                    word: nextWord[0],
                    index: currentWordPosition + startingIndex,
                    suggestions: matchApostrophes(suggest(instances, forDictionary(nextWord[0])), nextWord[0])
                };
                //Skip invalid word if in ignore list or a number
                if(wordsToIgnore.indexOf(nextWord[0]) > -1 || nextWord[0].match(numberRegx)){
                    wordIsValid = true;
                    invalidWord = null;
                }
            }
        }
    }

    return invalidWord;
}

//nspell's dictionaries are written with straight apostrophes, so a curly one has to be flattened
//before a word is looked up or stored - otherwise every contraction a writer types with smart
//quotes on comes back misspelled.
function forDictionary(word){
  return word.replaceAll('’', "'");
}

//And the other way for anything headed back into the manuscript. A suggestion arrives from the
//dictionary with a straight apostrophe, and accepting it would undo the smart quote the writer
//just got. Only done when the word being corrected had a curly one, so a writer who has smart
//quotes switched off is left alone.
function matchApostrophes(suggestions, word){
  if(word.indexOf('’') === -1)
    return suggestions;

  return suggestions.map(function(suggestion){
    return suggestion.replaceAll("'", '’');
  });
}

//Applied to every live cached instance, not just the first - a word added mid-pass has to be
//accepted by whichever dictionary the writer is actually using. Does not invalidate the cache: a
//reparse for one added word would undo the whole point of caching the instance list, and nspell#add
//takes effect immediately on the instance it is called on.
function acceptOnLiveInstances(word){
  if(cached == null)
    return;

  cached.instances.forEach(function(instance){ instance.add(word); });
}

//Stored in the dictionary's own spelling rather than the manuscript's, for the same reason
//findInvalidWord looks words up that way: a personal entry of "don’t" would never be found again,
//since every later lookup flattens the apostrophe before asking.
async function addWordToPersonalDictFile(word){
  try{
    var personal = await platform.loadPersonalDictionary();
    word = forDictionary(word);
    if(personal.indexOf(word) == -1){
        personal.push(word);
        await platform.savePersonalDictionary({ words: personal });
        acceptOnLiveInstances(word);
    }
  }
  catch(err){
    logError(err);
  }
}

function getBeginningOfCurrentWord(text, position){
  var firstLetter = false;
  //The em and en dashes are borders alongside the hyphen now that '--' becomes one as it is typed;
  //the ellipsis for the same reason beside the period. An apostrophe of either kind is deliberately
  //absent: it is part of the word, not a border between two.
  var wordBorders = /\s|\.|-|—|–|…/;

  while(firstLetter == false){
    if(text[position - 1] == null || wordBorders.test(text[position - 1]) ){
      firstLetter = true;
    }
    else {
      position--;
    }
  }

  return position;
}

module.exports = {
  runSpellcheck,
  addWordToPersonalDictFile,
  getBeginningOfCurrentWord,
  setSelectedDictionaries,
  setProjectWords,
  releaseSpellchecker,
  forDictionary
}
