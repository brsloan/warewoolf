var nspell = require('nspell');

function prepareSpellcheck(){
    var spellchecker = loadDictionaries();
    console.log(findInvalidWord(spellchecker));
}

function loadDictionaries(){
    var aff = fs.readFileSync(convertFilepath(__dirname) + '/dictionaries/en_us.aff', 'utf8');
    var dic = fs.readFileSync(convertFilepath(__dirname) + '/dictionaries/en_us.dic', 'utf8');
    var spellchecker = nspell({ aff: aff, dic: dic });
    loadPersonalDictionary(spellchecker);
    return spellchecker;
}

function findInvalidWord(spellchecker, startingIndex = 0) {
    var invalidWord = null;

    var text = editorQuill.getText().slice(startingIndex);

    var wordRegx = /(\w'*)+/;
    var match = {};
    var masterIndex = 0;
    var wordIsValid = true;

    while(match != null && wordIsValid){
        match = text.match(wordRegx);
        if(match){
            var currentWordPosition = masterIndex + match.index;
            var nextStart = match.index + match[0].length;
            masterIndex += nextStart;
            text = text.slice(nextStart);

            wordIsValid = spellchecker.correct(match[0]);
            if(!wordIsValid){
                invalidWord = { 
                    word: match[0], 
                    index: currentWordPosition, 
                    suggestions: spellchecker.suggest(match[0]) 
                };
            }
                
        }
    }

    return invalidWord;
}

function loadPersonalDictionary(spellchecker){
    var personal = getPersonalDict();
    personal.forEach(function(wrd){
        spellchecker.add(wrd);
    });
}

function getPersonalDict(){
    return fs.readFileSync(convertFilepath(__dirname) + '/dictionaries/personal.txt', 'utf8').split("\n");;
}

function addWordToDict(word){
    var personal = getPersonalDict();
    if(personal.indexOf(word) == -1){
        personal.push(word);
        fs.writeFileSync(convertFilepath(__dirname) + '/dictionaries/personal.txt', personal.join("\n"), 'utf8');
    }
}