function fountainToHtml(str){
    var parsed = parseFountain(str);
    console.log(parsed);

    const elementTags = ['Scene Heading', 'Action', 'Character', 'Dialogue', 'Parenthetical', 'Transition'];
    const htmlClasses = ['scene-header','action-block','character-cue','dialog-block','parenthetical-block','transition-block'];

    for(let i=0;i<elementTags.length;i++){
        parsed = parsed.replaceAll('<' + elementTags[i] + '>', '<p class="' + htmlClasses[i] + '">');
        parsed = parsed.replaceAll('</' + elementTags[i] + '>', '</p>');
    }

    const centeredActionsPattern = /<p class="action-block">(&gt;)(\s*[^<>\n]+)(&lt;\s*)<\/p>/g;
    const centeredActionsTemplate = '<p class="action-block ql-align-center">$2</p>';
    parsed = parsed.replace(centeredActionsPattern, centeredActionsTemplate);

    const BOLD_PATTERN = /(\*{2})([^\t]+?)(\*{2})/g;
    const ITALIC_PATTERN = /(?<!\\)(\*{1})([^\t]+?)(\*{1})/g;
    const UNDERLINE_PATTERN = /(_)([^_]+?)(_)/g;

    parsed = parsed.replace(BOLD_PATTERN, '<strong>$2</strong>');
    parsed = parsed.replace(ITALIC_PATTERN, '<em>$2</em>');
    parsed = parsed.replace(UNDERLINE_PATTERN, '<u>$2</u>');

    //console.log(JSON.stringify(parsed));
    return parsed;
}

function parseFountain(str){
    str = convertAllLineBreaks(str);

    //Make sure ends in newline for proper regex function
    if(str.charAt(str.length - 1) != '\n')
        str = str + '\n';

    //Remove all tabs
    str = str.replaceAll('\t','');

    const SCENE_HEADER_PATTERN       = /(?<=\n)(([iI][nN][tT]|[eE][xX][tT]|[eE][sS][tT]|[iI]\.?\/[eE]\.?)([.\s\/][^\n]+))\n/g;
    const forcedSceneHeaderPattern   = /(?<=\n|^)\.{1}([^\.][^\n]+)\n/g;
    const ACTION_PATTERN             = /\n*([^<>]*?)(\n{2}|\n<)/g;
    const CHARACTER_CUE_PATTERN      = /(?<=\n)[ \t]*([^<>a-z\s\/\n][^<>a-z:!\?\n]*[^<>a-z\(!\?:,\n\.][ \t]?)\n{1}(?!\n)/g;
    const DIALOGUE_PATTERN           = /(<(Character|Parenthetical)>[^<>\n]+<\/(Character|Parenthetical)>)\s*([^<>]*?)(?=\n{2}|\n{1}<Parenthetical>)/g;
    const PARENTHETICAL_PATTERN      = /(?<=\n)[ \t]*(\([^<>]*?\)[\s]?)\n/g;
    const TRANSITION_PATTERN         = /\n([\*_]*([^<>\na-z]*TO:|FADE TO BLACK\.|FADE OUT\.|CUT TO BLACK\.)[\*_]*)\n/g;
    const FORCED_TRANSITION_PATTERN  = /\n(?:&gt;|>)(\s*[^<>\n]+)\n/g;     // need to look for &gt; pattern because we run this regex against marked up content
    const FALSE_TRANSITION_PATTERN  = /\n((&gt;|>)\s*[^<>\n]+(&lt;))\n/g;     // need to look for &gt; pattern because we run this regex against marked up content
    //const PAGE_BREAK_PATTERN         = /(?<=\n)(\s*[\=\-\_]{3,8}\s*)\n{1}/g;
    const CLEANUP_PATTERN            = /<Action>\s*<\/Action>/g;
    const FIRST_LINE_ACTION_PATTERN  = /^\n\n([^<>\n#]*?)\n/g;
    //const SCENE_NUMBER_PATTERN       = /(\#([0-9A-Za-z\.\)-]+)\#)/g;
    //const SECTION_HEADER_PATTERN     = /((#+)(\s*[^\n]*))\n?/g;
    const newLinesOrSpaceBetweenElements = /(?<=>)([\n|\s]*)(?=<[^/])/g;
    const newLinesAtBeginning = /^(\n+)</g;
    const centeredActionsPattern = /\n((?:>[^<>]*?<\n)+)/g; //Doesn't work right now--need to figure out how to do it after HTML char conversion

    const SCENE_HEADER_TEMPLATE      = "\n<Scene Heading>$1</Scene Heading>";
    const ACTION_TEMPLATE            = "<Action>$1</Action>$2";
    const CHARACTER_CUE_TEMPLATE     = "<Character>$1</Character>";
    const DIALOGUE_TEMPLATE          = "$1<Dialogue>$4</Dialogue>";
    const PARENTHETICAL_TEMPLATE     = "<Parenthetical>$1</Parenthetical>";
    const TRANSITION_TEMPLATE        = "\n<Transition>$1</Transition>";
    const FORCED_TRANSITION_TEMPLATE = "\n<Transition>$1</Transition>";
    const FALSE_TRANSITION_TEMPLATE  = "\n<Action>$1</Action>";
    const PAGE_BREAK_TEMPLATE        = "\n<Page Break></Page Break>\n";
    const CLEANUP_TEMPLATE           = "";
    const FIRST_LINE_ACTION_TEMPLATE = "<Action>$1</Action>\n";
    const SECTION_HEADER_TEMPLATE    = "<Section Heading>$1</Section Heading>";
    const newLinesAtBeginningTemplate = "<";

    //sanitize html chars (and ellipses for easier period detection)
    str = str.replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('...','::trip::');

    const patterns = [FALSE_TRANSITION_PATTERN, FORCED_TRANSITION_PATTERN, SCENE_HEADER_PATTERN, forcedSceneHeaderPattern,
        FIRST_LINE_ACTION_PATTERN, TRANSITION_PATTERN, CHARACTER_CUE_PATTERN, PARENTHETICAL_PATTERN, 
        DIALOGUE_PATTERN, ACTION_PATTERN, CLEANUP_PATTERN, newLinesOrSpaceBetweenElements, newLinesAtBeginning];

    const templates = [FALSE_TRANSITION_TEMPLATE, FORCED_TRANSITION_TEMPLATE, SCENE_HEADER_TEMPLATE, SCENE_HEADER_TEMPLATE,
        FIRST_LINE_ACTION_TEMPLATE, TRANSITION_TEMPLATE, CHARACTER_CUE_TEMPLATE, PARENTHETICAL_TEMPLATE, 
        DIALOGUE_TEMPLATE, ACTION_TEMPLATE, CLEANUP_TEMPLATE, CLEANUP_TEMPLATE, newLinesAtBeginningTemplate];
    
    for(let i=0;i<patterns.length;i++){
        str = str.replace(patterns[i], templates[i]);
        console.log(i+1);
        console.log(str);
    }

    //Fix ellipses now that parsing is done
    str = str.replaceAll('::trip::','...');

    return str;
}

function parseFountainToDelta(str){
    str = convertAllLineBreaks(str);

    let sceneHeader = /(?<=\n|^)(([iI][nN][tT]|[eE][xX][tT]|[eE][sS][tT]|[iI]\.?\/[eE]\.?)([.\s\/][^\n]+))\n/g; //Not multi-line because ^ is checking very first line in document
    let forcedSceneHeader = /(?<=\n|^)\.{1}([^\.][^\n]+)\n/gm;
    let character = /(?<=\n)[ \t]*([^<>a-z\s\/\n][^<>a-z:!\?\n]*[^<>a-z\(!\?:,\n\.][ \t]?)\n{1}(?!\n)/g;
    let parenthetical = /^\s*(\([^<>\n]*?\)[\s]?)\n/gm;
    let transition = /\n([\*_]*([^<>\na-z]*TO:|FADE TO BLACK\.|FADE OUT\.|CUT TO BLACK\.)[\*_]*)\n/g;
    let forcedTransition = /\n>(\s*[^<>\n]+)\n/g;

    let dialog = /(?<="character-cue":true}},\n|"parenthetical-block":true}},\n)[ \t]*([^{]*?)\n(?=\n|{)/g; //Must be run after character & parenthetical since it matches on their results
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

function quillHtmlToFountain(html){
    //console.log('html straight from quill: ');
    //console.log(html);
    html = decodeHtmlEntities(html);
    //console.log('after decoding entities');
    //console.log(html);
    const italics = /<em>|<\/em>/g;
    const bold = /<strong>|<\/strong>/g;
    const underline = /<u>|<\/u>/g;
    html = html.replace(italics, '*');
    html = html.replace(bold, '**');
    html = html.replace(underline, '_');

    const classesAndValue = /<p class="([^"]+)">([^<>]*?)<\/p>/g;
    const matchesIterator = html.matchAll(classesAndValue);
    const matches = Array.from(matchesIterator);

    var fountain = '';

    matches.forEach(function(match, i){
        var nextClasses = i < matches.length - 1 ? matches[i + 1][1] : null;
        fountain += cleanFountainElement(match[1], match[2], nextClasses);
    });

    fountain = fountain.replaceAll('<br>', '')

    const trailingNewlines = /\n*$/g;
    fountain = fountain.replace(trailingNewlines, '');

    return fountain;
}


function cleanFountainElement(classes, text, nextClasses){
    let sceneHeaderTest = /(?<=\n|^)(([iI][nN][tT]|[eE][xX][tT]|[eE][sS][tT]|[iI]\.?\/[eE]\.?)([.\s\/][^\n]+))/g;
    let characterTest = /[a-zA-Z]/g;
    let parentheticalTest = /^\s*(\([^\n]*?\)[\s]?)/g;
    let transitionTest = /^([\*_]*([^<>\na-z]*TO:|FADE TO BLACK\.|FADE OUT\.|CUT TO BLACK\.)[\*_]*)/g;  

    if(classes == 'scene-header'){
        if(sceneHeaderTest.test(text) == false)
            text = '.' + text; //. forces a scene header in Fountain
        text += '\n\n';
    }
    else if(classes == 'character-cue'){
        if(characterTest.test(text) == false)
            text = '@' + text; //@ forces character cue
        text = text.toUpperCase() + '\n';
    }
    else if(classes == 'parenthetical-block'){
        if(parentheticalTest.test(text) == false)
            text = '(' + text + ')';
        if(nextClasses == 'dialog-block')
            text += '\n';
        else
            text += '\n\n';
    }
    else if(classes == 'transition-block'){
        if(transitionTest.test(text) == false)
            text = '>' + text;
        text = text.toUpperCase() + '\n\n';
    }
    else if(classes == 'dialog-block'){
        if(nextClasses == 'dialog-block' || nextClasses == 'parenthetical-block')
            text += '\n';
        else
            text += '\n\n';
    }
    else if(classes == 'action-block ql-align-center'){
        text = '>' + text + '<\n\n';
    }
    else
        text += '\n\n'; //Default to action

    return text;
}

function decodeHtmlEntities(htmlString) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = htmlString;
    return textarea.value;
}

module.exports = {
    parseFountain,
    styleFountainInlineMarkers,
    quillHtmlToFountain,
    fountainToHtml
};