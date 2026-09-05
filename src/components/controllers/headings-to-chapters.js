const { generateChapTitleFromFirstLine } = require('./quill-utils');

function breakHeadingsIntoChapters(editorQuill, addImportedChapter, headingLevel = 1){
  var opsIn = editorQuill.getContents().ops;

  var chaps = [];
  var chapBuilder = [];

  //i != 0 is intentional, not an off-by-one: it means a heading at the very start of the
  //document is never split off. The content up through the first heading match stays in
  //chapBuilder and becomes chaps[0], which is kept as the current document below rather than
  //imported as a new chapter - so the first heading section is deliberately left in place
  //instead of being spun out on its own.
  for(let i=0;i < opsIn.length;i++){
    if(i != 0 && i < opsIn.length - 1 && opsIn[i + 1].attributes && opsIn[i + 1].attributes.header && opsIn[i + 1].attributes.header == headingLevel){
      var splitPoint = typeof opsIn[i].insert === 'string' ? opsIn[i].insert.lastIndexOf('\n') : -1;
      if(splitPoint > -1){
        chapBuilder.push({
          insert: opsIn[i].insert.slice(0, splitPoint + 1),
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
    return true;
  }
  return false;
}

module.exports = breakHeadingsIntoChapters;