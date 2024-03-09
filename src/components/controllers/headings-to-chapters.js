const {addImportedChapter} = require('../controllers/utils');
const { generateChapTitleFromFirstLine } = require('./quill-utils');
const { hideWorking } = require('../views/working_display');

function breakHeadingsIntoChapters(editorQuill, addImportedChapter, headingLevel = 1){
  var opsIn = editorQuill.getContents().ops;
  console.log(opsIn);

  var chaps = [];
  var chapBuilder = [];

  for(let i=0;i < opsIn.length;i++){
    if(i != 0 && i < opsIn.length - 1 && opsIn[i + 1].attributes && opsIn[i + 1].attributes.header && opsIn[i + 1].attributes.header == headingLevel){
      var splitPoint = opsIn[i].insert.lastIndexOf('\n');
      if(splitPoint > -1){
        chapBuilder.push({
          insert: opsIn[i].insert.slice(0, splitPoint),
          attributes: opsIn[i].attributes
        });
      }
      chaps.push({ ops: chapBuilder });
      chapBuilder = [];
      if(splitPoint > -1){
        chapBuilder.push({
          insert: opsIn[i].insert.slice(splitPoint + 1),
          attributes: opsIn[i].attributes
        });
      }
      else {
        chapBuilder.push(opsIn[i]);
      }
    }
    else {
      chapBuilder.push(opsIn[i]);
    }

    if(i == opsIn.length - 1){
      chaps.push({ops: chapBuilder});
    }
  }

  if(chaps.length > 1){
    editorQuill.setContents(chaps.shift(), "user");
    chaps.forEach(function(chap){
      addImportedChapter(chap, generateChapTitleFromFirstLine(chap));
    });
  }
  hideWorking();
}

module.exports = breakHeadingsIntoChapters;