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
    if(!delt.ops || delt.ops.length == 0)
      return '';
    var firstInsert = delt.ops[0].insert;
    if(typeof firstInsert !== 'string')
      return '';
    return firstInsert.split(/\r\n|\r|\n/)[0].slice(0,titleCharacterLimit).replaceAll(/<|>/g,'');
}

function parseDelta(delta){
  var paras = [];

  if(delta.ops && delta.ops.length > 0){
    var ops = flattenInserts(delta.ops);

    var tempRuns = [];

    for(let i=0;i<ops.length;i++){
      if(ops[i].insert == '\n'){
        if(tempRuns.length == 0)
          tempRuns.push({text: ''});
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

//Numbered lists restart at one for each new list and count independently at each nesting level, so
//an item's number depends on every paragraph before it rather than on the paragraph alone. Walking
//the paragraphs once up front hands each one the number to print, which leaves the callers with
//nothing to do but render it. Paragraphs that are not numbered list items get a 0 they ignore.
function getOrderedListNumbers(paragraphs){
  var numbers = [];
  var counters = [0, 0, 0];

  paragraphs.forEach(function(para, i){
    numbers.push(0);

    if(para.textRuns.length == 0)
      return;

    if(!isOrderedListItem(para)){
      counters = [0, 0, 0];
      return;
    }

    //A new list begins wherever the paragraph before it was not a numbered list item.
    if(i == 0 || !isOrderedListItem(paragraphs[i - 1]))
      counters = [0, 0, 0];

    var level = getListLevel(para.attributes);
    counters[level]++;
    numbers[i] = counters[level];
  });

  return numbers;
}

function isOrderedListItem(para){
  return Boolean(para.attributes && para.attributes.list && para.attributes.list == 'ordered');
}

//Quill tracks nesting as an indent count with no ceiling, but the export formats only carry three
//levels, so anything deeper is folded into the last one.
function getListLevel(attr){
  if(!attr.indent || attr.indent < 1)
    return 0;

  return attr.indent == 1 ? 1 : 2;
}

//The marker a list item is written with is the same in every text format WareWoolf exports, so both
//the .mdfc writer and the plain text writer take it from here. Returns '' for anything that is not
//a list item, which is the caller's cue to keep the marker it already worked out.
function getListMarker(attr, listItemNum = 0){
  if(!attr || !attr.list)
    return '';

  var tabs = '';
  if(attr.indent && attr.indent > 0)
    tabs = attr.indent == 1 ? '\t' : '\t\t';

  if(attr.list == 'bullet')
    return tabs + '* ';
  if(attr.list == 'ordered')
    return tabs + listItemNum + '. ';

  return '';
}

function convertToPlainText(delt){
  var plaintext = '';

  var parsedQuill = parseDelta(delt);
  var listNumbers = getOrderedListNumbers(parsedQuill.paragraphs);

  parsedQuill.paragraphs.forEach((para, i) => {

    if(para.textRuns.length > 0)
      plaintext += getLineMarkerForPlaintextExport(para.attributes, listNumbers[i]);

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

    var listMarker = getListMarker(attr, listItemNum);
    if(listMarker)
      marker = listMarker;
  }

  return marker;
};

module.exports = {
  getTempQuill,
  splitDeltaAtIndices,
  generateChapTitleFromFirstLine,
  parseDelta,
  convertToPlainText,
  getOrderedListNumbers,
  getListLevel,
  getListMarker
}