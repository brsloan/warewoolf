function showOutliner(){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup", "popup-outliner");

  var chapTable = document.createElement('table');
  chapTable.id = "outliner-table";

  var headerRow = document.createElement('tr');
  var headers = ["","Title", "Words", "Summary"];

  headers.forEach(function(h){
    var head = document.createElement('th');
    head.innerText = h;
    headerRow.appendChild(head);
  });

  chapTable.appendChild(headerRow);

  var outlineIndex = 1;

  project.chapters.forEach(function(chap){
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
    var text = convertToPlainText(chap.contents ? chap.contents : chap.getFile());
    wordCountCell.innerText = countWords(text);
    wordCountCell.classList.add('outliner-word-count');
    row.appendChild(wordCountCell);

    var summaryCell = document.createElement('td');
    summaryCell.classList.add('outliner-summary');
    var summaryInput = document.createElement('input');
    summaryInput.type = "text";
    summaryInput.value = chap.summary;
    summaryInput.onchange = function(){
      chap.summary = summaryInput.value;
    }
    summaryCell.appendChild(summaryInput);
    row.appendChild(summaryCell);

    chapTable.appendChild(row);

  });

  popup.appendChild(chapTable);

  var closeBtn = createButton("Close");
  closeBtn.onclick = function(){
    closePopups();
  };
  popup.appendChild(closeBtn);

  document.body.appendChild(popup);
  document.querySelector('#outliner-table input').focus();
}
