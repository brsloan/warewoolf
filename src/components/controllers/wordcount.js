function getTotalWordCount(){
  var total = 0;
  project.chapters.forEach(function(chap){
      var text = convertToPlainText(chap.contents ? chap.contents : chap.getFile());
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
