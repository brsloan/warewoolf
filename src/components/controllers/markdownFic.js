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

  let escapedMarkers = /\\\\(\*\*|\*|~~|__|#|\[>|>|\[\^)/g;
  str = str.replace(escapedMarkers, '$1');

  return JSON.parse(str);
}

function convertDeltaToMDF(delt){
  var mdf = '';

  var parsedQuill = parseDelta(delt);

  parsedQuill.paragraphs.forEach((para, i) => {
    
    if(para.textRuns.length > 0)
      mdf += getLineMarker(para.attributes);

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

function getLineMarker(attr){
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
  }

  return marker;
};

function escapeAnyMarkers(text){
  var escapedMarkersRegx = /(\*\*|\*|~~|__|#|\[>|>|\[\^)/g;

  return text.replace(escapedMarkersRegx, '\\$1');
}

module.exports = {
  parseMDF,
  convertDeltaToMDF
};