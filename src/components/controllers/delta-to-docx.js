const fs = require('fs');
const docx = require('docx');
const { logError } = require('./error-log');
const { parseDelta } = require('./quill-utils');
const { getTotalWordCount } = require('./wordcount');

function saveDocx(filepath, doc){
  docx.Packer.toBuffer(doc).then((buffer) => {
    try{
      fs.writeFileSync(filepath, buffer)
      console.log("Document created successfully");
    }
    catch(err){
      logError(err);
    }
  });
}

function packageDocxBase64(doc, callback){
  docx.Packer.toBase64String(doc).then((docString) => {
    callback(docString);
  });
}

function convertDeltaToDocx(delt, options, project, addressInfo){
  if(options == null){
    options = {
      styleHeadingAsChapter: false
    }
  }
  var parsedQuill = parseDelta(delt);

  var fnoteParRegx = /^\[\^\d+]:/;

  var footnoteBodies = [];
  var nonfootnoteParas = [];

  //first, extract footnote body paragraphs
  parsedQuill.paragraphs.forEach(function(para){
    if(para.textRuns && para.textRuns.length > 0 && para.textRuns[0].text)
    {
      var thisMarker = fnoteParRegx.exec(para.textRuns[0].text);

      if(thisMarker){
        var xRuns = [];
        para.textRuns[0].text = para.textRuns[0].text.replace(thisMarker, '');

        para.textRuns.forEach(function(run){
          var xRunAttributes = convertRunAtttributes(run.attributes);
          xRunAttributes.text = run.text;
          xRuns.push(new docx.TextRun(xRunAttributes));
        });

        var xParaAttributes = convertParaAttributes(para.attributes);
        xParaAttributes.children = xRuns;

        var matchingBody = footnoteBodies.findIndex(function(fb,i,arr){
          return fb.marker == thisMarker[0].slice(0,-1);
        });

        if(matchingBody > -1){
            footnoteBodies[matchingBody].paras.push(new docx.Paragraph(xParaAttributes));
        }
        else {
          footnoteBodies.push({
            marker: thisMarker[0].slice(0,-1),
            paras: [ new docx.Paragraph(xParaAttributes) ]
          });
        }
      }
      else {
        nonfootnoteParas.push(para);
      }
    }
    else {
      nonfootnoteParas.push(para);
    }
  });

  var xParagraphs = [];
  var fnoteMarkerRegx = /\[\^\d+]/gm;

  nonfootnoteParas.forEach(function(para){
    var xRuns = [];
    para.textRuns.forEach(function(run){
      var fnoteMarker = run.text.match(fnoteMarkerRegx);

      //If run has a footnote marker, split into 2 runs with marker between.
      if(fnoteMarker){
        var textToSplit = run.text;

        for(let m=0; m < fnoteMarker.length; m++){
          var cutPoint = textToSplit.indexOf(fnoteMarker[m]);
          var text1 = textToSplit.slice(0, cutPoint);
          var text2 = textToSplit.slice(cutPoint + fnoteMarker[m].length)
          var xRun1Attr = convertRunAtttributes(run.attributes);
          xRun1Attr.text = text1;

          var fnoteBodyNum = footnoteBodies.findIndex(function(fn, i, arr){
            return fn.marker == fnoteMarker[m];
          }) + 1;

          var fnMarkerRun = new docx.FootnoteReferenceRun(fnoteBodyNum);


          xRuns.push(new docx.TextRun(xRun1Attr));
          xRuns.push(fnMarkerRun);

          textToSplit = text2;

          if(m == fnoteMarker.length - 1){
            var xRun2Attr = convertRunAtttributes(run.attributes);
            xRun2Attr.text = text2;
            xRuns.push(new docx.TextRun(xRun2Attr));
          }

        }
      }
      else {
        var xRunAttributes = convertRunAtttributes(run.attributes);
        xRunAttributes.text = run.text;
        xRuns.push(new docx.TextRun(xRunAttributes));
      }
    });

    var xParaAttributes = convertParaAttributes(para.attributes);
    xParaAttributes.children = xRuns;

    xParagraphs.push(new docx.Paragraph(xParaAttributes));
  });

  var footnotes = {};

  for(i=0;i<footnoteBodies.length;i++){
    footnotes[i + 1] = {
      children: footnoteBodies[i].paras
    }
  }

  console.log(footnotes);

  var sections = [];
  if(options && options.generateTitlePage == true)
    sections.push(getTitlePage(project, addressInfo));

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
    sections: sections
  });

  return doc;
}

function convertParaAttributes(attr){
  var xAttr = {};
  if(attr){
    if(attr.header){
      var xHeadName = "HEADING_" + attr.header.toString();
      xAttr.heading = docx.HeadingLevel[xHeadName];
    }
    if(attr.align){
      xAttr.alignment = docx.AlignmentType[attr.align.toUpperCase()];
    }
  }

  return xAttr;
};

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

function getTitlePage(project, addressInfo){
  var titleParas = [];
  titleParas.push(new docx.Paragraph({
    text: getTitlePageFirstLine(project),
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

function getTitlePageFirstLine(project){
  var wordCount = (Math.round(getTotalWordCount(project)/100)*100).toString();
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