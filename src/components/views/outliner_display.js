const { closePopups, createButton, removeElementsByClass, describeDialog } = require('../controllers/utils');
const { countWords, convertToPlainText } = require('../controllers/wordcount');

//Async because each chapter's word count needs its text, which for a chapter not already in memory
//is now an asynchronous read through the platform facade. The popup is still built and appended in
//one pass - the rows are assembled first, so the reader never sees a half-drawn table.
async function showOutliner(project, userSettings){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup", "popup-outliner");
  describeDialog(popup, 'Outliner');

  var chapTable = document.createElement('table');
  chapTable.id = "outliner-table";

  var headerRow = document.createElement('tr');
  var headers = ["","Title", "Words", "Pages", "Summary"];

  headers.forEach(function(h){
    var head = document.createElement('th');
    head.innerText = h;
    headerRow.appendChild(head);
  });

  chapTable.appendChild(headerRow);

  var outlineIndex = 1;

  for(let chapIndex = 0; chapIndex < project.chapters.length; chapIndex++){
    let chap = project.chapters[chapIndex];
    var row = document.createElement('tr');

    var indexCell = document.createElement('td');
    indexCell.innerText = outlineIndex;
    row.appendChild(indexCell);
    outlineIndex++;

    var titleCell = document.createElement('td');
    titleCell.innerText = chap.title;
    titleCell.classList.add('outliner-title');
    row.appendChild(titleCell);

    var wordCountCell = document.createElement('td');
    var text = convertToPlainText(await chap.getContentsOrFile());
    var words = countWords(text);
    wordCountCell.innerText = words;
    wordCountCell.classList.add('outliner-word-count');
    row.appendChild(wordCountCell);

    var pagesCell = document.createElement('td');
    pagesCell.innerText = estimatePages(words);
    pagesCell.classList.add('outliner-page-count');
    row.appendChild(pagesCell);

    var summaryCell = document.createElement('td');
    summaryCell.classList.add('outliner-summary');
    var summaryInput = document.createElement('input');
    summaryInput.type = "text";
    summaryInput.setAttribute('aria-label', 'Summary of ' + (chap.title || '(untitled)'));
    summaryInput.value = chap.summary || '';
    summaryInput.onchange = function(){
      chap.summary = summaryInput.value;
      project.hasUnsavedChanges = true;
    }
    summaryCell.appendChild(summaryInput);
    row.appendChild(summaryCell);

    chapTable.appendChild(row);

  }

  popup.appendChild(chapTable);

  var closeBtn = createButton("Close");
  closeBtn.onclick = function(){
    closePopups();
  };
  popup.appendChild(closeBtn);

  document.body.appendChild(popup);
  var firstInput = document.querySelector('#outliner-table input');
  if(firstInput) firstInput.focus();

  //Same words-per-page setting the Word Count dialog writes, but kept to a tenth of a page rather
  //than rounded up to a whole one: these are read down the column and compared against each other,
  //and whole pages would both flatten the difference between neighbouring chapters and sum to well
  //past the project's own page estimate. A value of 0 (or no settings at hand at all) has no
  //estimate to give rather than an infinite one, so the column is left empty in that case.
  function estimatePages(words){
    var perPage = userSettings ? userSettings.wordsPerPage : 0;

    if(!(perPage > 0))
      return '';

    return "~" + (words / perPage).toFixed(1);
  }
}

module.exports = showOutliner;