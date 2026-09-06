const { getTempQuill } = require('./quill-utils');

//Async because insertChapTitle below has to read a chapter that is not already in memory, which now
//goes through the platform facade.
async function renumberChaps(project, startIndex, endIndex, withinChaps, useNumerals, template){
  //template should have [num] where number should go
  var newNum = 1;
  var firstIndex = Math.max(0, startIndex);
  var lastIndex = Math.min(project.chapters.length - 1, endIndex);
  var anyChanged = false;

  for (let i = firstIndex; i <= lastIndex; i++){
    let chap = project.chapters[i];
    var numText = useNumerals ? newNum : integerToWord(newNum);
    chap.title = template.replaceAll('[num]', numText);
    newNum++;

    if(withinChaps)
      await insertChapTitle(chap);

    chap.hasUnsavedChanges = true;
    anyChanged = true;
  }

  if(anyChanged)
    project.hasUnsavedChanges = true;
}

async function insertChapTitle(chap){
  var delt = await chap.getContentsOrFile();
  //A chapter whose file failed to load reads back as null/undefined. Unlike the other converters,
  //this function has no "anything to change?" check - it unconditionally writes back whatever it
  //builds, so without this guard a failed load would silently replace the chapter's real content
  //with a lone title line.
  if(delt == null)
    return;

  var tempQuill = getTempQuill();
  tempQuill.setContents(delt);

  var firstLineFormat = tempQuill.getFormat(0, 1);

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

  tempQuill.formatLine(0, 1, 'header', 1);
  tempQuill.formatLine(0, 1, 'align', 'center');

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

  return words[i] || String(i);
}

module.exports = {
  renumberChaps,
  insertChapTitle
}