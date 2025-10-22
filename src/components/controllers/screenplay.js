function parseFountain(str){
    str = convertAllLineBreaks(str);

    let sceneHeader = /(?<=\n|^)(([iI][nN][tT]|[eE][xX][tT]|[^\w][eE][sS][tT]|[iI]\.?\/[eE]\.?)([.\s][^\n]+))\n/g; //Not multi-line because ^ is checking very first line in document
    let forcedSceneHeader = /(?<=\n|^)\.{1}([^\.][^\n]+)\n/gm;
    let character = /(?<=\n)[ \t]*([^<>a-z\s\/\n][^<>a-z:!\?\n]*[^<>a-z\(!\?:,\n\.][ \t]?)\n{1}(?!\n)/g;
    let parenthetical = /^\s*(\([^<>\n]*?\)[\s]?)\n/gm;
    let transition = /\n([\*_]*([^<>\na-z]*TO:|FADE TO BLACK\.|FADE OUT\.|CUT TO BLACK\.)[\*_]*)\n/g;
    let forcedTransition = /\n>(\s*[^<>\n]+)\n/g;

    let dialog = /(?<="character-cue":true}},\n|"parenthetical-block":true}},\n)[ \t]*([^{]*?)\n(?=\n|{)/g; //Must be run after character & parenthetical since it matches on their results
    //let falseTransition = /\n(>\s*[^<>\n]+(<\s*))\n/g; //For centered actions that may appear to be transitions??? Taken from Fountain github
    let action = /(?<=}},\n)([^{}]*)(?=\n{2}|\n{)/g;
    let centeredAction = /^> ?(.*) ?<$/gm;
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
    str = str.replace(centeredAction, '{"insert":"$1"},{"insert":"\\n","attributes":{"action-block":true,"align":"center"}},');
    str = str.replace(action, '{"insert":"$1","attributes":{"action-block":true}},\n');

    //Remove leading spaces on internal newlines of any element except action
    let internalLeadingWhiteSpace = /(?<={"insert":")([^{}]+\n)([ \t]+)([^{}]+)(?=","attributes":{"(?!action))/g;
    while(str.search(internalLeadingWhiteSpace) > 0){
        str = str.replace(internalLeadingWhiteSpace, '$1$3');
    }
    

    //Escape tabs
    str = str.replaceAll('\t','\\t'); 

    //Escape newlines within JSON properties, condensing blank lines while we're at it
    let interiorNewlines = /(:"[^\n}]*)(\n\n|\n)/g;
    while(str.search(interiorNewlines) > 0){
        str = str.replace(interiorNewlines, '$1\\n');
    }
  
    //Catch anything left, mainly gets the final line of the screenplay if it's action
    //Must run after newlines have been condensed for reasons of deep magic
    str = str.replace(anythingLeft, '{"insert":"$1","attributes":{"action-block":true}},{"insert":"\\n","attributes":{"action-block":true}},\n');

    str = '{"ops":[' + str.trim().slice(0,-1) + ']}'; //slice is to remove the last comma from the generated JSON array

    let cleanup = /{"insert":"","attributes":{"action-block":true}},{"insert":"\\n","attributes":{"action-block":true}},/g;
    str = str.replace(cleanup,'');

    /*
    const boldItalicUnderline = /(_\*{3}|\*{3}_)([^{}]+?)(_\*{3}|\*{3}_)/;
    const boldItalic = /(\*{3})([^{}]+?)(\*{3})/;
    const boldUnderline = /(_\*{2}|\*{2}_)([^{}]+?)(_\*{2}|\*{2}_)/;
    const italicUnderline = /(_\*{1}|\*{1}_)([^{}]+?)(_\*{1}|\*{1}_)/;
    const bold = /(\*{2})([^{}]+?)(\*{2})/;
    const italic = /(?<!\\)(\*{1})([^{}]+?)(\*{1})/;
    const underline = /(_)([^{}_]+?)(_)/;    

    str = str.replace(boldItalicUnderline, '"},{"insert":"$2","attributes":{"bold":"true","italic":"true","underline":"true"}},{"insert":"');
    str = str.replace(boldItalic, '"},{"insert":"$2","attributes":{"bold":"true","italic":"true"}},{"insert":"');
    str = str.replace(boldUnderline, '"},{"insert":"$2","attributes":{"bold":"true","underline":"true"}},{"insert":"');
    str = str.replace(italicUnderline, '"},{"insert":"$2","attributes":{"italic":"true","underline":"true"}},{"insert":"');
    str = str.replace(bold, '"},{"insert":"$2","attributes":{"bold":"true"}},{"insert":"');
    str = str.replace(italic, '"},{"insert":"$2","attributes":{"italic":"true"}},{"insert":"');
    str = str.replace(underline, '"},{"insert":"$2","attributes":{"underline":"true"}},{"insert":"');
    */
    return JSON.parse(str);
}

function convertAllLineBreaks(text) {
    return text.replace(/\r\n|\r/g, '\n');
}


/* Despite my best efforts, since JSON is not a nested format like XML, it seems to be impossible
to cover all configurations of inline markers with the initial parsing, so it has to be done in the Quill editor
using Quill's built in formatting functions after parsing. This is waaaaaay slower than some simple regex functions followed by a
JSON parse, but it's where I'm at for now. May be faster to do original parse to XML and then convert to Delta from there? */
function styleFountainInlineMarkers(quill){
    console.time('fountain-style');
    const bold = /(\*{2})([^{}]+?)(\*{2})/;
    const italic = /(?<!\\)(\*{1})([^{}]+?)(\*{1})/;
    const underline = /(_)([^{}_]+?)(_)/;
    const formats = [bold, italic, underline];
    const styleNames = [
        ['bold'],
        ['italic'],
        ['underline']
    ];
    var delt = quill.getContents();
    var opStartIndex = 0;
    delt.ops.forEach(function(op){
        var opText = op.insert;
        formats.forEach(function(format, i){
            opText = styleMarkedSpans(quill, opText, formats[i], styleNames[i], opStartIndex);
        });
        opStartIndex += opText.length;

    });
    console.timeEnd('fountain-style');
};

function styleMarkedSpans(quill, text, markerRegx, styles, opStartIndex){  
    var foundIndex = 0;
    var matchResult;
  
    while(foundIndex > -1){
        matchResult = text.match(markerRegx);
        foundIndex = matchResult ? matchResult.index : -1;
  
        if(foundIndex > -1){
            //Delete in Quill
            quill.deleteText(opStartIndex + foundIndex, matchResult[1].length, 'api');
            quill.deleteText(opStartIndex + foundIndex + matchResult[2].length, matchResult[3].length, 'api');
            //Delete in local text
            text = text.replace(markerRegx, '$2');
            for(i = 0; i < styles.length; i++){
                quill.formatText(opStartIndex + foundIndex, matchResult[2].length, styles[i], true, 'api');
            }
        }
    }

    return text;
}

module.exports = {
    parseFountain,
    styleFountainInlineMarkers
};