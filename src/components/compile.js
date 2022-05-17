
function compileProject(options, filepath){
    console.log(options);
    console.log(filepath);
    var allChaps = compileChapterDeltas(options);

    switch(options.type){
        case ".txt":
            compilePlainText(filepath, allChaps);
            break;
        case ".docx":
            compileDocx(filepath, allChaps);
            break;
        default:
            console.log("No valid filetype selected for compile.");
    }
}

function compilePlainText(dir, allChaps){
    var allText = convertToPlainText(allChaps);
    fs.writeFileSync(dir, allText);
}

function compileChapterDeltas(options){
    var divider = options.insertStrng;
    var Delta = Quill.import('delta');
    var compiled = new Delta();
    if(options.insertHead){
      compiled.insert(project.chapters[0].title);
      compiled.insert('\n', { header: 1 } );
    }
    compiled = compiled.concat(new Delta(project.chapters[0].getFile()));

    for(i=1; i<project.chapters.length; i++){
        var thisDelta = new Delta(project.chapters[i].getFile());
        compiled.insert(divider + '\n');

        if(options.insertHead){
          compiled.insert(project.chapters[i].title);
          compiled.insert('\n', { header: 1 } );
        }

        compiled = compiled.concat(thisDelta);
    }

    return compiled;
}


function compileDocx(filepath, delt) {
  var doc = convertDeltaToDocx(delt);
  saveDocx(filepath, doc);
}

function saveDocx(filepath, doc){
  docx.Packer.toBuffer(doc).then((buffer) => {
    fs.writeFileSync(filepath, buffer)
    console.log("Document created successfully");
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
