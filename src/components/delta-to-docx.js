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

function convertDeltaToDocx(delt){
  var parsedQuill = quillParser.parseQuillDelta(delt);

  var xParagraphs = [];

  parsedQuill.paragraphs.forEach(function(para){
    var xRuns = [];
    para.textRuns.forEach(function(run){
      var xRunAttributes = convertRunAtttributes(run.attributes);
      xRunAttributes.text = run.text;
      xRuns.push(new docx.TextRun(xRunAttributes));
    });

    var xParaAttributes = convertParaAttributes(para.attributes);
    xParaAttributes.children = xRuns;

    xParagraphs.push(new docx.Paragraph(xParaAttributes));
  });

  const doc = new docx.Document({
    creator: project.author,
    title: project.title,
    styles: {
      default: {
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
      },
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
        }
      ]
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 12240,
              height: 15840
            }
          }
        },
        children: xParagraphs
      }
    ]
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
