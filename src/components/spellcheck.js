var spelling = require('spelling');

function runSpellcheck(){
    var dict = loadDictionary();

    var text = editorQuill.getText();
    //var text = " This is a test. A man's dog is his friend."

    var wordRegx = /(\w'*)+/;
    var match = {};
    var masterIndex = 0;
    var validWord = true;

    while(match != null && validWord){
        match = text.match(wordRegx);
        if(match){
            var currentWordPosition = masterIndex + match.index;
            //console.log('The next found word is -- ' + match[0] + " -- at index " + currentWordPosition);
            var nextStart = match.index + match[0].length;
            masterIndex += nextStart;
            text = text.slice(nextStart);

            var results = dict.lookup(match[0]);
            validWord = results.found;
            if(!validWord){
                editorQuill.setSelection(currentWordPosition);
                console.log(results.word + " is not a word! Suggestions:");
                console.log(results.suggestions);
            }
                
        }
    }
}

function loadDictionary(){
    var dictionary = require('./dictionaries/en_US.js');
    var dict = new spelling(dictionary);

    var personal = getPersonalDict();
    personal.forEach(function(wrd){
        dict.insert(wrd);
    });

    return dict;
}

function getPersonalDict(){
    return JSON.parse(fs.readFileSync(convertFilepath(__dirname) + '/dictionaries/personal.js'));
}

function addWordToDict(word){
    var personal = getPersonalDict();
    if(personal.indexOf(word) == -1){
        personal.push(word);
        fs.writeFileSync(convertFilepath(__dirname) + '/dictionaries/personal.js', JSON.stringify(personal), 'utf8');
    }
}