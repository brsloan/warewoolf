function importDocx(){
  var inText = fs.readFileSync(sysDirectories.docs + '/document.xml', 'utf8');
  var docDom = parseDocx(inText);

  var delta = docxToDelta(docDom);

  editorQuill.setContents(delta);
}

function docxToDelta(docDom){
  var paras = docDom.getElementsByTagName('w:p');
  var delta = {
    ops: []
  };

  for(i=0;i<paras.length;i++){
    var runs = paras[i].getElementsByTagName('w:r');
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
      attributes: getParaStyles(paras[i])
    });
  }

  return delta;
}

function getParaStyles(para){
  var styles = {};
  var paraStyleTags = para.getElementsByTagName('w:pPr')[0];
  var styleName = paraStyleTags.getElementsByTagName('w:pStyle')[0].getAttribute('w:val');
  var alignment = paraStyleTags.getElementsByTagName('w:jc')[0].getAttribute('w:val');

  styles.align = alignment;

  if(styleName.includes('Heading')){
    var headerVal = parseInt(styleName.replace('Heading',''));
    if(!isNaN(headerVal))
      styles.header = headerVal;
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
