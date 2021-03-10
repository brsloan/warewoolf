function countWords(s){
    return s.replaceAll('\n', ' ')
    .replaceAll('\r', ' ')
    .replaceAll('—', ' ')
    .replaceAll('--', ' ')
    .split(' ')
    .filter(function(n) { return n != '' }).length;
  }