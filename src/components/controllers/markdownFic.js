const { getTempQuill } = require('./quill-utils');

function markdownFic(){
  return {
    parseMDF: parseMDF,
    convertDeltaToMDF: convertDeltaToMDF
  }

  function parseMDF(str){
    var lines = str.split(/\r\n|\r|\n/);

    var tempQuill = getTempQuill();

    lines.forEach((line, i) => {
      var parsedLine = parseLine(line);

      if(parsedLine.formats.length == 0 || parsedLine.formats[0].name != 'footnote'){
        var formats = {};
        parsedLine.formats.forEach((format, i) => {
          formats[format.name] = format.value;
        });

        tempQuill.insertText(tempQuill.getLength() - 1, parsedLine.line, formats);
      }
      else {
        tempQuill.insertText(tempQuill.getLength() - 1, parsedLine.line);
      }

    });

    //Delete extra white space added after last line
    tempQuill.deleteText(tempQuill.getLength() - 1, 2);

    return formatAllInline(tempQuill.getContents());
  }

  function parseLine(line){
    var parsedLine;

    if(line.startsWith('#')){
      //headings
      parsedLine = parseHeader(line);
    }
    else if(line.startsWith('>')){
      //blockquote
      parsedLine = parseBlockquote(line);
    }
    else if(line.startsWith('[^')){
      //footnote
      parsedLine = parseFootnote(line);
    }
    else if(line.startsWith('[>')){
      //alignment
      parsedLine = parseAlignment(line);
    }
    else {
      //normal
      parsedLine = {
        line: line.concat('\r'),
        formats: []
      }
    }

    return parsedLine;
  }

  function parseHeader(line){
    let marker = /^\#+ {0,1}/.exec(line);
    let parsedLine = {
      line: line.substr(marker[0].length).concat('\r'),
      formats: [
        {
          name: 'header',
          value: marker[0].trim().length
        }
      ]
    }
    return parsedLine;
  }

  function parseBlockquote(line){
    let marker = /^>+ {0,1}/.exec(line);
    let parsedLine = {
      line: line.substr(marker[0].length).concat('\r'),
      formats: [{
        name: 'blockquote',
        value: true
      }]
    }
    return parsedLine;
  }

  function parseFootnote(line){
    let marker = /^\[\^(\d+)]: {0,1}/.exec(line);
    if(marker != null)
      var fnNum = parseInt(marker[1]);

    let parsedLine = {
      line: line.concat('\r'),
      formats: [{
        name: 'footnote',
        value: fnNum
      }]
    };
    return parsedLine;
  }

  function parseAlignment(line){
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

    var newLine = line.substr(marker[0].length);

    let parsedLine = {
      line: newLine,
      formats: alignValue ? [{
        name: 'align',
        value: alignValue
      }] : []
    }

    if(newLine.startsWith('#')){
      let secondParse = parseHeader(newLine);
      secondParse.formats = secondParse.formats.concat(parsedLine.formats);
      parsedLine = secondParse;
    }
    else {
      parsedLine.line = parsedLine.line.concat('\r');
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
      },
      {
        marker: '__',
        style: 'underline'
      }
    ];

    var packagedDelta = {
      changed: 0,
      delta: delt
    };

    styleMarkers.forEach((marker, i) => {
      packagedDelta = formatMarkedSegments(packagedDelta.delta, marker.marker, marker.style);
    });


    return clearEscapedMarkers(packagedDelta.delta);
  }

  function formatMarkedSegments(delt, marker, style){
    var escapedMarker = marker.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
    //var markerRegx = new RegExp(escapedMarker + '([^' + escapedMarker + ']+)' + escapedMarker);
    var markerRegx = new RegExp('(?<!\\\\|\\\\' + escapedMarker + ')' + escapedMarker + '([^' + escapedMarker + ']+[^\\\\])' + escapedMarker);

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
            tempQuill.formatText(foundIndex, matchResult[0].length, style, true);

            //delete second marker first
            tempQuill.deleteText(matchResult.index + marker.length + matchResult[1].length,
              marker.length);
            //delete first marker
            tempQuill.deleteText(matchResult.index, marker.length);

            startingIndex = foundIndex + matchResult[1].length;
            text = tempQuill.getText();
        }
    }

    return {
      changed: counter,
      delta: tempQuill.getContents()
    }
  }

  function clearEscapedMarkers(delt){
    //Removes the backslash from markers that have been skipped for being escaped
    var markers = ['**', '*', '~~', '__', '#', '>', '[^', '[>'];
    var escapedMarkersRegx = /\\(\*\*|\*|~~|__|#|\[>|>|\[\^)/;

    var tempQuill = getTempQuill();
    tempQuill.setContents(delt);
    var text = tempQuill.getText();

    var foundIndex = 0;
    var startingIndex = 0;
    var matchResult;
    var markedText = "";

    while(foundIndex > -1){
      matchResult = text.match(escapedMarkersRegx);
      foundIndex = matchResult ? matchResult.index : -1;

      if(foundIndex > -1){
        tempQuill.deleteText(foundIndex, 1);

        startingIndex = foundIndex + matchResult[1].length;
        text = tempQuill.getText();
      }
    }


    return tempQuill.getContents();
  }


  function convertDeltaToMDF(delt){
    var mdf = '';

    var parsedQuill = parseDelta(delt);

    parsedQuill.paragraphs.forEach((para, i) => {
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
      if(run.attributes.italic)
        marker += '*';
      if(run.attributes.bold)
        marker += '**';
      if(run.attributes.strike)
        marker += '~~';
      if(run.attributes.underline)
        marker += '__';

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

}

module.exports = markdownFic;