function testMDF(){
  var inText = fs.readFileSync(convertFilepath(__dirname) + "/examples/markdownfic.txt", 'utf8');
  var testDelta = parseMDF(inText);
  editorQuill.setContents(testDelta);
}

function parseMDF(str){
  var lines = str.split("\r\n");

  var tempQuill = getTempQuill();

  lines.forEach((line, i) => {
    var parsedLine = parseLine(line);

    if(parsedLine.format.name != 'footnote')
      tempQuill.insertText(tempQuill.getLength() - 1, parsedLine.line, parsedLine.format.name, parsedLine.format.value);
  });

  return tempQuill.getContents();

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
