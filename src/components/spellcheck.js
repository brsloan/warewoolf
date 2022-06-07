var nspell = require('nspell');

function runSpellcheck(startingIndex = 0, wordsToIgnore){
    var spellchecker = loadDictionaries();
    return findInvalidWord(spellchecker, startingIndex, wordsToIgnore)
}

function loadDictionaries(){
  try{
    var baseFilepath = convertFilepath(__dirname);
    var aff = fs.readFileSync(baseFilepath + '/dictionaries/en_US-large.aff', 'utf8');
    var dic = fs.readFileSync(baseFilepath + '/dictionaries/en_US-large.dic', 'utf8');
    var personal = fs.readFileSync(baseFilepath + '/dictionaries/personal.dic', 'utf8');

    var spellchecker = nspell({ aff: aff, dic: dic });
    spellchecker.personal(personal);
    return spellchecker;
  }
  catch(err){
    logError(err);
  }

}

function findInvalidWord(spellchecker, startingIndex = 0, wordsToIgnore = []) {
    var invalidWord = null;

    var text = editorQuill.getText().slice(startingIndex);

    var wordRegx = /(\w'*)+/;
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

function getPersonalDict(){
  try{
    return fs.readFileSync(convertFilepath(__dirname) + '/dictionaries/personal.dic', 'utf8').split("\n");
  }
  catch(err){
    logError(err);
  }
}

function addWordToPersonalDictFile(word){
  try{
    var personal = getPersonalDict();
    if(personal.indexOf(word) == -1){
        personal.push(word);
        fs.writeFileSync(convertFilepath(__dirname) + '/dictionaries/personal.dic', personal.join("\n"), 'utf8');
    }
  }
  catch(err){
    logError(err);
  }  
}
