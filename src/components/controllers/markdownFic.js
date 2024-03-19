const { getTempQuill, parseDelta } = require('./quill-utils');

function markdownFic(){
  return {
    parseMDF: parseMDF,
    convertDeltaToMDF: convertDeltaToMDF
  }

  function parseMDF(str){
    let header1 = /^\# {0,1}([^#].+)/gm;
    let header2 = /^\#\# {0,1}([^#].+)/gm;
    let header3 = /^\#\#\# {0,1}([^#].+)/gm;
    let header4 = /^\#\#\#\# {0,1}([^#].+)/gm;
    let centeredHeader1 = /^\[>(c)] \# {0,1}([^#].+)/gm
    let centeredHeader2 = /^\[>(c)] \#\# {0,1}([^#].+)/gm
    let centeredHeader3 = /^\[>(c)] \#\#\# {0,1}([^#].+)/gm
    let centeredHeader4 = /^\[>(c)] \#\#\# {0,1}([^#].+)/gm

    let blockquote = /^>+ {0,1}(.+)/gm;
    //let alignment = /^\[>(l|r|c|j)] {0,1}(.+)/gm;
    let alignLeft = /^\[>(l)] {0,1}(.+)/gm;
    let alignRight = /^\[>(r)] {0,1}(.+)/gm;
    let alignCenter = /^\[>(c)] {0,1}(.+)/gm;
    let alignJustified = /^\[>(j)] {0,1}(.+)/gm;
    let normal = /^(?!{)(.+)/gm;
    let blankLines = /(?:\r?\n){2,}/gm;

    //escape JSON chars
    str = str.replaceAll('\\','\\\\');
    str = str.replaceAll('/','\\/');
    str = str.replaceAll('"','\\"');
    str = str.replaceAll('\t','\\t'); //maybe do this after regex in case I need regex that detects tabs/whitespace

    str = str.replace(centeredHeader1, '{"insert":"$2"},{"insert":"\\n","attributes":{"align":"center","header":1}},');
    str = str.replace(centeredHeader2, '{"insert":"$2"},{"insert":"\\n","attributes":{"align":"center","header":2}},');
    str = str.replace(centeredHeader3, '{"insert":"$2"},{"insert":"\\n","attributes":{"align":"center","header":3}},');
    str = str.replace(centeredHeader4, '{"insert":"$2"},{"insert":"\\n","attributes":{"align":"center","header":4}},');
    str = str.replace(header1, '{"insert":"$1"},{"insert":"\\n","attributes":{"header":1}},');
    str = str.replace(header2, '{"insert":"$1"},{"insert":"\\n","attributes":{"header":2}},');
    str = str.replace(header3, '{"insert":"$1"},{"insert":"\\n","attributes":{"header":3}},');
    str = str.replace(header4, '{"insert":"$1"},{"insert":"\\n","attributes":{"header":4}},');
    str = str.replace(alignLeft, '{"insert":"$2"},{"insert":"\\n","attributes":{"align":"left"}},');
    str = str.replace(alignRight, '{"insert":"$2"},{"insert":"\\n","attributes":{"align":"right"}},');
    str = str.replace(alignCenter, '{"insert":"$2"},{"insert":"\\n","attributes":{"align":"center"}},');
    str = str.replace(alignJustified, '{"insert":"$2"},{"insert":"\\n","attributes":{"align":"justify"}},');
    str = str.replace(blockquote, '{"insert":"$1"},{"insert":"\\n","attributes":{"blockquote":"true"}},');
    str = str.replace(normal, '{"insert":"$1"},{"insert":"\\n"},');
    str = str.replace(blankLines, '\n{"insert":"\\n"},\n');

    return formatAllInline(JSON.parse('{"ops":[' + str.trim().slice(0, -1) + ']}'));
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