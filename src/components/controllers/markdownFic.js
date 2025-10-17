const { parseDelta } = require('./quill-utils');

function parseMDF(str){
  let header1 = /^# (.+)/gm;
  let header2 = /^## (.+)/gm;
  let header3 = /^### (.+)/gm;
  let header4 = /^#### (.+)/gm;
  let centeredHeader1 = /^\[>c] # (.+)/gm
  let centeredHeader2 = /^\[>c] ## (.+)/gm
  let centeredHeader3 = /^\[>c] ### (.+)/gm
  let centeredHeader4 = /^\[>c] #### (.+)/gm
  let rightHeader1 = /^\[>r] # (.+)/gm
  let rightHeader2 = /^\[>r] ## (.+)/gm
  let rightHeader3 = /^\[>r] ### (.+)/gm
  let rightHeader4 = /^\[>r] #### (.+)/gm

  let listUnordered = /^(?:-|\*|\+) (.*)/gm; 
  let listUnorderedTwo = /^(\\t)(?:-|\*|\+) (.*)/gm; //Tabs must be searched for as escaped since styling comes after JSON character conversion
  let listUnorderedThreePlus = /^(\\t){2,}(?:-|\*|\+) (.*)/gm;
  let listOrdered = /^((?:\d+|[a-z])\.) (.*)/gm;
  let listOrderedTwo = /^(\\t)((?:\d+|[a-z])\.) (.*)/gm;
  let listOrderedThreePlus = /^(\\t){2,}((?:\d+|[a-z])\.) (.*)/gm;
  let blockquote = /^>+ {0,1}(.+)/gm;
  let alignLeft = /^\[>l] (.+)/gm;
  let alignRight = /^\[>r] (.+)/gm;
  let alignCenter = /^\[>c] (.+)/gm;
  let alignJustified = /^\[>j] (.+)/gm;
  let normal = /^(?!{)(.+)/gm;
  let blankLines = /(?:\r?\n){2,}/gm;

  //escape JSON chars
  str = str.replaceAll('\\','\\\\');
  str = str.replaceAll('/','\\/');
  str = str.replaceAll('"','\\"');
  str = str.replaceAll('\t','\\t'); 

  str = str.replace(listUnorderedThreePlus,  '{"insert":"$2"},{"insert":"\\n","attributes":{"list":"bullet","indent":2}},');
  str = str.replace(listUnorderedTwo,  '{"insert":"$2"},{"insert":"\\n","attributes":{"list":"bullet","indent":1}},');
  str = str.replace(listUnordered,  '{"insert":"$1"},{"insert":"\\n","attributes":{"list":"bullet"}},');
  str = str.replace(listOrderedThreePlus,  '{"insert":"$3"},{"insert":"\\n","attributes":{"list":"ordered","indent":2}},');
  str = str.replace(listOrderedTwo,  '{"insert":"$3"},{"insert":"\\n","attributes":{"list":"ordered","indent":1}},');
  str = str.replace(listOrdered,  '{"insert":"$2"},{"insert":"\\n","attributes":{"list":"ordered"}},');
  str = str.replace(centeredHeader1, '{"insert":"$1"},{"insert":"\\n","attributes":{"align":"center","header":1}},');
  str = str.replace(centeredHeader2, '{"insert":"$1"},{"insert":"\\n","attributes":{"align":"center","header":2}},');
  str = str.replace(centeredHeader3, '{"insert":"$1"},{"insert":"\\n","attributes":{"align":"center","header":3}},');
  str = str.replace(centeredHeader4, '{"insert":"$1"},{"insert":"\\n","attributes":{"align":"center","header":4}},');
  str = str.replace(rightHeader1, '{"insert":"$1"},{"insert":"\\n","attributes":{"align":"right","header":1}},');
  str = str.replace(rightHeader2, '{"insert":"$1"},{"insert":"\\n","attributes":{"align":"right","header":2}},');
  str = str.replace(rightHeader3, '{"insert":"$1"},{"insert":"\\n","attributes":{"align":"right","header":3}},');
  str = str.replace(rightHeader4, '{"insert":"$1"},{"insert":"\\n","attributes":{"align":"right","header":4}},');
  str = str.replace(header1, '{"insert":"$1"},{"insert":"\\n","attributes":{"header":1}},');
  str = str.replace(header2, '{"insert":"$1"},{"insert":"\\n","attributes":{"header":2}},');
  str = str.replace(header3, '{"insert":"$1"},{"insert":"\\n","attributes":{"header":3}},');
  str = str.replace(header4, '{"insert":"$1"},{"insert":"\\n","attributes":{"header":4}},');
  str = str.replace(alignLeft, '{"insert":"$1"},{"insert":"\\n","attributes":{"align":"left"}},');
  str = str.replace(alignRight, '{"insert":"$1"},{"insert":"\\n","attributes":{"align":"right"}},');
  str = str.replace(alignCenter, '{"insert":"$1"},{"insert":"\\n","attributes":{"align":"center"}},');
  str = str.replace(alignJustified, '{"insert":"$1"},{"insert":"\\n","attributes":{"align":"justify"}},');
  str = str.replace(blockquote, '{"insert":"$1"},{"insert":"\\n","attributes":{"blockquote":"true"}},');
  str = str.replace(normal, '{"insert":"$1"},{"insert":"\\n"},');
  str = str.replace(blankLines, '\n{"insert":"\\n"},\n');

  str = '{"ops":[' + str.trim().slice(0, -1) + ']}';

  //To combine styles, they must come in this order: bold, italic, underline, strike
  //Wish I didn't have to go through every permutation, but I can't think of a quicker way to do this with the 
  //delta data structure since it does not nest like XML.
  let boldItalicUnderlineStrike = /(?<!\\|\\\*\*)\*\*\*__~~([^\*\*]+)~~__\*\*\*/g;
  let boldItalicUnderline = /(?<!\\|\\\*\*)\*\*\*__([^\*\*]+)__\*\*\*/g;
  let boldItalicStrike = /(?<!\\|\\\*\*)\*\*\*~~([^\*\*]+)~~\*\*\*/g;
  let boldUnderlineStrike = /(?<!\\|\\\*\*|\*)\*\*__~~([^\*\*]+)~~__\*\*/g;
  let italicUnderlineStrike = /(?<!\\|\\\*|\*)\*__~~([^\*]+)~~__\*/g;
  let boldItalic = /(?<!\\|\\\*\*)\*\*\*([^\*\*]+)\*\*\*/g;
  let boldUnderline = /(?<!\\|\\\*\*|\*)\*\*__([^\*\*]+)__\*\*/g;
  let boldStrike = /(?<!\\|\\\*\*|\*)\*\*~~([^\*\*]+)~~\*\*/g;
  let italicUnderline = /(?<!\\|\\\*|\*)\*__([^\*]+)__\*/g;
  let italicStrike = /(?<!\\|\\\*|\*)\*~~([^\*]+)~~\*/g;
  let underlineStrike = /(?<!\\|\\__|\*)__~~([^__]+)~~__/g;
  let bold = /(?<!\\|\\\*\*)\*\*([^\*\*]+)\*\*/g;
  let italic = /(?<!\\|\\\*)\*([^\*]+)\*/g;
  let underline = /(?<!\\|\\__)__([^__]+)__/g;
  let strike = /(?<!\\|\\~~)~~([^~~]+)~~/g;
  
  str = str.replace(boldItalicUnderlineStrike, '"},{"insert":"$1","attributes":{"bold":"true","italic":"true","underline":"true","strike":"true"}},{"insert":"');
  str = str.replace(boldItalicUnderline, '"},{"insert":"$1","attributes":{"bold":"true","italic":"true","underline":"true"}},{"insert":"');
  str = str.replace(boldItalicStrike, '"},{"insert":"$1","attributes":{"bold":"true","italic":"true","strike":"true"}},{"insert":"');
  str = str.replace(boldUnderlineStrike, '"},{"insert":"$1","attributes":{"bold":"true","underline":"true","strike":"true"}},{"insert":"');
  str = str.replace(italicUnderlineStrike, '"},{"insert":"$1","attributes":{"italic":"true","underline":"true","strike":"true"}},{"insert":"');
  str = str.replace(boldItalic, '"},{"insert":"$1","attributes":{"bold":"true","italic":"true"}},{"insert":"');
  str = str.replace(boldUnderline, '"},{"insert":"$1","attributes":{"bold":"true","underline":"true"}},{"insert":"');
  str = str.replace(boldStrike, '"},{"insert":"$1","attributes":{"bold":"true","strike":"true"}},{"insert":"');
  str = str.replace(italicUnderline, '"},{"insert":"$1","attributes":{"italic":"true","underline":"true"}},{"insert":"');
  str = str.replace(italicStrike, '"},{"insert":"$1","attributes":{"italic":"true","strike":"true"}},{"insert":"');
  str = str.replace(underlineStrike, '"},{"insert":"$1","attributes":{"underline":"true","strike":"true"}},{"insert":"');
  str = str.replace(bold, '"},{"insert":"$1","attributes":{"bold":"true"}},{"insert":"');
  str = str.replace(italic, '"},{"insert":"$1","attributes":{"italic":"true"}},{"insert":"');
  str = str.replace(underline, '"},{"insert":"$1","attributes":{"underline":"true"}},{"insert":"');
  str = str.replace(strike, '"},{"insert":"$1","attributes":{"strike":"true"}},{"insert":"');

  let escapedMarkers = /\\\\(\*\*|\*|~~|__|#|\[>|>|\[\^|-|\+|(?:\d+|[a-z])\. )/g;
  str = str.replace(escapedMarkers, '$1');

  return JSON.parse(str);
}

function convertDeltaToMDF(delt){
  var mdf = '';

  var parsedQuill = parseDelta(delt);

  //This function was much simpler before I decided to support nested, numbered lists...
  //The numbering has to restart at each level within the list, but remain continuous across breaks in level.
  var listItemNum = 0;
  var listItemNumLvl2 = 0;
  var listItemNumLvl3 = 0;
  var listNumToSubmit = 0; //To be assigned the value of one of the above depending on which needs used for each list item

  parsedQuill.paragraphs.forEach((para, i) => {
    
    if(para.textRuns.length > 0){
      var lastParaWasNumList = false;
      if(i > 0){
        lastParaWasNumList = parsedQuill.paragraphs[i - 1].attributes && parsedQuill.paragraphs[i - 1].attributes.list && parsedQuill.paragraphs[i - 1].attributes.list == 'ordered';
      }
      if(para.attributes && para.attributes.list && para.attributes.list == 'ordered'){
        if(lastParaWasNumList == false){ //Start of new numbered list, so restart counters
          listItemNum = 0;
          listItemNumLvl2 = 0;
          listItemNumLvl3 = 0;
        }
        
        if(!para.attributes.indent || para.attributes.indent < 1){
          listItemNum++;
          listNumToSubmit = listItemNum;
        }
        else if(para.attributes.indent == 1){
          listItemNumLvl2++;
          listNumToSubmit = listItemNumLvl2;
        }
        else if(para.attributes.indent > 1){
          listItemNumLvl3++;
          listNumToSubmit = listItemNumLvl3;
        }
          
      }
      else{
        listItemNum = 0;
        listItemNumLvl2 = 0;
        listItemNumLvl3 = 0;
      }
  
      mdf += getLineMarker(para.attributes, listNumToSubmit);
    }
      
    para.textRuns.forEach((run, i) => {
      run.text = escapeAnyMarkers(run.text);
      mdf += getMarkedTextFromRun(run);
    });

    mdf += '\r\n';
  });

  return mdf;
}

function getMarkedTextFromRun(run){

  if(run.attributes){
    var marker = '';
    if(run.attributes.bold)
      marker += '**';
    if(run.attributes.italic)
      marker += '*';
    if(run.attributes.underline)
      marker += '__';
    if(run.attributes.strike)
      marker += '~~';

    run.text = marker + run.text + marker.split('').reverse().join('');
  }

  return run.text;
}

function getLineMarker(attr, listItemNum = 0){
  var marker = '';

  if(attr){
    if(attr.align){
      if(attr.align == 'center')
        marker = '[>c] ';
      else if(attr.align == 'right')
        marker = '[>r] ';
      else if(attr.align == 'justify')
        marker = '[>j] '
    }
    if(attr.header){
      for(let i=0; i < attr.header; i++){
        marker+= '#';
      }
      marker += ' ';
    }
    if(attr.blockquote)
      marker = '> ';
    if(attr.list && attr.list == 'bullet'){
      let tabs = '';
      if(attr.indent && attr.indent > 0){
        tabs = attr.indent == 1 ? '\t' : '\t\t';
      }
      marker = tabs + '* ';
    }
    else if(attr.list && attr.list  == 'ordered'){
      let tabs = '';
      if(attr.indent && attr.indent > 0){
        tabs = attr.indent == 1 ? '\t' : '\t\t';
      }
      marker = tabs + listItemNum + '. ';
    }
  }

  return marker;
};

function escapeAnyMarkers(text){
  var escapedMarkersRegx = /(\*\*|\*|~~|__|#|\[>|>|\[\^)/g;
  text = text.replace(escapedMarkersRegx, '\\$1')

  //This is not ideal to run here, because escapeAnyMarkers is applied to every run in every paragraph
  //individually, so in some circumstances (formatting within a line breaking it up into multiple runs)
  //it will escape markers inside of a line instead of at the beginning. So far it doesn't seem to be 
  //a huge issue, since the un-escaping function in the MDF parsing still unescapes these unnecssary escapes,
  //but there may be circumstances in which this does not work out. To be revisited.
  text = escapeListMarkers(text);

  return text;
}

function escapeListMarkers(text){
  const listUnordered = /^(\t*)(-|\*|\+) /gm; 
  text = text.replace(listUnordered, '$1\\$2 ');

  const listOrdered = /^(\t*)((?:\d+|[a-z])\.) /gm;
  text = text.replace(listOrdered, '$1\\$2 ');

  return text;
}

module.exports = {
  parseMDF,
  convertDeltaToMDF
};