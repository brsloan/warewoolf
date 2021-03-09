var dictionary = require('dictionary-en')
var nspell = require('nspell')

function runSpellcheck(){
    dictionary(ondictionary);
}

function ondictionary(err, dict) {
  if (err) {
    throw err
  }

  var spell = nspell(dict)
  
    //var dict = loadDictionary();

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

            //var results = dict.lookup(match[0]);
            validWord = spell.correct(match[0]);
            if(!validWord){
                editorQuill.setSelection(currentWordPosition, match[0].length);
                console.log(match[0] + " is not a word! Suggestions:");
                console.log(spell.suggest(match[0]));
            }
                
        }
    }
}

function loadDictionary(){
    

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