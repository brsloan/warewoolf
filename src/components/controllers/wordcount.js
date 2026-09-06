//Async because a chapter whose text is not already in memory has to be read off disk, which now
//goes through the platform facade. countWords/convertToPlainText below stay pure - they are the
//parts every caller actually reuses.
async function getTotalWordCount(project){
  var total = 0;
  for(let i = 0; i < project.chapters.length; i++){
      var text = convertToPlainText(await project.chapters[i].getContentsOrFile());
      total += countWords(text);
  }
  return total;
}

function countWords(s){
  return s.replaceAll('\n', ' ')
  .replaceAll('\r', ' ')
  .replaceAll('—', ' ')
  .replaceAll('--', ' ')
  .split(' ')
  .filter(function(n) { return n != '' }).length;
}

function convertToPlainText(delt){
  if(!delt || !delt.ops) return '';
  var text = '';
  delt.ops.forEach(op => {
    if(typeof op.insert === 'string')
      text += op.insert;
  });
  return text;
}

module.exports = {
  getTotalWordCount,
  countWords,
  convertToPlainText
}