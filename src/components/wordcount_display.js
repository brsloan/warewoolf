function showWordCount(){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup");

    var chapTotalDisplay = document.createElement('p');
    chapTotalDisplay.innerText = "Chapter Word Count: Calculating...";
    popup.appendChild(chapTotalDisplay);

    var totalDisplay = document.createElement('p');
    totalDisplay.innerText = "Total Word Count: Calculating...";
    popup.appendChild(totalDisplay);

    var goalLabel = document.createElement('label');
    goalLabel.innerText = "Goal: ";
    goalLabel.for = "word-goal-input";
    popup.appendChild(goalLabel);

    var goalInput = document.createElement('input');
    goalInput.type = "number";
    goalInput.value = project.wordGoal;
    goalInput.id = "word-goal-input";
    popup.appendChild(goalInput);

    popup.appendChild(document.createElement('br'));

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
    var total = getTotalWordCount();
    updateProgressBar();

    goalInput.onkeyup = function(){
      project.wordGoal = goalInput.value;
      updateProgressBar();
    };

    chapTotalDisplay.innerText = "Chapter Word Count: " + activeTotal;
    totalDisplay.innerText = "Total Word Count: " + total;
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
