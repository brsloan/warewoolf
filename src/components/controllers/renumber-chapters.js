function renumberChaps(startIndex, endIndex, withinChaps, useNumerals, template){
  //template should have [num] where number should go
  var newNum = 1;

  for (let i = startIndex; i <= endIndex; i++){
    let chap = project.chapters[i];
    var numText = useNumerals ? newNum : integerToWord(newNum);
    chap.title = template.replaceAll('[num]', numText);
    newNum++;

    if(withinChaps)
      insertChapTitle(chap);

    chap.hasUnsavedChanges = true;
  }

    project.hasUnsavedChanges = true;
}

function insertChapTitle(chap){
  var delt = chap.contents ? chap.contents : chap.getFile();

  var tempQuill = getTempQuill();
  tempQuill.setContents(delt);

  var firstLineFormat = tempQuill.getFormat(1, 1);

  if(firstLineFormat.header){
      //If already a header, delete it first
      var firstLine = tempQuill.getText().split('\n')[0];
      tempQuill.deleteText(0, firstLine.length, 'api');
      tempQuill.insertText(0, chap.title, 'api');
  }
  else {
    //If no header, insert one
    tempQuill.insertText(0, chap.title + '\n\n', 'api');
  }

  tempQuill.formatLine(1, 1, 'header', 1);
  tempQuill.formatLine(1, 1, 'align', 'center');

  chap.contents = tempQuill.getContents();
}


function integerToWord(i){
  var words = [
    'Zero',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
    'Twenty',
    'Twenty-One',
    'Twenty-Two',
    'Twenty-Three',
    'Twenty-Four',
    'Twenty-Five',
    'Twenty-Six',
    'Twenty-Seven',
    'Twenty-Eight',
    'Twenty-Nine',
    'Thirty',
    'Thirty-One',
    'Thirty-Two',
    'Thirty-Three',
    'Thirty-Four',
    'Thirty-Five',
    'Thirty-Six',
    'Thirty-Seven',
    'Thirty-Eight',
    'Thirty-Nine',
    'Forty',
    'Forty-One',
    'Forty-Two',
    'Forty-Three',
    'Forty-Four',
    'Forty-Five',
    'Forty-Six',
    'Forty-Seven',
    'Forty-Eight',
    'Forty-Nine',
    'Fifty',
    'Fifty-One',
    'Fifty-Two',
    'Fifty-Three',
    'Fifty-Four',
    'Fifty-Five',
    'Fifty-Six',
    'Fifty-Seven',
    'Fifty-Eight',
    'Fifty-Nine',
    'Sixty',
    'Sixty-One',
    'Sixty-Two',
    'Sixty-Three',
    'Sixty-Four',
    'Sixty-Five',
    'Sixty-Six',
    'Sixty-Seven',
    'Sixty-Eight',
    'Sixty-Nine',
    'Seventy',
    'Seventy-One',
    'Seventy-Two',
    'Seventy-Three',
    'Seventy-Four',
    'Seventy-Five',
    'Seventy-Six',
    'Seventy-Seven',
    'Seventy-Eight',
    'Seventy-Nine',
    'Eighty',
    'Eighty-One',
    'Eighty-Two',
    'Eighty-Three',
    'Eighty-Four',
    'Eighty-Five',
    'Eighty-Six',
    'Eighty-Seven',
    'Eighty-Eight',
    'Eighty-Nine',
    'Ninety',
    'Ninety-One',
    'Ninety-Two',
    'Ninety-Three',
    'Ninety-Four',
    'Ninety-Five',
    'Ninety-Six',
    'Ninety-Seven',
    'Ninety-Eight',
    'Ninety-Nine',
    'One Hundred'
  ];

  return words[i];
}
