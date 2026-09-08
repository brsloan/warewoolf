const docx = require('docx');
const { logError } = require('./error-log');
const { parseDelta, getOrderedListNumbers, getListLevel, getListMarker, isFootnoteMarker } = require('./quill-utils');
const { createPlatform } = require('./platform');
const { createIpcBacking } = require('./platform-ipc');

//writeBinaryFile takes no injected config - filepath is a full path - so this holds its own
//standing instance, the same reason file-manager.js/epub.js do. docx has a browser build
//(Packer.toBlob), so document generation stays in the webview; only the write crosses.
var platform = createPlatform(createIpcBacking());

//Packer.toBuffer() reaches for the Node Buffer global (JSZip's generateAsync({type:'nodebuffer'})
//under the hood), which does not exist in a contextIsolated, --platform=browser renderer - it threw
//"nodebuffer is not supported by this platform" on every packaged build once Phase 9b flipped the
//flag. Packer.toBlob() is the browser build; writeBinaryFile already carries a Uint8Array across the
//boundary (see the comment on it in platform-node.js), so the blob's bytes are read back out via
//arrayBuffer() rather than handed across as a Blob itself.
function saveDocx(filepath, doc, cback = function(){}){
  docx.Packer.toBlob(doc).then((blob) => {
    return blob.arrayBuffer();
  }).then((arrayBuffer) => {
    platform.writeBinaryFile({ path: filepath, bytes: new Uint8Array(arrayBuffer) }).then(function(){
      console.log("Document created successfully");
      cback(filepath);
    }).catch(function(err){
      logError(err);
      cback('error');
    });
  }).catch((err) => {
    logError(err);
    cback('error');
  });
}

function packageDocxBase64(doc, callback){
  docx.Packer.toBase64String(doc).then((docString) => {
    callback(docString);
  }).catch(logError);
}

//`totalWordCount` is handed in rather than computed here. It used to come from getTotalWordCount(),
//which reads every chapter that is not already in memory - now an asynchronous read through the
//platform facade. Making this whole module async for one line of a title page would be the wrong
//trade: it generates a document from a delta and touches no I/O otherwise. Lifting the number out
//to the caller also ends a quadratic re-read, since export.js calls this once per chapter and each
//call used to re-count the entire project.
function convertDeltaToDocx(delt, options, project, addressInfo, totalWordCount){
  if(options == null){
    options = {
      styleHeadingAsChapter: false
    }
  }
  var parsedQuill = parseDelta(delt);

  var footnoteBodies = [];
  var nonfootnoteParas = [];

  //first, extract footnote body paragraphs - grouped by the block attribute a footnote body
  //carries (see blots/footnotes.js) rather than by string-matching a "[^N]: " prefix in the text,
  //which is what this used to do before markers became real embeds. There is no prefix to strip
  //any more: a body paragraph's text is exactly the note's content.
  parsedQuill.paragraphs.forEach(function(para){
    var footnoteId = para.attributes && para.attributes.footnoteBody != null ? String(para.attributes.footnoteBody) : null;

    if(footnoteId != null){
      var matchingBody = footnoteBodies.findIndex(function(fb){ return fb.marker == footnoteId; });

      if(matchingBody > -1){
        footnoteBodies[matchingBody].paras.push(para);
      }
      else {
        footnoteBodies.push({
          marker: footnoteId,
          paras: [ para ]
        });
      }
    }
    else {
      nonfootnoteParas.push(para);
    }
  });

  //Word only resolves a numbered-list paragraph's numbering id when it lives in the main document
  //body, a header, or a footer - footnotes are packaged as a separate part and the resolution pass
  //never runs over them, so a numbered list here would keep the raw, unresolved "{reference-instance}"
  //placeholder as its literal numId and produce an invalid .docx. Render footnote list numbers as
  //plain text instead, the same way the plain-text/mdfc exporters already do it.
  footnoteBodies.forEach(function(fb){
    var listNumbers = getOrderedListNumbers(fb.paras);

    fb.paras = fb.paras.map(function(para, i){
      var xRuns = [];
      var marker = para.attributes && para.attributes.list == 'ordered' ? getListMarker(para.attributes, listNumbers[i]) : '';
      if(marker)
        xRuns.push(new docx.TextRun(marker));

      para.textRuns.forEach(function(run){
        var xRunAttributes = convertRunAtttributes(run.attributes);
        xRunAttributes.text = run.text;
        xRuns.push(new docx.TextRun(xRunAttributes));
      });

      var xParaAttributes = convertFootnoteParaAttributes(para.attributes);
      xParaAttributes.children = xRuns;

      return new docx.Paragraph(xParaAttributes);
    });
  });

  var xParagraphs = [];

  //Word continues the previous list's sequence unless a numbered list is given its own numbering
  //instance, so each new list takes the next one. This lives here rather than at module scope so a
  //document's numbering depends only on that document and not on how many were exported before it.
  var numberedList = { instance: -1 };

  nonfootnoteParas.forEach(function(para, paraIndex){
    var previousPara = paraIndex > 0 ? nonfootnoteParas[paraIndex - 1] : null;
    var xRuns = [];
    para.textRuns.forEach(function(run){
      //A marker is now its own run, one embed to one op via parseDelta - there is no substring to
      //split out of a longer run the way a literal "[^N]" used to require.
      if(isFootnoteMarker(run.text)){
        var fnoteBodyNum = footnoteBodies.findIndex(function(fn){
          return fn.marker == String(run.text.footnote.n);
        }) + 1;

        if(fnoteBodyNum > 0){
          xRuns.push(new docx.FootnoteReferenceRun(fnoteBodyNum));
        }
        else {
          //No footnote body matches this marker (deleted or mistyped) - keep it as plain text
          //rather than referencing a footnote id that does not exist in the document.
          var orphanAttr = convertRunAtttributes(run.attributes);
          orphanAttr.text = '[^' + run.text.footnote.n + ']';
          xRuns.push(new docx.TextRun(orphanAttr));
        }
      }
      else {
        var xRunAttributes = convertRunAtttributes(run.attributes);
        xRunAttributes.text = run.text;
        xRuns.push(new docx.TextRun(xRunAttributes));
      }
    });

    var xParaAttributes = convertParaAttributes(para.attributes, previousPara ? previousPara.attributes : null, numberedList);
    xParaAttributes.children = xRuns;

    xParagraphs.push(new docx.Paragraph(xParaAttributes));
  });

  var footnotes = {};

  for(let i=0;i<footnoteBodies.length;i++){
    footnotes[i + 1] = {
      children: footnoteBodies[i].paras
    }
  }

  var sections = [];
  if(options && options.generateTitlePage == true)
    sections.push(getTitlePage(project, addressInfo, totalWordCount));

  sections.push(getDocBody(xParagraphs, project));

  const doc = new docx.Document({
    creator: project.author,
    title: project.title,
    styles: {
      default: options.styleHeadingAsChapter ? getChapterHeadingStyle() : {},
      paragraphStyles: [
        {
          name: 'Normal',
          quickFormat: true,
          run: {
            size: 24,
          },
          paragraph: {
            spacing: {
              line: 480,
            }
          }
        },
        {
          id: 'address',
          name: 'Address',
          quickFormat: true,
          run: {
            size: 24,
          },
          paragraph: {
            spacing: {
              line: 240,
            }
          }
        }
      ]
    },
    footnotes: footnotes,
    sections: sections,
    numbering: {
      config: [
        {
          reference: 'numbered-list',
          levels: [
            {
              level: 0,
              alignment: docx.AlignmentType.START,
              text: "%1.",
              format: docx.LevelFormat.DECIMAL,
              style: {
                paragraph: {
                    indent: { left: docx.convertInchesToTwip(0.5), hanging: docx.convertInchesToTwip(0.25) },
                },
            },
            },
            {
              level: 1,
              alignment: docx.AlignmentType.START,
              text: "%2.",
              format: docx.LevelFormat.LOWER_LETTER,
              style: {
                paragraph: {
                    indent: { left: docx.convertInchesToTwip(1), hanging: docx.convertInchesToTwip(0.25) },
                },
            },
            },
            {
              level: 2,
              alignment: docx.AlignmentType.START,
              text: "%3.",
              format: docx.LevelFormat.LOWER_ROMAN,
              style: {
                paragraph: {
                    indent: { left: docx.convertInchesToTwip(1.5), hanging: docx.convertInchesToTwip(0.25) },
                },
            },
            }
          ]
        }
      ]
    }
  });

  return doc;
}

function convertParaAttributes(attr, previousAttr = null, numberedList = { instance: -1 }){
  var xAttr = {};
  if(attr){
    if(attr.header){
      var xHeadName = "HEADING_" + attr.header.toString();
      xAttr.heading = docx.HeadingLevel[xHeadName];
    }
    if(attr.align){
      xAttr.alignment = docx.AlignmentType[attr.align.toUpperCase()];
    }
    if(attr.blockquote){
      xAttr.indent = {
        left: docx.convertInchesToTwip(0.5),
        right: docx.convertInchesToTwip(0.5)
      };
    }
    if(attr.list){
      //Quill's indent has no ceiling, but the numbering config below only declares 3 levels - anything
      //deeper needs to be folded into the last one the same way getListLevel does it for other formats,
      //otherwise it references an unconfigured level and silently loses its intended list style.
      var level = getListLevel(attr);
      if(attr.list == 'bullet'){
        xAttr.bullet = {level: level};
      }
      else{
        //If start of new list, need to iterate to new list instance to restart numbering sequence
        if(!previousAttr || !previousAttr.list || previousAttr.list == 'bullet')
          numberedList.instance++;

        //Every item carries the instance, not just the first. Leaving it off the rest of the list
        //drops them back onto the default instance, which is the previous list's sequence.
        xAttr.numbering = {
          reference: 'numbered-list',
          level: level,
          instance: numberedList.instance
        }
      }
    }
  }

  return xAttr;
};

//Footnotes are packaged separately from the main document body, and Word never resolves a numbered
//list's numbering id there (see the comment above the footnoteBodies.forEach call), so footnote
//paragraphs render list numbers as plain text rather than through xAttr.numbering. Bullets still work
//natively in footnotes, so those keep using docx's own bullet formatting.
function convertFootnoteParaAttributes(attr){
  var xAttr = {};
  if(attr){
    if(attr.header){
      var xHeadName = "HEADING_" + attr.header.toString();
      xAttr.heading = docx.HeadingLevel[xHeadName];
    }
    if(attr.align){
      xAttr.alignment = docx.AlignmentType[attr.align.toUpperCase()];
    }
    if(attr.blockquote){
      xAttr.indent = {
        left: docx.convertInchesToTwip(0.5),
        right: docx.convertInchesToTwip(0.5)
      };
    }
    if(attr.list == 'bullet'){
      xAttr.bullet = {level: getListLevel(attr)};
    }
  }

  return xAttr;
}

function convertRunAtttributes(attr){
  var xAttr = {};
  if(attr){
    if(attr.italic)
      xAttr.italics = attr.italic;
    if(attr.bold)
      xAttr.bold = attr.bold;
    if(attr.strike)
      xAttr.strike = attr.strike;
    if(attr.underline)
      xAttr.underline = {};
  }

  return xAttr;
}

function getDocBody(xParagraphs, project){
  return {
    properties: {
      page: {
        pageNumbers: {
          start: 1
        },
        size: {
          width: 12240,
          height: 15840
        }
      }
    },
    headers: {
      default: new docx.Header({
        children: [ new docx.Paragraph({
          alignment: docx.AlignmentType.RIGHT,
          children: [
            new docx.TextRun({
              children: [project.author + ' / ' + project.title + ' / ', docx.PageNumber.CURRENT]
            })
          ]
        })]
      })
    },
    children: xParagraphs
  }
}

function getTitlePage(project, addressInfo, totalWordCount){
  var titleParas = [];
  titleParas.push(new docx.Paragraph({
    text: getTitlePageFirstLine(project, totalWordCount),
    style: 'address'
  }));

  var addressLines = addressInfo.split('\n');
  addressLines.forEach((line, i) => {
    titleParas.push(new docx.Paragraph({
      text: line,
      style: 'address'
    }));
  });

  if(addressLines.length < 4){
    for(let i=0; i < 4 - addressLines.length; i++){
      titleParas.push(new docx.Paragraph({
        text: '',
        style: 'address'
      }));
    }
  }

  for(let i=0; i<7; i++){
    titleParas.push(new docx.Paragraph(''));
  }

  titleParas.push(new docx.Paragraph({
    alignment: docx.AlignmentType.CENTER,
    children: [
      new docx.TextRun({
        children: [project.title != '' ? project.title : 'TITLE']
      })
    ]
  }));

  titleParas.push(new docx.Paragraph({
    alignment: docx.AlignmentType.CENTER,
    children: [
      new docx.TextRun({
        children: ['by ' + (project.author != '' ? project.author : 'Author')]
      })
    ]
  }));

  return {
    properties: {
      titlePage: true,
      page: {
        size: {
          width: 12240,
          height: 15840
        }
      }
    },
    children: titleParas
  };

}

function getTitlePageFirstLine(project, totalWordCount){
  var wordCount = (Math.round((totalWordCount || 0)/100)*100).toString();
  if(wordCount.length > 3){
    wordCount = wordCount.slice(0,-3) + ',' + wordCount.slice(-3);
  }
  wordCount += ' words';

  var spaceCount = project.author.length > 20 ? 8 : 9;

  var lineText = '';

  for(let i=0; i < spaceCount; i++)
    lineText = lineText.concat('\t');

  lineText = project.author + lineText + wordCount;

  return lineText;
}

function getChapterHeadingStyle(){
  return {
        heading1: {
                run: {
                    size: 32,
                    bold: true,
                    color: "000000",
                },
                paragraph: {
                    spacing: {
                        before: 1200,
                        after: 1200,
                    },
                    pageBreakBefore: true,
                },
            },
      }
}

module.exports = {
  saveDocx,
  packageDocxBase64,
  convertDeltaToDocx
}