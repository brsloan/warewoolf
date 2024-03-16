var fs = require('fs');
const unzipper = require('unzipper');

function importDocx(filepath, split, cback){
  tempUnzipDocx(filepath, function(xmlDir){

    var docInText = fs.readFileSync(xmlDir + '/document.xml', 'utf8');
    var docDom = parseDocx(docInText);

    var fnDom = getFootnotes(xmlDir);

    var deltas = docxToDelta(docDom, fnDom, split);

    cback(deltas);
  })
}

function getFootnotes(dir){
  var fnDom = null;

  if(fs.existsSync(dir + '/footnotes.xml')){
    var fnInText = fs.readFileSync(dir + '/footnotes.xml', 'utf8');
    var fnDom = parseDocx(fnInText);
  }

  return fnDom;
}

function tempUnzipDocx(filepath, callback){
  var unzipDestination = sysDirectories.temp + '/docxguts';
  fs.createReadStream(filepath)
  .pipe(unzipper.Extract({ path: unzipDestination }))
  .on('close', function(){
    callback(unzipDestination + '/word');
  });
}

function docxToDelta(docDom, fnDom, split = false){
  var paras = docDom.getElementsByTagName('w:p');
  var deltas = [];
  var delta = {
    ops: []
  };

  for(let i=0;i<paras.length;i++){
    var runs = paras[i].getElementsByTagName('w:r');
    var paraStyles = getParaStyles(paras[i]);

    //Split into multiple deltas at headings if requested
    if(paraStyles.header == 1 && split){
      if(delta.ops.length > 0)
        deltas.push(JSON.parse(JSON.stringify(delta)));
      delta.ops = [];
    }

    //Split at manual page breaks
    let manualPageBreak = false;
    var breaks = paras[i].getElementsByTagName('w:br');
    if(breaks.length > 0 ){
      for(let b=0; b < breaks.length; b++){
        if(breaks[b].getAttribute('w:type') == 'page' && delta.ops.length > 0){
          manualPageBreak = true;
          deltas.push(JSON.parse(JSON.stringify(delta)));
          delta.ops = [];
        }
      }
    }

    //Split at elements set to break page before
    var breakBefores = paras[i].getElementsByTagName('w:pageBreakBefore');
    if(breakBefores.length > 0){
      if(delta.ops.length > 0)
        deltas.push(JSON.parse(JSON.stringify(delta)));
      delta.ops = [];
    }

    for(let r=0;r<runs.length;r++){
      var plaintext = '';

      var tabs = runs[r].getElementsByTagName('w:tab');
      for(let t=0;t<tabs.length;t++){
        plaintext = plaintext.concat('\t')
      }

      var textNodes = runs[r].getElementsByTagName('w:t');
      for(let z=0;z<textNodes.length;z++){
          if(textNodes[z].childNodes.length > 0)
            plaintext = plaintext.concat(textNodes[z].childNodes[0].nodeValue);
      }

      var footnoteRefs = runs[r].getElementsByTagName('w:footnoteReference');
      for(let f=0;f<footnoteRefs.length;f++){
        var refNum = footnoteRefs[f].getAttribute('w:id');
        plaintext = plaintext.concat('[^' + refNum + ']');
      }

      var attributes = getRunStyles(runs[r]);

      if(plaintext != '')
        delta.ops.push({
          insert: plaintext,
          attributes: attributes
        });
    }

    //Every paragraph should end in a newline. Manual breaks are not real paragraphs so do not need one. (Runs plaintext will be blank above.)
    if(!manualPageBreak)
      delta.ops.push({
        insert: '\n',
        attributes: paraStyles
      });


    var fnRefsInPara = paras[i].getElementsByTagName('w:footnoteReference');
    if(fnRefsInPara.length > 0){

      var fnoteBods = fnDom.getElementsByTagName('w:footnote');

      for(let f=0;f<fnRefsInPara.length;f++){
        var refNum = fnRefsInPara[f].getAttribute('w:id');
        var fnoteBod = getMatchingFNBody(refNum, fnoteBods);

        delta.ops = delta.ops.concat(getFootnoteOps(fnoteBod, refNum));
      }
    }


  }
  deltas.push(delta);

  return deltas;
}

function getFootnoteOps(fnoteBod, refNum){
  var ops = [];
  var paras = fnoteBod.getElementsByTagName('w:p');

  for(let i=0;i<paras.length;i++){
    ops.push({
      insert: '[^' + refNum + ']: '
    });

    var runs = paras[i].getElementsByTagName('w:r');
    var paraStyles = getParaStyles(paras[i]);

    for(let r=0;r<runs.length;r++){
      var plaintext = '';

      var tabs = runs[r].getElementsByTagName('w:tab');

      for(let t=0;t<tabs.length;t++){
        if(i != 0 || t > 0)
          plaintext = plaintext.concat('\t')
      }

      var textNodes = runs[r].getElementsByTagName('w:t');
      for(let z=0;z<textNodes.length;z++){
          if(z % 2 != 0)
            plaintext = plaintext.concat('\n[^' + refNum + ']: ');
          plaintext = plaintext.concat(textNodes[z].childNodes[0].nodeValue);
      }

      var attributes = getRunStyles(runs[r]);
      ops.push({
        insert: plaintext,
        attributes: attributes
      });
    }

    ops.push({
      insert: '\n',
      attributes: paraStyles
    });
  }
  return ops;
}

function getMatchingFNBody(refNum, fnoteBods){
  var match = null;
  for(let i=0; i < fnoteBods.length; i++){
    if(fnoteBods[i].getAttribute('w:id') == refNum)
      match = fnoteBods[i];
  }
  return match;
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
    else if(styleName && styleName.includes('Title')){
      styles.header = 1;
      styles.align = 'center';
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

  const errorNode = doc.querySelector("parsererror");
  if (errorNode) {
    console.log("error while parsing");
  }

  return doc;
}

module.exports = {
  importDocx
}