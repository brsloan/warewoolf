var nspell = require('nspell');
const { logError } = require('./error-log');
const { createPlatform } = require('./platform');
const { createIpcBacking } = require('./platform-ipc');

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

async function loadDictionaries(){
  try{
    var dict = await platform.loadDictionary();
    var personal = await platform.loadPersonalDictionary();

    var spellchecker = nspell({ aff: dict.aff, dic: dict.dic });
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

    var text = editorQuill.getText().slice(startingIndex);

    var wordRegx = /\w+(?:'\w+)*/;
    var numberRegx = /'*\d+'*s*/;
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

            wordIsValid = spellchecker.correct(nextWord[0]);
            if(!wordIsValid){
                invalidWord = {
                    word: nextWord[0],
                    index: currentWordPosition + startingIndex,
                    suggestions: spellchecker.suggest(nextWord[0])
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

async function addWordToPersonalDictFile(word){
  try{
    var personal = await platform.loadPersonalDictionary();
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
  var wordBorders = /\s|\.|-/;

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