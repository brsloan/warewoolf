const Quill = require('quill');

function getTempQuill(){
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
        //tempRuns.push({text: '\n'})
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

module.exports = {
  getTempQuill,
  splitDeltaAtIndices,
  generateChapTitleFromFirstLine,
  parseDelta,
  flattenInserts
}