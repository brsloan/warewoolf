const { closePopups, createButton, removeElementsByClass, describeDialog } = require('../controllers/utils');
const { countWords, convertToPlainText } = require('../controllers/wordcount');
const { deltaToElements, estimateScenePages } = require('../controllers/fountain');

//Async because each chapter's word count needs its text, which for a chapter not already in memory
//is now an asynchronous read through the platform facade. The popup is still built and appended in
//one pass - the rows are assembled first, so the reader never sees a half-drawn table.
//
//`script`, when given, is a screenplay project's script - the one document in its Chapters list -
//and the outline is of the scenes inside it rather than of the project's documents: a screenplay is
//written and navigated by scene, which is also what the sidebar lists and what Delete Chapter cuts.
//See showSceneOutliner below and docs/screenplay-plan.md, "One script".
async function showOutliner(project, userSettings, script){
  if(script){
    await showSceneOutliner(script);
    return;
  }

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

//A script's outline: a row per scene heading, the pages the scene fills, and its synopsis lines as
//the summary. No word count and no words-per-page estimate - a screenplay is measured in pages, and
//the pages here are the ones Page Count and the editor's page marks are drawn from (fountain.js's
//estimateScenePages), said in eighths the way a screenwriter says a length. The summary is read from
//the script rather than kept beside it: a scene's synopsis is a line of the script itself, so it is
//shown as it stands and written where it lives, in the editor.
async function showSceneOutliner(script){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup", "popup-outliner");
  describeDialog(popup, 'Outliner');

  var sceneTable = document.createElement('table');
  sceneTable.id = "outliner-table";

  var headerRow = document.createElement('tr');
  ["", "Title", "Pages", "Summary"].forEach(function(h){
    var head = document.createElement('th');
    head.innerText = h;
    headerRow.appendChild(head);
  });
  sceneTable.appendChild(headerRow);

  var elements = deltaToElements(await script.getContentsOrFile());
  var scenes = estimateScenePages(elements);

  scenes.forEach(function(scene, k){
    var row = document.createElement('tr');

    var indexCell = document.createElement('td');
    indexCell.innerText = k + 1;
    row.appendChild(indexCell);

    var titleCell = document.createElement('td');
    titleCell.innerText = scene.title;
    titleCell.classList.add('outliner-title');
    row.appendChild(titleCell);

    var pagesCell = document.createElement('td');
    pagesCell.innerText = scene.eighths;
    pagesCell.classList.add('outliner-page-count');
    row.appendChild(pagesCell);

    var summaryCell = document.createElement('td');
    summaryCell.innerText = synopsisOf(elements, scene.index, k + 1 < scenes.length ? scenes[k + 1].index : elements.length);
    summaryCell.classList.add('outliner-synopsis');
    row.appendChild(summaryCell);

    sceneTable.appendChild(row);
  });

  popup.appendChild(sceneTable);

  var closeBtn = createButton("Close");
  closeBtn.onclick = function(){
    closePopups();
  };
  popup.appendChild(closeBtn);

  document.body.appendChild(popup);
  closeBtn.focus();
}

//The synopsis lines inside a scene - from its heading up to the next one - as one summary. More
//than one is unusual but allowed, and they read as a paragraph together.
function synopsisOf(elements, from, to){
  var lines = [];

  for(var i = from; i < to; i++){
    if(elements[i] && elements[i].type === 'synopsis' && elements[i].text)
      lines.push(elements[i].text);
  }

  return lines.join(' ');
}

module.exports = showOutliner;