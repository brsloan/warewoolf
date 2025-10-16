function getTempQuill(){
  const Quill = require('quill');
  return new Quill(document.createElement('div'), {
      modules: {
          history: {
              userOnly: true
          }
      }
      });
}

function splitDeltaAtIndices(delt, splitPoints){
  var generatedDeltas = [];
  if (splitPoints.length > 0) {
    var tempQuill = getTempQuill();
    tempQuill.setContents(delt);

    //Add beginning fragment before first splitPoint
    if(splitPoints[0] != 0)
      generatedDeltas.push(tempQuill.getContents(0, splitPoints[0]));
      //Add middle deltas
      for(let i = 0; i < splitPoints.length - 1; i++){
        var deltLength = splitPoints[i + 1] - splitPoints[i];
        generatedDeltas.push(tempQuill.getContents(splitPoints[i], deltLength));
      }
      //Add last delta from index to end of delta
      generatedDeltas.push(tempQuill.getContents(splitPoints[splitPoints.length - 1]));
  }

  return generatedDeltas;
}

function generateChapTitleFromFirstLine(delt){
    const titleCharacterLimit = 100;
    return delt.ops[0].insert.split(/\r\n|\r|\n/)[0].slice(0,titleCharacterLimit).replaceAll(/<|>/g,'');
}

function parseDelta(delta){
  var paras = [];

  if(delta.ops && delta.ops.length > 0){
    var ops = flattenInserts(delta.ops);

    var tempRuns = [];

    for(let i=0;i<ops.length;i++){
      if(ops[i].insert == '\n'){
        tempRuns.push({text: ''})
        var para = { textRuns: tempRuns };
        if(ops[i].attributes)
          para.attributes = ops[i].attributes;

        paras.push(para);
        tempRuns = [];
      }
      else {
        var run = { text: ops[i].insert };
        if(ops[i].attributes)
          run.attributes = ops[i].attributes;

        tempRuns.push(run);
      }
    }
  }

  return { paragraphs: paras };
}

function flattenInserts(ops){
  var flattened = [];

  for(let i=0;i<ops.length;i++){
    if(ops[i].insert == '\n')
      flattened.push(ops[i]);
    else{
      var lines = ops[i].insert.split('\n');
      for(let l=0;l<lines.length;l++){
        var op = { insert: lines[l] };
        if(ops[i].attributes)
          op.attributes = ops[i].attributes;
        flattened.push(op);

        if(l != lines.length -1)
          flattened.push({ insert: '\n'} );
      }
    }
  }

  return flattened;
}

function convertToPlainText(delt){
  var plaintext = '';

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
  
      plaintext += getLineMarkerForPlaintextExport(para.attributes, listNumToSubmit);
    }
      
    para.textRuns.forEach((run, i) => {
      plaintext += run.text;
    });

    plaintext += '\r\n';
  });

  return plaintext;
}

function getLineMarkerForPlaintextExport(attr, listItemNum = 0){
  var marker = '';

  if(attr){
    if(attr.blockquote)
      marker = '\t';
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

module.exports = {
  getTempQuill,
  splitDeltaAtIndices,
  generateChapTitleFromFirstLine,
  parseDelta,
  convertToPlainText
}