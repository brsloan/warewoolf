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

function removeFirstLine(delt){
  var tempQuill = getTempQuill();
  tempQuill.setContents(delt);
  var txt = tempQuill.getText();
  var firstLinebreak = txt.indexOf("\n");
  tempQuill.setText(txt.slice(firstLinebreak + 1));

  delt = tempQuill.getContents();

  return delt;
}

function removeChapterMarker(delt){
  var tempQuill = getTempQuill();
  tempQuill.setContents(delt);
  var txt = tempQuill.getText();
  //var firstLinebreak = txt.indexOf("\n");
  tempQuill.setText(txt.replace('\n<ch>\n\n', ''));

  delt = tempQuill.getContents();

  return delt;
}
