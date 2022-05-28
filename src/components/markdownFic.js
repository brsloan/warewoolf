function testMDF(){
  var inText = fs.readFileSync(convertFilepath(__dirname) + "/examples/markdownfic.txt", 'utf8');
  var testDelta = parseMDF(inText);

  editorQuill.setContents(testDelta);

  var outText = convertDeltaToMDF(testDelta);
  //editorQuill.setText(outText);

  fs.writeFileSync(convertFilepath(__dirname) + "/examples/generatedMDF.txt", outText, 'utf8');
}

function parseMDF(str){
  var lines = str.split(/\r\n|\r|\n/);

  var tempQuill = getTempQuill();

  lines.forEach((line, i) => {
    var parsedLine = parseLine(line);

    if(parsedLine.format.name != 'footnote')
      tempQuill.insertText(tempQuill.getLength() - 1, parsedLine.line, parsedLine.format.name, parsedLine.format.value);
  });

  return formatAllInline(tempQuill.getContents());
}

function parseLine(line){
  var parsedLine;

  if(line.startsWith('#')){
    //headings
    let marker = /^\#+ {0,1}/.exec(line);
    parsedLine = {
      line: line.substr(marker[0].length).concat('\r'),
      format: {
        name: 'header',
        value: marker[0].trim().length
      }
    }
  }
  else if(line.startsWith('>')){
    //blockquote
    let marker = /^>+ {0,1}/.exec(line);
    parsedLine = {
      line: line.substr(marker[0].length).concat('\r'),
      format: {
        name: 'blockquote',
        value: true
      }
    }
  }
  else if(line.startsWith('[^')){
    //footnote
    let marker = /^\[\^(\d+)]: {0,1}/.exec(line);
    if(marker != null)
    	var fnNum = parseInt(marker[1]);

    parsedLine = {
      line: line.substr(marker[0].length).concat('\r'),
      format: {
        name: 'footnote',
        value: fnNum
      }
    };
  }
  else if(line.startsWith('[>')){
    //alignment
    let marker = /^\[>(l|r|c|j)] {0,1}/.exec(line);
    var alignValue;
    if(marker != null){
      switch(marker[1]){
        case 'l':
        alignValue = null;
        break;
        case 'r':
        alignValue = 'right';
        break;
        case 'c':
        alignValue = 'center';
        break;
        case 'j':
        alignValue = 'justify';
      }
    }

    parsedLine = {
      line: line.substr(marker[0].length).concat('\r'),
      format: alignValue ? {
        name: 'align',
        value: alignValue
      } : {}
    }
  }
  else {
    //normal
    parsedLine = {
      line: line.concat('\r'),
      format: {}
    }
  }

  return parsedLine;
}

function formatAllInline(delt){
  var styleMarkers = [
    {
      marker: '**',
      style: 'bold'
    },
    {
      marker: '*',
      style: 'italic'
    },
    {
      marker: '~~',
      style: 'strike'
    }
  ];

  var packagedDelta = {
    changed: 0,
    delta: delt
  };

  styleMarkers.forEach((marker, i) => {
    packagedDelta = formatMarkedSegments(packagedDelta.delta, marker.marker, marker.style);
  });


  return packagedDelta.delta;
}

function formatMarkedSegments(delt, marker, style){
  marker = marker.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
  var markerRegx = new RegExp(marker + '([^' + marker + ']+)' + marker);
  console.log(markerRegx);

  var tempQuill = getTempQuill();
  tempQuill.setContents(delt);
  var text = tempQuill.getText();

  var foundIndex = 0;
  var startingIndex = 0;
  var matchResult;
  var markedText = "";
  var counter = 0;

  while(foundIndex > -1){

      matchResult = text.match(markerRegx);
      foundIndex = matchResult ? matchResult.index : -1;

      if(foundIndex > -1){
          counter++;

          tempQuill.deleteText(foundIndex, matchResult[0].length);
          tempQuill.insertText(foundIndex, matchResult[1]);
          tempQuill.formatText(matchResult.index, matchResult[1].length, style, true);
          startingIndex = foundIndex + matchResult[1].length;
          text = tempQuill.getText();
      }
  }

  return {
    changed: counter,
    delta: tempQuill.getContents()
  }
}

function convertDeltaToMDF(delt){
  var mdf = '';

  var parsedQuill = quillParser.parseQuillDelta(delt);


  parsedQuill.paragraphs.forEach((para, i) => {
    mdf += getLineMarker(para.attributes);

    para.textRuns.forEach((run, i) => {
      mdf += getMarkedTextFromRun(run);
    });

    mdf += '\r\n';
  });

  return mdf;
}

function getMarkedTextFromRun(run){
  if(run.attributes){
    var marker = '';
    if(run.attributes.italic)
      marker += '*';
    if(run.attributes.bold)
      marker += '**';
    if(run.attributes.strike)
      marker += '~~';

    run.text = marker + run.text + marker.split('').reverse().join('');
  }

  return run.text;
}

function getLineMarker(attr){
  var marker = '';

  if(attr){
    if(attr.header){
      for(let i=0; i < attr.header; i++){
        marker+= '#';
      }
      marker += ' ';
    }
    if(attr.align){
      if(attr.align == 'center')
        marker = '[>c] ';
      else if(attr.align == 'right')
        marker = '[>r] ';
      else if(attr.align == 'justify')
        marker = '[>j] '
    }
    if(attr.blockquote)
      marker = '> ';
  }

  return marker;
};
