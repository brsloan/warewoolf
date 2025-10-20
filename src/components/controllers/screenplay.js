const { getTempQuill } = require('./quill-utils');

function parseFountain(str){
    str = convertAllLineBreaks(str);
    //console.log(str);

    let sceneHeader = /(?<=\n|^)(([iI][nN][tT]|[eE][xX][tT]|[^\w][eE][sS][tT]|[iI]\.?\/[eE]\.?)([^\n]+))\n/g; //Not multi-line because ^ is checking very first line in document
    let forcedSceneHeader = /(?<=\n|^)\.([^\n]+)\n/gm;
    let character = /(?<=\n)([ \t]*[^<>a-z\s\/\n][^<>a-z:!\?\n]*[^<>a-z\(!\?:,\n\.][ \t]?)\n{1}(?!\n)/g;
    let parenthetical = /^(\s*\([^<>\n]*?\)[\s]?)\n/gm;
    let transition = /\n([\*_]*([^<>\na-z]*TO:|FADE TO BLACK\.|FADE OUT\.|CUT TO BLACK\.)[\*_]*)\n/g;
    let forcedTransition = /\n>(\s*[^<>\n]+)\n/g;

    let dialog = /(?<="character-cue":true}},\n|"parenthetical-block":true}},\n)([^{]*?)\n(?=\n|{)/g; //Must be run after character & parenthetical since it matches on their results
    //let falseTransition = /\n(>\s*[^<>\n]+(<\s*))\n/g; //For centered actions that may appear to be transitions??? Taken from Fountain github
    let action = /(?<=}},\n)([^{}]*)(?=\n{2}|\n{)/g;
    let anythingLeft = /^\s*([^{}\n]+)$/gm;

      //escape JSON chars (except Tab, which will do later so can be detected with Regexes)
    str = str.replaceAll('\\','\\\\');
    str = str.replaceAll('/','\\/');
    str = str.replaceAll('"','\\"');

    str = str.replace(sceneHeader, '\n{"insert":"$1"},{"insert":"\\n","attributes":{"scene-header":true}},');
    str = str.replace(forcedSceneHeader, '\n{"insert":"$1"},{"insert":"\\n","attributes":{"scene-header":true}},');
    str = str.replace(character, '{"insert":"$1"},{"insert":"\\n","attributes":{"character-cue":true}},\n');
    str = str.replace(parenthetical, '{"insert":"$1","attributes":{"parenthetical-block":true}},{"insert":"\\n","attributes":{"parenthetical-block":true}},\n');
    str = str.replace(transition, '\n{"insert":"$1","attributes":{"transition-block":true}},{"insert":"\\n","attributes":{"transition-block":true}},');
    str = str.replace(dialog, '{"insert":"$1","attributes":{"dialog-block":true}},{"insert":"\\n","attributes":{"dialog-block":true}},');
    str = str.replace(forcedTransition, '\n{"insert":"$1","attributes":{"transition-block":true}},{"insert":"\\n","attributes":{"transition-block":true}},\n');
    str = str.replace(action, '{"insert":"$1","attributes":{"action-block":true}},\n');

    //Escape tabs
    str = str.replaceAll('\t','\\t'); 

    //Escape newlines within JSON properties, condensing blank lines while we're at it
    let interiorNewlines = /(:"[^\n"]*)(\n\n|\n)/g;
    while(str.search(interiorNewlines) > 0){
        str = str.replace(interiorNewlines, '$1\\n');
    }
  
    //Catch anything left, mainly gets the final line of the screenplay if it's action
    //Must run after newlines have been condensed for reasons of deep magic
    str = str.replace(anythingLeft, '{"insert":"$1","attributes":{"action-block":true}},{"insert":"\\n","attributes":{"action-block":true}},\n');

    str = '{"ops":[' + str.trim().slice(0,-1) + ']}'; //slice is to remove the last comma from the generated JSON array

    let cleanup = /{"insert":"","attributes":{"action-block":true}},{"insert":"\\n","attributes":{"action-block":true}},/g;
    str = str.replace(cleanup,'');

    let boldItalicUnderline = /(_\*{3}|\*{3}_)([^{}]+)(_\*{3}|\*{3}_)/g;
    let boldItalic = /(\*{3})([^{}]+)(\*{3})/g;
    let boldUnderline = /(_\*{2}|\*{2}_)([^{}]+)(_\*{2}|\*{2}_)/g;
    let italicUnderline = /(_\*{1}|\*{1}_)([^{}]+)(_\*{1}|\*{1}_)/g;
    let bold = /(\*{2})([^{}]+)(\*{2})/g;
    let italic = /(?<!\\)(\*{1})([^{}]+?)(\*{1})/g;
    let underline = /(_)([^{}_]+)(_)/g;

    console.log('before styling:\n' + str);

    str = str.replace(boldItalicUnderline, '"},{"insert":"$2","attributes":{"bold":"true","italic":"true","underline":"true"}},{"insert":"');
    str = str.replace(boldItalic, '"},{"insert":"$2","attributes":{"bold":"true","italic":"true"}},{"insert":"');
    str = str.replace(boldUnderline, '"},{"insert":"$2","attributes":{"bold":"true","underline":"true"}},{"insert":"');
    str = str.replace(italicUnderline, '"},{"insert":"$2","attributes":{"italic":"true","underline":"true"}},{"insert":"');
    str = str.replace(underline, '"},{"insert":"$2","attributes":{"underline":"true"}},{"insert":"');
    str = str.replace(bold, '"},{"insert":"$2","attributes":{"bold":"true"}},{"insert":"');
    str = str.replace(italic, '"},{"insert":"$2","attributes":{"italic":"true"}},{"insert":"');
    
    console.log('after condensing newlins etc:\n' + str);
    return JSON.parse(str);
}

function convertAllLineBreaks(text) {
    return text.replace(/\r\n|\r/g, '\n');
}

function styleInlineMarkers(delt){
    let boldItalicUnderline = /(_\*{3}|\*{3}_)([^{}]+)(_\*{3}|\*{3}_)/g;
    let boldItalic = /(\*{3})([^{}]+)(\*{3})/g;
    let boldUnderline = /(_\*{2}|\*{2}_)([^{}]+)(_\*{2}|\*{2}_)/g;
    let italicUnderline = /(_\*{1}|\*{1}_)([^{}]+)(_\*{1}|\*{1}_)/g;
    let bold = /(\*{2})([^{}]+)(\*{2})/g;
    let italic = /(?<!\\)(\*{1})([^{}]+?)(\*{1})/g;
    let underline = /(_)([^{}_]+)(_)/g;

    var tempQuill = getTempQuill();

};

function styleMarkedSpans(tempQuill, delt, markerRegx, style){  
   //var tempQuill = getTempQuill();
    tempQuill.setContents(delt);
    var text = tempQuill.getText();
  
    var foundIndex = 0;
    var startingIndex = 0;
    var matchResult;
    var markedText = "";
  
    while(foundIndex > -1){
  
        matchResult = text.match(markerRegx);
        foundIndex = matchResult ? matchResult.index : -1;
  
        if(foundIndex > -1){
            tempQuill.deleteText(foundIndex, matchResult[0].length);
            tempQuill.insertText(foundIndex, matchResult[2]);
            tempQuill.formatText(matchResult.index, matchResult[2].length, style, true);
            startingIndex = foundIndex + matchResult[1].length;
            text = tempQuill.getText();
        }
    }
  
    return tempQuill.getContents();
  }

module.exports = {
    parseFountain
};