function fountainToHtml(str){
    var parsed = parseFountain(str);

    const elementTags = ['Scene Heading', 'Action', 'Character', 'Dialogue', 'Parenthetical', 'Transition'];
    const htmlClasses = ['scene-header','action-block','character-cue','dialog-block','parenthetical-block','transition-block'];

    for(let i=0;i<elementTags.length;i++){
        parsed.text = parsed.text.replaceAll('<' + elementTags[i] + '>', '<p class="' + htmlClasses[i] + '">');
        parsed.text = parsed.text.replaceAll('</' + elementTags[i] + '>', '</p>');
    }

    const centeredActionsPattern = /<p class="action-block">(&gt;)(\s*[^<>\n]+)(&lt;\s*)<\/p>/g;
    const centeredActionsTemplate = '<p class="action-block ql-align-center">$2</p>';
    parsed.text = parsed.text.replace(centeredActionsPattern, centeredActionsTemplate);

    const BOLD_PATTERN = /(\*{2})([^\t]+?)(\*{2})/g;
    const ITALIC_PATTERN = /(?<!\\)(\*{1})([^\t]+?)(\*{1})/g;
    const UNDERLINE_PATTERN = /(_)([^_]+?)(_)/g;

    parsed.text = parsed.text.replace(BOLD_PATTERN, '<strong>$2</strong>');
    parsed.text = parsed.text.replace(ITALIC_PATTERN, '<em>$2</em>');
    parsed.text = parsed.text.replace(UNDERLINE_PATTERN, '<u>$2</u>');

    return {
        html: parsed.text, 
        titlePage: parsed.titlePage
    };
}

function parseFountain(str){
    /* Much of this is adapted from the original Fountain regexes, as is obvious from their all-capital naming convention,
    which I have left for now as testament to where they came from */
    const SCENE_HEADER_PATTERN       = /(?<=\n)(([iI][nN][tT]|[eE][xX][tT]|[eE][sS][tT]|[iI]\.?\/[eE]\.?)([.\s\/][^\n]+))\n/g;
    const forcedSceneHeaderPattern   = /(?<=\n)\.{1}([^\.][^\n]+)\n/g;
    const ACTION_PATTERN             = /\n*([^<>]*?)(\n{2}|\n<)/g;
    const CHARACTER_CUE_PATTERN      = /(?<=\n)[ \t]*([^<>a-z\s\/\n][^<>a-z:!\?\n]*[^<>a-z\(!\?:,\n\.][ \t]?)\n{1}(?!\n)/g;
    const DIALOGUE_PATTERN           = /(<(Character|Parenthetical)>[^<>\n]+<\/(Character|Parenthetical)>)\s*([^<>]*?)(?=\n{2}|\n{1}<Parenthetical>)/g;
    const PARENTHETICAL_PATTERN      = /(?<=[\n>])[ \t]*(\([^<>]*?\)[\s]?)\n/g;
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
    const titlePagePattern = /^(.+:(([ \t]*|\n).+\n)+?)+\n/g;
    
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
    

    str = convertAllLineBreaks(str);

    //Make sure ends in newline for proper regex function
    if(str.charAt(str.length - 1) != '\n')
        str = str + '\n';

    //Extract Title Page if it exists
    var titlePage = null;
    if(titlePagePattern.test(str)){
        let titlePageText = str.match(titlePagePattern)[0];
        titlePage = parseTitlePage(titlePageText);
        str = str.replace(titlePagePattern, '\n');
    }

    //Some fountain may have leading tabs for readability but they don't matter for us after title page taken care of
    str = str.replaceAll('\t','');

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
        if(patterns[i] == PARENTHETICAL_PATTERN){
            console.log('after parenthetical');
            console.log(str);
        }
        else if(patterns[i] == DIALOGUE_PATTERN){
            console.log('after dialog');
            console.log(str);
        }
    }

    //Fix ellipses now that parsing is done
    str = str.replaceAll('::trip::','...');

    return {
        text: str, 
        titlePage: titlePage
    };
}

function convertAllLineBreaks(text) {
    return text.replace(/\r\n|\r/g, '\n');
}

function parseTitlePage(str){
    const keyValuePattern = /^(.+):(?:[ \t]*)(.+)/;
    var titlePage = {};
    var lines = str.split('\n');
    var lastKey;

    lines.forEach(function(line){
        var keyValue = line.match(keyValuePattern);
        if(keyValue){
            let values = [];
            if(keyValue[2].trim().length > 0)
                values.push(keyValue[2])
            let lowerCaseKey = keyValue[1].toLowerCase();
            titlePage[lowerCaseKey] = values;
            lastKey = lowerCaseKey;
        }
        else {
            let trimmedLine = line.trim();
            if(trimmedLine.length > 0)
                titlePage[lastKey].push(trimmedLine);
        }
    });

    return titlePage;
};

function quillHtmlToFountain(html, titlePageInfo = null){
    html = decodeHtmlEntities(html);
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
    var titlePageKeys = ['title', 'credit', 'author', 'source', 'draftDate', 'contact'];
    var keyLabels = ['Title','Credit','Author','Source','Draft Date','Contact'];

    for(let i=0;i<titlePageKeys.length;i++){
        let propertyString = titlePageInfo[titlePageKeys[i]];
        if(propertyString){
            let linesArray = propertyString.split(/\r\n|\r|\n/g);
            let linesLabel = keyLabels[i];
            if(linesArray){
                fountain += linesLabel + ': ';
                if(linesArray.length == 1)
                    fountain += linesArray[0] + '\n'; //One-line properties are put inline with label
                else{
                    fountain += '\n';
                    linesArray.forEach(function(line){
                        fountain += '\t' + line + '\n';//While multi-lines are inset/tabbed underneath the label
                    });
                }
            }
        }
    }

    fountain += '\n';

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
    quillHtmlToFountain,
    fountainToHtml
};