
function parseFountain(str){
    str = convertAllLineBreaks(str);
    //console.log(str);

    let sceneHeader = /(?<=\n|^)(([iI][nN][tT]|[eE][xX][tT]|[^\w][eE][sS][tT]|\.|[iI]\.?\/[eE]\.?)([^\n]+))\n/g; //Not multi-line because ^ is checking very first line in document
    let character = /(?<=\n)([ \t]*[^<>a-z\s\/\n][^<>a-z:!\?\n]*[^<>a-z\(!\?:,\n\.][ \t]?)\n{1}(?!\n)/g;
    let parenthetical = /^(\s*\([^<>\n]*?\)[\s]?)\n/gm;
    let transition = /\n([\*_]*([^<>\na-z]*TO:|FADE TO BLACK\.|FADE OUT\.|CUT TO BLACK\.)[\*_]*)\n/g;
    let forcedTransition = /\n((&gt;|>)\s*[^<>\n]+)\n/g;

    let dialog = /(?<="character-cue":true}},\n|"parenthetical-block":true}},\n)([^{]*?)\n(?=\n|{)/g; //Must be run after character & parenthetical since it matches on their results
    let falseTransition = /\n(>\s*[^<>\n]+(<\s*))\n/g; //For centered actions that may appear to be transitions??? Taken from Fountain github
    let action = /(?<=}},\n)([^{}]*)(?=\n{2}|\n{)/g;


      //escape JSON chars (except Tab, which will do later so can be detected with Regexes)
    str = str.replaceAll('\\','\\\\');
    str = str.replaceAll('/','\\/');
    str = str.replaceAll('"','\\"');

    str = str.replace(sceneHeader, '\n{"insert":"$1"},{"insert":"\\n","attributes":{"scene-header":true}},');
    str = str.replace(character, '{"insert":"$1"},{"insert":"\\n","attributes":{"character-cue":true}},\n');
    str = str.replace(parenthetical, '{"insert":"$1","attributes":{"parenthetical-block":true}},{"insert":"\\n","attributes":{"parenthetical-block":true}},\n');
    str = str.replace(transition, '\n{"insert":"$1","attributes":{"transition-block":true}},{"insert":"\\n","attributes":{"transition-block":true}},');
    str = str.replace(dialog, '{"insert":"$1","attributes":{"dialog-block":true}},{"insert":"\\n","attributes":{"dialog-block":true}},');
    str = str.replace(forcedTransition, '\n{"insert":"$1","attributes":{"transition-block":true}},{"insert":"\\n","attributes":{"transition-block":true}},\n');
    str = str.replace(falseTransition, '{"insert":"$1","attributes":{"action-block":true}},{"insert":"\\n","attributes":{"action-block":true}},\n');
    console.log(str);
    str = str.replace(action, '{"insert":"$1","attributes":{"action-block":true}},\n');

    //Escape tabs
    str = str.replaceAll('\t','\\t'); 

    //Escape newlines within JSON properties
    let interiorNewlines = /(:"[^\n"]*)(\n)/g;
    while(str.search(interiorNewlines) > 0){
        str = str.replace(interiorNewlines, '$1\\n');
    }
  
    str = '{"ops":[' + str.trim().slice(0, -1) + ']}';

    let cleanup = /{"insert":"","attributes":{"action-block":true}},{"insert":"\\n","attributes":{"action-block":true}},/g;
    str = str.replace(cleanup,'');

    return JSON.parse(str);
}

function convertAllLineBreaks(text) {
    return text.replace(/\r\n|\r/g, '\n');
}

module.exports = {
    parseFountain
};