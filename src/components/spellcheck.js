var nspell = require('nspell');

function runSpellcheck(startingIndex = 0){
    var spellchecker = loadDictionaries();
    return findInvalidWord(spellchecker, startingIndex)
}

function loadDictionaries(){
    var baseFilepath = convertFilepath(__dirname);
    var aff = fs.readFileSync(baseFilepath + '/dictionaries/en_us.aff', 'utf8');
    var dic = fs.readFileSync(baseFilepath + '/dictionaries/en_us.dic', 'utf8');
    var personal = fs.readFileSync(baseFilepath + '/dictionaries/personal.dic', 'utf8');

    var spellchecker = nspell({ aff: aff, dic: dic });
    spellchecker.personal(personal);
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
                    index: currentWordPosition + startingIndex, 
                    suggestions: spellchecker.suggest(match[0]) 
                };
            }      
        }
    }

    return invalidWord;
}

function getPersonalDict(){
    return fs.readFileSync(convertFilepath(__dirname) + '/dictionaries/personal.dic', 'utf8').split("\n");;
}

function addWordToPersonalDictFile(word){
    var personal = getPersonalDict();
    if(personal.indexOf(word) == -1){
        personal.push(word);
        fs.writeFileSync(convertFilepath(__dirname) + '/dictionaries/personal.dic', personal.join("\n"), 'utf8');
    }
}