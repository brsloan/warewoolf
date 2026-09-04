var fs = require('fs');
const unzipper = require('unzipper');
const { logError } = require('./error-log');

function importDocx(filepath, sysDirectories, split, cback){
  tempUnzipDocx(filepath, sysDirectories, function(xmlDir){

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

function tempUnzipDocx(filepath, sysDirectories, callback){
  var unzipDestination = sysDirectories.temp + '/docxguts';
  fs.createReadStream(filepath)
  .on('error', logError)
  .pipe(unzipper.Extract({ path: unzipDestination }))
  .on('error', logError)
  .on('close', function(){
    callback(unzipDestination + '/word');
  });
}

function docxToDelta(docDom, fnDom, split = false){
  var allParas = docDom.getElementsByTagName('w:p');

  //getElementsByTagName recurses into the whole subtree, so it also picks up paragraphs nested
  //inside tables. Tables aren't supported by this importer (or by the docx exporter), so pulling
  //those paragraphs in here would duplicate/misorder content relative to the document's visible
  //layout - only paragraphs outside any table are kept.
  var paras = [];
  for(let p=0;p<allParas.length;p++){
    if(!isInsideTable(allParas[p]))
      paras.push(allParas[p]);
  }

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

      //Footnotes are represented inline in the body text rather than as a separate structure -
      //see the comment on getFootnoteOps below for why.
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
    if(fnRefsInPara.length > 0 && fnDom){

      var fnoteBods = fnDom.getElementsByTagName('w:footnote');

      for(let f=0;f<fnRefsInPara.length;f++){
        var refNum = fnRefsInPara[f].getAttribute('w:id');
        var fnoteBod = getMatchingFNBody(refNum, fnoteBods);

        //A reference with no matching body means the docx is malformed (edited/corrupted after
        //the reference was added) - skip it rather than crash the whole import over one footnote.
        if(fnoteBod)
          delta.ops = delta.ops.concat(getFootnoteOps(fnoteBod, refNum));
        else
          logError(new Error('docx import: footnote reference id ' + refNum + ' has no matching footnote body'));
      }
    }
    else if(fnRefsInPara.length > 0 && !fnDom){
      logError(new Error('docx import: document contains footnote references but footnotes.xml is missing'));
    }


  }
  deltas.push(delta);

  return deltas;
}

//WareWoolf has no first-class footnote data structure. Footnotes round-trip through the body text
//itself using a markdown-footnote-style marker: a "[^n]" reference point inline where the note was
//called out (see docxToDelta above), and a "[^n]: text" paragraph holding the note's body (built
//here). This keeps every format (delta, plain text, mdfc, docx) sharing one representation instead
//of needing a parallel footnotes channel. On export, convertDeltaToDocx in delta-to-docx.js finds
//paragraphs starting with the "[^n]:" marker and reassembles them into real docx footnotes - do not
//"simplify" this by dropping the inline markers without updating that reader too.
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
          //A manual line break splits one run into multiple w:t siblings. Each break starts its
          //own footnote line, same convention as the one marker per w:p paragraph above.
          if(z > 0 && hasPrecedingBreak(textNodes[z]))
            plaintext = plaintext.concat('\n[^' + refNum + ']: ');
          if(textNodes[z].childNodes.length > 0)
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

//Walks backward from a w:t node through its preceding siblings, skipping non-text markup
//(w:rPr, w:tab, etc.), to find whether a w:br sits directly before it rather than another
//w:t - i.e. whether this text segment starts a new line within the run.
function hasPrecedingBreak(textNode){
  var sib = textNode.previousSibling;
  while(sib){
    if(sib.nodeName == 'w:br')
      return true;
    if(sib.nodeName == 'w:t')
      return false;
    sib = sib.previousSibling;
  }
  return false;
}

function isInsideTable(para){
  var node = para.parentNode;
  while(node){
    if(node.nodeName == 'w:tbl')
      return true;
    node = node.parentNode;
  }
  return false;
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