const fs = require('fs');
const { logError } = require('../controllers/error-log');
const cardsFilename = 'project_corkboard.txt';

function getCardsFromFile(chaptersPath){
    console.log('get cards from file...');
    const cardsFilepath = chaptersPath + cardsFilename;
    try {
        if(fs.existsSync(cardsFilepath)){
            var cardsString = fs.readFileSync(cardsFilepath, "utf8");
            return parseCardsString(cardsString);
        }  
    }
    catch(err){
        logError(err);
    }
}

function parseCardsString(str){
    //Cards saved as one markdown file with labels as headings and descriptions as pargraphs. Colors can be indicated immediately after heading marker
    //in this way: "# [1] Label Text". Number corresponds to preset color, 0=default, which doesn't have to be included.

    let firstLabel = /^# (.+)\n\n/;
    let label = /^# (.+)\n\n/gm;
    let blankLines = /(?:\r?\n){2,}/gm;
    let colorNum = /^\[(\d)\] /; 
    let checkMarker = /^\[[xX]\] /; 


    //escape JSON chars
    str = str.replaceAll('\\','\\\\');
    str = str.replaceAll('/','\\/');
    str = str.replaceAll('"','\\"');
    str = str.replaceAll('\t','\\t'); 

    str = str.replace(firstLabel, '[{"label":"$1", "descr":"');
    str = str.replace(label, '"}, {"label":"$1", "descr":"');
    str = str.replace(blankLines, '\\n');
    str = str + '"}]';

    var rawCards = JSON.parse(str);

    for(i=0;i<rawCards.length;i++){
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

        rawCards[i].descr = rawCards[i].descr.trim();
    }

    return rawCards;
}

module.exports = getCardsFromFile;