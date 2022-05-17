
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

function compileDocx(filepath, allChaps){
    quillToWord.generateWord(allChaps, {exportAs: 'buffer'}).then(doc => {
        fs.writeFileSync(filepath, doc);
      });
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


function compileDocxNew() {

var testDelta = editorQuill.getContents();

var parsedQuill = quillParser.parseQuillDelta(testDelta);
console.log(parsedQuill);

var xParagraphs = [];

parsedQuill.paragraphs.forEach(function(para){
  var xRuns = [];
  para.textRuns.forEach(function(run){
    xRuns.push(new docx.TextRun(run.text));
  });

  var xAttributes = convertAttributes(para.attributes);

  var paragraphObject = {
    children: xRuns
  };

  if(xAttributes && xAttributes.heading)
    paragraphObject.heading = xAttributes.heading;
  if(xAttributes && xAttributes.alignment)
    paragraphObject.alignment = xAttributes.alignment;

  xParagraphs.push(new docx.Paragraph(paragraphObject));
});

  const doc = new docx.Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 12240, // width and height transposed in LANDSCAPE
          		height: 15840
            }
          }
        },
        children: xParagraphs
      }
    ]
  });

  docx.Packer.toBuffer(doc).then((buffer) => {
    fs.writeFileSync("C:\\Users\\brslo\\Documents\\newtest3.docx", buffer)
    console.log("Document created successfully");
  });
}

function convertAttributes(attr){
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
