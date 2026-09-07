const { closePopups, createButton, removeElementsByClass, generateRow } = require('../controllers/utils');
const { countWords, getTotalWordCount } = require('../controllers/wordcount');

//Async because the project-wide total needs every chapter's text, which for a chapter not already
//in memory is now an asynchronous read through the platform facade.
async function showWordCount(project, editorQuill){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var popupTitle = document.createElement('h1');
    popupTitle.innerText = 'Word Count';
    popup.appendChild(popupTitle);

    var cntTbl = document.createElement('table');

    var chapLabel = document.createElement('label');
    chapLabel.innerText = 'Chapter: ';

    var chapTotalDisplay = document.createElement('p');
    chapTotalDisplay.innerText = "Calculating...";

    cntTbl.appendChild(generateRow(chapLabel, chapTotalDisplay));

    var totalLabel = document.createElement('label');
    totalLabel.innerText = 'Project: ';

    var totalDisplay = document.createElement('p');
    totalDisplay.innerText = "Calculating...";

    cntTbl.appendChild(generateRow(totalLabel, totalDisplay));

    var sessLabel = document.createElement('label');
    sessLabel.innerText = 'Session: ';

    var sessionTotalDisplay = document.createElement('p');
    sessionTotalDisplay.innerText = "Calculating...";

    cntTbl.appendChild(generateRow(sessLabel, sessionTotalDisplay));

    var goalLabel = document.createElement('label');
    goalLabel.innerText = "Goal: ";
    goalLabel.htmlFor = "word-goal-input";

    var goalInput = document.createElement('input');
    goalInput.type = "number";
    goalInput.min = "0";
    goalInput.value = project.wordGoal;
    goalInput.id = "word-goal-input";

    cntTbl.appendChild(generateRow(goalLabel, goalInput));

    popup.appendChild(cntTbl);

    var progressBarLabel = document.createElement('label');
    progressBarLabel.innerText = "Progress";
    popup.appendChild(progressBarLabel);

    var progressBarContainer = document.createElement('div');
    progressBarContainer.id = "prog-bar-container";
    var progressBarFill = document.createElement('div');
    progressBarFill.id = "prog-bar-fill";
    progressBarContainer.appendChild(progressBarFill);
    popup.appendChild(progressBarContainer);

    var closeBtn = createButton("Close");
    closeBtn.onclick = function(){
      closePopups();
    };
    popup.appendChild(closeBtn);

    document.body.appendChild(popup);

    var activeTotal = countWords(editorQuill.getText());
    var total = await getTotalWordCount(project);
    updateProgressBar();

    goalInput.oninput = function(){
      var parsedGoal = Number(goalInput.value);
      project.wordGoal = Number.isFinite(parsedGoal) ? parsedGoal : 0;
      updateProgressBar();
    };

    chapTotalDisplay.innerText = activeTotal;
    totalDisplay.innerText = total;
    sessionTotalDisplay.innerText = total - project.wordCountOnLoad;
    closeBtn.focus();

    function updateProgressBar(){
      var percentOfGoal = project.wordGoal > 0 ? (total / project.wordGoal) * 100 : 100;
      progressBarFill.style.width = (percentOfGoal <= 100 ? percentOfGoal : 100) + "%";
      progressBarFill.style.backgroundColor = getColor(percentOfGoal/100 <= 1 ? percentOfGoal/100 : 1);
    }

    function getColor(value){
      //value from 0 to 1
      var hue = ((value)*120).toString(10);
      return ["hsl(",hue,",95%,40%)"].join("");
  }
  };

  module.exports = showWordCount;