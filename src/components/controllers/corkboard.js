const { logError } = require('../controllers/error-log');
const { createPlatform } = require('./platform');
const { createNodeBacking } = require('./platform-node');

//loadCorkboard()/saveCorkboard() take the chapters directory directly (like loadChapter/
//saveChapter in group C) rather than any injected app/userData path, so this module needs no
//boot-time wiring - it holds its own node-backed instance, the same way file-manager.js holds its
//own for group E below.
var platform = createPlatform(createNodeBacking({}));

function getCorkboardForExport(chaptersPath, options){
    return getCorkboardAsMd(chaptersPath).then(function(returnText){
        //Most projects have no corkboard file at all, which getCardsFile() reports as undefined. That
        //is the ordinary case, not a failure: hand it straight back so export.js's own `if(corkboardMd)`
        //skips the corkboard document. Falling through to .replace() below threw instead, and export.js
        //counted the throw as a failed export - so every .docx export of a project without a corkboard
        //told the reader it had finished with errors.
        if(!returnText)
            return returnText;

        if(options.type == '.docx'){
            //Remove extra blank lines after headings
            var headingsWithExtraBlank = /^(# .*\n)\n/gm;
            returnText = returnText.replace(headingsWithExtraBlank,'$1');
        }
        return returnText;
    });
}

function getCorkboardAsMd(chaptersPath){
    return getCardsFile(chaptersPath, cardStringToMd);
}

function cardStringToMd(str){
    str = convertWindowsToLinuxLineEndings(str);
    let colorNums = /^# \[(\d)\] (\[[xX]\] )?/gm;
    let checkMarkers = /^# \[[xX]\] /gm;

    str = str.replace(colorNums,'# ');
    str = str.replace(checkMarkers, '# ');

    return str;
}

function getCardsFromFile(chaptersPath){
    return getCardsFile(chaptersPath, parseCardsString);
}

async function getCardsFile(chaptersPath, processFunction){
        try {
            var cardsString = await platform.loadCorkboard({ chaptersDir: chaptersPath });
            if(cardsString != null)
                return processFunction(cardsString);
        }
        catch(err){
            logError(err);
        }
}

async function saveCards(cards, chaptersPath){
    var fileString = generateCardsString(cards);

    try {
        await platform.saveCorkboard({ chaptersDir: chaptersPath, contents: fileString });
    }
    catch(err){
        logError(err);
    }
}

function parseCardsString(str){
    //Cards saved as one markdown file with labels as headings and descriptions as pargraphs. Colors can be indicated
    //immediately after heading marker and checkmarks directly after that
    //in this way: "# [1] [x] Label Text". Number corresponds to preset color, 0=default, which doesn't have to be included.
    //The bracketed X indicates the card is checked off.
    //A description line starting with "# " would otherwise be mistaken for the next card's heading, and a label
    //starting with "[x] "/"[<digit>] " would be mistaken for markers, so generateCardsString escapes those with a
    //leading backslash and we undo that here.

    let firstLabel = /^# (.*)\n\n/;
    let label = /^# (.*)\n\n/gm;
    let newLines = /\r|\n/gm;
    let colorNum = /^\[(\d)\] /;
    let checkMarker = /^\[[xX]\] /;
    let escapedHeading = /^\\# /gm;
    let escapedBracket = /^\\\[/;

    if(!str.trim())
        return [];

    str = convertWindowsToLinuxLineEndings(str);

    //escape JSON chars
    str = str.replaceAll('\\','\\\\');
    str = str.replaceAll('/','\\/');
    str = str.replaceAll('"','\\"');
    str = str.replaceAll('\t','\\t');

    str = str.replace(firstLabel, '[{"label":"$1", "descr":"');
    str = str.replace(label, '"}, {"label":"$1", "descr":"');
    str = str.replace(newLines, '\\n');
    str = str + '"}]';

    var rawCards = JSON.parse(str);

    for(let i=0;i<rawCards.length;i++){
        var color = rawCards[i].label.match(colorNum);
        if(color){
            rawCards[i].label = rawCards[i].label.replace(colorNum, '');
            rawCards[i].color = color[1];
        }
        else {
            rawCards[i].color = 0;
        }
        var check = rawCards[i].label.match(checkMarker);
        if(check){
            rawCards[i].label = rawCards[i].label.replace(checkMarker, '');
            rawCards[i].checked = true;
        }
        else {
            rawCards[i].checked = false;
        }
        rawCards[i].label = rawCards[i].label.replace(escapedBracket, '[');

        rawCards[i].descr = rawCards[i].descr.replace(escapedHeading, '# ').trim();
    }

    return rawCards;
}

function generateCardsString(cards){
    var cardsString = '';
    //A label starting with "[x] "/"[<digit>] " would otherwise be mistaken by parseCardsString for a
    //checkmark/color marker, so escape it with a leading backslash.
    let riskyLabelStart = /^(\[\d\]|\[[xX]\]) /;
    //A description line starting with "# " would otherwise be mistaken for the next card's heading.
    let riskyDescrLine = /^# /gm;

    for(let i=0;i<cards.length;i++){
        let card = cards[i];

        cardsString += '# ';
        if(card.color && card.color != 0)
            cardsString += '[' + card.color + '] ';
        if(card.checked == true)
            cardsString += '[x] ';

        let label = card.label;
        if(riskyLabelStart.test(label))
            label = '\\' + label;
        cardsString += label + '\n\n';

        cardsString += card.descr.replace(riskyDescrLine, '\\# ') + '\n\n';
    }

    return cardsString;
}

function convertWindowsToLinuxLineEndings(text) {
  // Replace all occurrences of '\r\n' with '\n'
  return text.replace(/\r\n/g, '\n');
}

module.exports = { getCardsFromFile, saveCards, getCorkboardForExport };
