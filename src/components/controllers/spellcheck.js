var nspell = require('nspell');
const { logError } = require('./error-log');
const { createPlatform } = require('./platform');
const { createNodeBacking } = require('./platform-node');

//loadDictionary()/loadPersonalDictionary()/savePersonalDictionary() take no injected config beyond
//the app/userData paths, and every call site here already receives sysDirectories directly (the
//same way keybindings.js builds its own ipc-backed instance in Phase 2) - so this module holds no
//shared platform state of its own and just builds one from whatever sysDirectories it's handed.
function platformFor(sysDirectories){
  return createPlatform(createNodeBacking({ paths: sysDirectories }));
}

async function runSpellcheck(editorQuill, sysDirectories, startingIndex = 0, wordsToIgnore){
    var spellchecker = await loadDictionaries(sysDirectories);
    if(!spellchecker)
      return null;
    return findInvalidWord(editorQuill, spellchecker, startingIndex, wordsToIgnore)
}

async function loadDictionaries(sysDirectories){
  try{
    var platform = platformFor(sysDirectories);

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

async function addWordToPersonalDictFile(word, sysDirectories){
  try{
    var platform = platformFor(sysDirectories);
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