function getTotalWordCount(project){
  var total = 0;
  project.chapters.forEach(function(chap){
      var text = convertToPlainText(chap.getContentsOrFile());
      total += countWords(text);
  });
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
  countWords
}