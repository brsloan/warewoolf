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

async function runSpellcheck(editorQuill, startingIndex = 0, wordsToIgnore){
    var spellchecker = await loadDictionaries();
    if(!spellchecker)
      return null;
    return findInvalidWord(editorQuill, spellchecker, startingIndex, wordsToIgnore)
}

//Temporary: still a single instance built off whatever loadDictionaries({ids:[]}) falls back to.
//Phase 2 replaces this with getSpellchecker() - one nspell instance per selected dictionary, cached
//for the length of a spellcheck pass - so this stays minimal rather than growing logic that call is
//about to replace wholesale.
async function loadDictionaries(){
  try{
    var dicts = await platform.loadDictionaries({ ids: [] });
    var personal = await platform.loadPersonalDictionary();

    var spellchecker = nspell({ aff: dicts[0].aff, dic: dicts[0].dic });
    spellchecker.personal(personal.join('\n'));
    return spellchecker;
  }
  catch(err){
    logError(err);
    return null;
  }

}

function findInvalidWord(editorQuill, spellchecker, startingIndex = 0, wordsToIgnore = []) {
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

            wordIsValid = spellchecker.correct(forDictionary(nextWord[0]));
            if(!wordIsValid){
                invalidWord = {
                    //The word as it is written in the manuscript, not as the dictionary was asked
                    //about it: this is what gets shown, selected, and searched for by Change All,
                    //all of which have to match the text on the page character for character.
                    word: nextWord[0],
                    index: currentWordPosition + startingIndex,
                    suggestions: matchApostrophes(spellchecker.suggest(forDictionary(nextWord[0])), nextWord[0])
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
  getBeginningOfCurrentWord
}