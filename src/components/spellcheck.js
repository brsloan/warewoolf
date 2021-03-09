var dictionary = require('dictionary-en');
var nspell = require('nspell');

function prepareSpellcheck(){
    loadDictionaries();
}

function loadDictionaries(){
    dictionary(function(err, dict){
        if (err) {
            throw err
        }

        var spell = nspell(dict)
        loadPersonalDictionary(spell);
        console.log(runSpellcheck(spell));
    });
}

function runSpellcheck(spell, startingIndex = 0) {
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

            wordIsValid = spell.correct(match[0]);
            if(!wordIsValid){
                invalidWord = { 
                    word: match[0], 
                    index: currentWordPosition, 
                    suggestions: spell.suggest(match[0]) 
                };
            }
                
        }
    }

    return invalidWord;
}

function loadPersonalDictionary(spell){
    var personal = getPersonalDict();
    personal.forEach(function(wrd){
        spell.add(wrd);
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