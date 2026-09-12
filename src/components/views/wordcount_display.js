const { closePopups, createButton, removeElementsByClass, generateRow, describeDialog } = require('../controllers/utils');
const { countWords, getTotalWordCount } = require('../controllers/wordcount');

//Async because the project-wide total needs every chapter's text, which for a chapter not already
//in memory is now an asynchronous read through the platform facade.
async function showWordCount(project, editorQuill, userSettings){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var popupTitle = document.createElement('h1');
    popupTitle.innerText = 'Word Count';
    popup.appendChild(popupTitle);
    describeDialog(popup, popupTitle);

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

    var perPageLabel = document.createElement('label');
    perPageLabel.innerText = "Words per page: ";
    perPageLabel.htmlFor = "words-per-page-input";

    var perPageInput = document.createElement('input');
    perPageInput.type = "number";
    //A page of no words is not a page, so the estimate needs at least 1 here - unlike the goal
    //field, where 0 is the meaningful "no goal set" value.
    perPageInput.min = "1";
    perPageInput.value = userSettings.wordsPerPage;
    perPageInput.id = "words-per-page-input";

    cntTbl.appendChild(generateRow(perPageLabel, perPageInput));

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

    //Written straight through to the settings file rather than waiting on a Save button, since this
    //dialog has none - Close is the only way out of it.
    perPageInput.oninput = function(){
      var parsedPerPage = Number(perPageInput.value);
      userSettings.wordsPerPage = Number.isFinite(parsedPerPage) ? parsedPerPage : 0;
      updateCounts();
      userSettings.save();
    };

    updateCounts();
    closeBtn.focus();

    function updateCounts(){
      chapTotalDisplay.innerText = describeCount(activeTotal);
      totalDisplay.innerText = describeCount(total);
      sessionTotalDisplay.innerText = describeCount(total - project.wordCountOnLoad);
    }

    //"1000 wds / ~4 pgs" - a partly filled page still counts as a page, so the estimate rounds up.
    //A words-per-page value of 0 (or a cleared field) has no page estimate to give rather than an
    //infinite one, so those fall back to the bare count.
    function describeCount(words){
      var perPage = userSettings.wordsPerPage;

      if(!(perPage > 0))
        return words + " wds";

      //|| 0 for the -0 that Math.ceil answers with for a session count gone negative, which would
      //otherwise print as "-0 pgs".
      return words + " wds / ~" + (Math.ceil(words / perPage) || 0) + " pgs";
    }

    function updateProgressBar(){
      var percentOfGoal = project.wordGoal > 0 ? (total / project.wordGoal) * 100 : 100;
      progressBarFill.style.width = (percentOfGoal <= 100 ? percentOfGoal : 100) + "%";
      progressBarFill.style.setProperty('--progress-hue', getHue(percentOfGoal/100 <= 1 ? percentOfGoal/100 : 1));
    }

    //Only the hue is decided here - red at nothing written, through amber, to green at the goal.
    //Saturation and lightness belong to the theme (index.css, #prog-bar-fill), which is what keeps
    //the fill readable against the track on both palettes; a colour fixed here could only suit one.
    function getHue(value){
      //value from 0 to 1
      return ((value)*120).toString(10);
  }
  };

  module.exports = showWordCount;
