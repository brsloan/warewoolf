function importDocx(filepath, cback){
  tempUnzipDocx(filepath, function(xmlPath){
    var inText = fs.readFileSync(xmlPath, 'utf8');
    var docDom = parseDocx(inText);

    var delta = docxToDelta(docDom);

    cback(delta);
  })
}

function tempUnzipDocx(filepath, callback){
  var unzipDestination = sysDirectories.temp + '/docxguts';
  fs.createReadStream(filepath)
  .pipe(unzipper.Extract({ path: unzipDestination }))
  .on('close', function(){
    callback(unzipDestination + '/word/document.xml');
  });
}

function docxToDelta(docDom, split = false){
  var paras = docDom.getElementsByTagName('w:p');
  var deltas = [];
  var delta = {
    ops: []
  };

  for(i=0;i<paras.length;i++){
    var runs = paras[i].getElementsByTagName('w:r');
    var paraStyles = getParaStyles(paras[i]);
    if(paraStyles.header == 1 && split){
      if(delta.ops.length > 0)
        deltas.push(JSON.parse(JSON.stringify(delta)));
      delta.ops = [];
    }

    for(r=0;r<runs.length;r++){
      var plaintext = '';

      var tabs = runs[r].getElementsByTagName('w:tab');
      for(t=0;t<tabs.length;t++){
        plaintext = plaintext.concat('\t')
      }

      var textNodes = runs[r].getElementsByTagName('w:t');
      for(z=0;z<textNodes.length;z++){
          plaintext = plaintext.concat(textNodes[z].childNodes[0].nodeValue);
      }

      var attributes = getRunStyles(runs[r]);
      delta.ops.push({
        insert: plaintext,
        attributes: attributes
      });
    }

    delta.ops.push({
      insert: '\n',
      attributes: paraStyles
    });
  }
  deltas.push(delta);

  return deltas;
}

function getParaStyles(para){
  var styles = {};
  var paraStyleTags = para.getElementsByTagName('w:pPr');

  if(paraStyleTags.length > 0){

    var paraStyleTag = paraStyleTags[0];
    var styleNameTags = paraStyleTag.getElementsByTagName('w:pStyle');
    var alignmentTags = paraStyleTag.getElementsByTagName('w:jc');

    var styleName = styleNameTags.length > 0 ? styleNameTags[0].getAttribute('w:val') : null;
    var alignment = alignmentTags.length > 0 ? alignmentTags[0].getAttribute('w:val') : 'left';

    styles.align = alignment;

    if(styleName && styleName.includes('Heading')){
      var headerVal = parseInt(styleName.replace('Heading',''));
      if(!isNaN(headerVal))
        styles.header = headerVal;
    }

  }

  return styles;
}

function getRunStyles(run){
    var styles = {};
    var boldTags = run.getElementsByTagName('w:b');
    var italicsTags = run.getElementsByTagName('w:i');
    var underlineTags = run.getElementsByTagName('w:u');
    var strikeTags = run.getElementsByTagName('w:strike');

    if(boldTags.length > 0 && boldTags[0].getAttribute('w:val') !== 'false')
      styles.bold = true;
    if(italicsTags.length > 0 && italicsTags[0].getAttribute('w:val') !== 'false')
      styles.italic = true;
    if(underlineTags.length > 0 && underlineTags[0].getAttribute('w:val') !== 'false')
      styles.underline = true;
    if(strikeTags.length > 0 && strikeTags[0].getAttribute('w:val') !== 'false')
      styles.strike = true;

    return styles;
}

function extractPlainText(docDom){
  var paras = docDom.getElementsByTagName('w:p');
  var plaintext = '';

  for(i=0;i<paras.length;i++){
    var runs = paras[i].getElementsByTagName('w:r');
    for(r=0;r<runs.length;r++){
      var tabs = runs[r].getElementsByTagName('w:tab');
      for(t=0;t<tabs.length;t++){
        plaintext = plaintext.concat('\t')
      }

      var textNodes = runs[r].getElementsByTagName('w:t');
      for(z=0;z<textNodes.length;z++){
          plaintext = plaintext.concat(textNodes[z].childNodes[0].nodeValue);
      }

    }
    plaintext = plaintext.concat('\n')
  }

  return plaintext;
}


function parseDocx(xmlStr){
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlStr, "application/xml");

  // print the name of the root element or error message
  const errorNode = doc.querySelector("parsererror");
  if (errorNode) {
    console.log("error while parsing");
  } else {
    console.log(doc.documentElement.nodeName);
  }

  return doc;
}
