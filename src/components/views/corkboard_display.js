const { closePopups, createButton, removeElementsByClass } = require('../controllers/utils');
const { getCardsFromFile, saveCards } = require('../controllers/corkboard');
const isMac = process.platform === "darwin";

/*Controls to add:
- Text size (CTRL + -)
X # of Columns (CTRL < >)
X Add/remove cards
X Rearrange cards
X Change card colors
X Checkmark cards as written
X Override escape for this screen and flag unsaved changes
X Override ctrl H for special help screen?
X Remember # cols in project settings
*/

var loadedCards = [];
var unsavedChanges = false;

function showCorkboard(project){
    removeElementsByClass('popup');
    var popup = document.createElement("div");
    popup.classList.add("popup", "popup-corkboard");

    var corkboard = document.createElement('div');
    corkboard.id = 'corkboard';
    popup.appendChild(corkboard);

    document.body.appendChild(popup);

    loadedCards = getCardsFromFile(project.directory + project.chapsDirectory);
    if(!loadedCards)
      loadedCards = generateStarterCard();

    fillCorkboard(project.corkboardColumns);
    assignLoadedCards();

    popup.addEventListener('keydown', boardCntrlEvents);
    focusCard(1);
}

function generateStarterCard(){
  return [{
    label: '',
    descr: '',
    color: 0,
    checked: false
  }];
}

function resetCorkboard(){
  fillCorkboard(project.corkboardColumns);
  assignLoadedCards();
}

function fillCorkboard(numCols) {
  var corkboard = document.getElementById("corkboard");
  corkboard.innerHTML = "";

  corkboard.appendChild(getTitleBar());

  var cardCounter = 1;

  var cardsPerCo = Math.ceil(loadedCards.length / numCols);
  
  for (i = 0; i < numCols; i++) {
    var col = document.createElement("div");

    col.classList.add("corkboard-column");

    for (r = 0; r < cardsPerCo; r++) {
      col.appendChild(createCardSpot(cardCounter, i, r));
      cardCounter++;
    }

    corkboard.appendChild(col);
  }
}

function getTitleBar(){
  var titleBar = document.createElement('div');
  titleBar.id = 'corkboard-title-bar';
  var corkboardTitle = document.createElement('h2');
  corkboardTitle.innerText = 'Corkboard';
  titleBar.appendChild(corkboardTitle);

  var helpReminder = document.createElement('p');
  helpReminder.innerText = "For Help Press " + (isMac ? "Cmd + Shift + H" : "Cntrl + H");
  titleBar.appendChild(helpReminder);

  return titleBar;
}

function createCardSpot(num, owningCol, posInCol) {
  var card = document.createElement("div");
  card.id = "card" + num;
  card.classList.add("corkboard-card");

  var label = document.createElement("input");
  label.type = "text";
  label.classList.add("card-label");
  label.id = "card-label" + num;
  label.disabled = true;
  label.onchange = markUnsavedChanges;  

  card.appendChild(label);

  var numLabel = document.createElement("h2");
  numLabel.innerText = num;
  numLabel.classList.add("card-num-label");
  card.appendChild(numLabel);

  var descr = document.createElement("textarea");
  descr.classList.add("card-description");
  descr.id = "card-descr" + num;
  descr.disabled = true;
  descr.onchange = markUnsavedChanges;

  card.appendChild(descr);
  
  card.dataset.index = num - 1;
  card.dataset.owningCol = owningCol;
  card.dataset.posInCol = posInCol;
  card.addEventListener('keydown', cardCntrlEvents);
  card.classList.add('corkboard-card-unused');
  
  var checkmark = document.createElement('div');
  checkmark.id = "card-checkmark" + num;
  checkmark.classList.add('card-checkmark');
  card.appendChild(checkmark);

  return card;
}

function assignLoadedCards() {
  for (i = 0; i < loadedCards.length; i++) {
    var matchingCard = document.getElementById('card' + (i +1));
    
    if(matchingCard){
      matchingCard.classList.remove('corkboard-card-unused');
      
      var thisCardLabel = document.getElementById("card-label" + (i + 1));
      thisCardLabel.value = loadedCards[i].label;
      thisCardLabel.disabled = false;
      thisCardLabel.dataset.cardIndex = i;
      thisCardLabel.addEventListener('keyup', function(e){
        loadedCards[parseInt(this.dataset.cardIndex)].label = this.value;
      });
    
      var thisCardDescr = document.getElementById("card-descr" + (i + 1));
      thisCardDescr.value = loadedCards[i].descr;
      thisCardDescr.disabled = false;
      thisCardDescr.dataset.cardIndex = i;
      thisCardDescr.addEventListener('keyup', function(e){
        loadedCards[parseInt(this.dataset.cardIndex)].descr = this.value;
      });
    
      if(loadedCards[i].checked == true){
        var thisCardCheckmark = document.getElementById("card-checkmark" + (i + 1));
        thisCardCheckmark.classList.add('card-checkmark-checked');  
      }

      if(loadedCards[i].color && loadedCards[i].color != 0){
        matchingCard.classList.add('corkboard-color' + loadedCards[i].color); 
      }
    }
  }
}
  
function focusCard(num){
  if(num > 0){
   var card = document.getElementById("card-label" + num);
   if(card)
     card.focus();
  }
}  

function insertBlankCard(ind){
  var blankCard = { label: '', descr: '' };
  
  loadedCards.splice(ind, 0, blankCard);
}

function moveCardLeft(card){
  if(card.dataset.index && card.dataset.index != '0'){
    var oldCardIndex = parseInt(card.dataset.index);
    var newCardIndex = oldCardIndex - 1;
  
    loadedCards.splice(newCardIndex, 0, loadedCards.splice(oldCardIndex, 1)[0]);
  }
}

function moveCardRight(card){
  if(card.dataset.index){
    var oldCardIndex = parseInt(card.dataset.index);
    var newCardIndex = oldCardIndex + 1;
    
    if(oldCardIndex != loadedCards.length - 1)
      loadedCards.splice(newCardIndex, 0, loadedCards.splice(oldCardIndex, 1)[0]);
    else {
      insertBlankCard(oldCardIndex);
    }
      
  }
}
  
function moveCardUp(card){
  var newCardNumber = getAboveCardNum(card);
  var newCardIndex = newCardNumber - 1;
  var oldCardIndex = parseInt(card.dataset.index);

  if(oldCardIndex != 0)
    loadedCards.splice(newCardIndex, 0, loadedCards.splice(oldCardIndex, 1)[0]);

  return newCardNumber;
}

function moveCardDown(card){
  var newCardNumber = getBelowCardNum(card);
  var newCardIndex = newCardNumber - 1;
  var oldCardIndex = parseInt(card.dataset.index);

  if(oldCardIndex != loadedCards.length - 1)
    loadedCards.splice(newCardIndex, 0, loadedCards.splice(oldCardIndex, 1)[0]);

  return newCardNumber;
}

function getAboveCardNum(currentCard){
  var thisIndex = parseInt(currentCard.dataset.index);
  var cardsPerRow = getCardsPerRow();
  var cardsPerGroup = Math.ceil(loadedCards.length / project.corkboardColumns);
  var cardsBefore = parseInt(currentCard.dataset.posInCol);
  var aboveCardNum = thisIndex + 1;//Default to current card num

  if(cardsBefore >= cardsPerRow)
    aboveCardNum = thisIndex + 1 - cardsPerRow;
  else{
    var numInLastRow = cardsPerGroup - (cardsPerRow * Math.floor(cardsPerGroup / cardsPerRow));

    if(cardsBefore >= numInLastRow)
      aboveCardNum = thisIndex + 1 - cardsPerRow - numInLastRow;
    else {
      aboveCardNum = thisIndex + 1 - numInLastRow;
    }
  }
  
  return aboveCardNum > 0 ? aboveCardNum : thisIndex + 1;
}

function getBelowCardNum(currentCard){
  var thisIndex = parseInt(currentCard.dataset.index);
  var cardsPerRow = getCardsPerRow();
  var cardsPerGroup = Math.ceil(loadedCards.length / project.corkboardColumns);
  var cardsLeft = cardsPerGroup - parseInt(currentCard.dataset.posInCol) - 1;
  var belowCardNum = thisIndex + 1;//Default to current card num

  if(cardsLeft >= cardsPerRow)
    belowCardNum = thisIndex + 1 + cardsPerRow;
  else {
    var numInLastRow = cardsPerGroup - (cardsPerRow * Math.floor(cardsPerGroup / cardsPerRow));
    if(cardsLeft >= numInLastRow){
      belowCardNum = thisIndex + 1 + cardsPerRow + numInLastRow;
    }
    else {
      belowCardNum = thisIndex + 1 + numInLastRow;
    }
  }
    
  return belowCardNum <= loadedCards.length ? belowCardNum : thisIndex + 1;
}

function getCardsPerRow(){
  var colWidth = document.getElementsByClassName('corkboard-column')[0].clientWidth;
  var cardWidth = getElementWidthWithMargin(document.getElementsByClassName('corkboard-card')[0]);
  return Math.floor(colWidth/cardWidth);
}

function getElementWidthWithMargin(element) {
  const styles = getComputedStyle(element);
  const width = element.offsetWidth;
  const marginLeft = parseInt(styles.marginLeft, 10) || 0;
  const marginRight = parseInt(styles.marginRight, 10) || 0;

  return width + marginLeft + marginRight;
}

function boardCntrlEvents(e){
  if((e.ctrlKey || e.metaKey) && (e.key === "s")){
    stopDefaultPropagation(e);
    saveCards(loadedCards, project.directory + project.chapsDirectory);
    project.saveFile();
    unmarkUnsavedChanges();
  }
  else if(e.key === "Escape"){
    stopDefaultPropagation(e);
    if(unsavedChanges == true){
      promptToSave();
    }
    else
      closePopups();
  }
  else if(((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "h") || (e.ctrlKey && e.key == "h")){
    stopDefaultPropagation(e);
    showHelp();
  }
}

function cardCntrlEvents(e) {
  if ((e.ctrlKey || e.metaKey)  && e.shiftKey && e.key === "ArrowUp")   {
    stopDefaultPropagation(e);
    var newCardNum = moveCardUp(this);
    resetCorkboard();
    focusCard(newCardNum);
    markUnsavedChanges();
  }
  else if((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "ArrowDown"){
    stopDefaultPropagation(e);
    var newCardNum = moveCardDown(this);
    resetCorkboard();
    focusCard(newCardNum);
    markUnsavedChanges();
  }
  else if((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "ArrowRight"){
    stopDefaultPropagation(e);
    moveCardRight(this);
    resetCorkboard();
    focusCard(parseInt(this.dataset.index) + 2);
    markUnsavedChanges();
  }
  else if((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "ArrowLeft"){
    stopDefaultPropagation(e);
    moveCardLeft(this);
    resetCorkboard();
    focusCard(parseInt(this.dataset.index));
    markUnsavedChanges();
  }
  else if((e.ctrlKey || e.metaKey) && e.key === "ArrowUp"){
    stopDefaultPropagation(e);
    focusCard(getAboveCardNum(this));
  }
  else if((e.ctrlKey || e.metaKey) && e.key === "ArrowDown"){
    stopDefaultPropagation(e);
    focusCard(getBelowCardNum(this));
  }
  else if((e.ctrlKey || e.metaKey) && e.key === "ArrowRight"){
    stopDefaultPropagation(e);
    focusCard(parseInt(this.dataset.index) + 2);
  }
    else if((e.ctrlKey || e.metaKey) && e.key === "ArrowLeft"){
    stopDefaultPropagation(e);
    focusCard(parseInt(this.dataset.index));
  }
    else if((e.ctrlKey || e.metaKey) && e.key === "i"){
      stopDefaultPropagation(e);
      insertBlankCard(parseInt(this.dataset.index) + 1);
      resetCorkboard();
      focusCard(parseInt(this.dataset.index) + 2);
      markUnsavedChanges();
  }
    else if((e.ctrlKey || e.metaKey) && (e.key === "Delete" || e.key === "Backspace")){
      stopDefaultPropagation(e);
      var thisIndex = parseInt(this.dataset.index);
      if(loadedCards.length > 1){
        loadedCards.splice(thisIndex, 1);
        resetCorkboard();
        focusCard(thisIndex < loadedCards.length ? thisIndex + 1 : thisIndex);  
        markUnsavedChanges();
      }
  }
  else if((e.ctrlKey || e.metaKey) && (e.key === "Enter")){
    stopDefaultPropagation(e);
    var thisIndex = parseInt(this.dataset.index);
    loadedCards[thisIndex].checked = !loadedCards[thisIndex].checked;
    resetCorkboard();
    focusCard(thisIndex + 1);
    markUnsavedChanges();
  }
  else if((e.ctrlKey || e.metaKey) && (e.key === ",")){
    stopDefaultPropagation(e);
    var thisIndex = parseInt(this.dataset.index);
    if(project.corkboardColumns > 1)
      project.corkboardColumns--;
    resetCorkboard();
    focusCard(thisIndex + 1);
    markUnsavedChanges();
  }
  else if((e.ctrlKey || e.metaKey) && (e.key === ".")){
    stopDefaultPropagation(e);
    var thisIndex = parseInt(this.dataset.index);
    project.corkboardColumns++;
    resetCorkboard();
    focusCard(thisIndex + 1);
    markUnsavedChanges();
  }
  else if((e.ctrlKey || e.metaKey) && isFinite(e.key) && e.key !== " "){
    stopDefaultPropagation(e);
    var thisIndex = parseInt(this.dataset.index);
    loadedCards[thisIndex].color = e.key;
    for(i=1;i<10;i++){
      this.classList.remove('corkboard-color' + i);
    }
    if(e.key > 0)
      this.classList.add('corkboard-color' + e.key);     
    
    markUnsavedChanges();
  }
}

function stopDefaultPropagation(keyEvent) {
  keyEvent.preventDefault();
  keyEvent.stopPropagation();
}

function markUnsavedChanges(e){
  unsavedChanges = true;
}

function unmarkUnsavedChanges(){
  unsavedChanges = false;
}

function promptToSave(){
  let popup = document.createElement("div");
  popup.classList.add("popup-dialog");

  var warning = document.createElement('h1');
  warning.innerText = "WARNING:";
  popup.appendChild(warning);

  var subWarning = document.createElement('p');
  subWarning.innerText = 'You have unsaved changes. Would you like to save first?';
  subWarning.classList.add('warning-text');
  popup.appendChild(subWarning);

  var save = createButton("Save");
  save.onclick = function(){
    saveCards(loadedCards, project.directory + project.chapsDirectory);
    project.saveFile();
    unsavedChanges = false;
    closePopups();
  };
  popup.appendChild(save);

  var quit = createButton("Continue Without Saving");
  quit.onclick = function(){
    closePopups();
  };
  popup.appendChild(quit);

  var cancel = createButton("Cancel");
  cancel.onclick = function(){
    removeElementsByClass('popup-dialog');
    focusCard(1);
  };
  popup.appendChild(cancel);

  document.getElementById('corkboard').appendChild(popup);
  save.focus();
}

function showHelp(){
    var popup = document.createElement("div");
    popup.classList.add("popup-dialog", "popup-shortcuts");

    const cmdOrCtrl = isMac ? 'Cmd' : 'Ctrl';

    var shortcuts = [
      {
        title: "Navigation",
        shortcuts: [
          ['Move Between Cards', cmdOrCtrl + ' + Arrows']
        ]
      },
      {
        title: "Alteration",
        shortcuts: [
          ['Move Selected Card', cmdOrCtrl + ' + Shift + Arrows'],
          ['Insert Card', cmdOrCtrl + ' + I'],
          ['Delete Card', cmdOrCtrl + ' + Delete/Backspace'],
          ['Mark Card Finished', cmdOrCtrl + ' + Enter'],
          ['Color Card', cmdOrCtrl + ' + [1-9]'],
          ['Clear Color', cmdOrCtrl + ' + 0']
        ]
      },
      {
        title: "Presentation",
        shortcuts: [
          ['Add Board Divisions', cmdOrCtrl + ' + >'],
          ['Remove Board Divisions', cmdOrCtrl + ' + <']
        ]
      },
      {
        title: "Most Important",
        shortcuts: [
          ['Save Changes', cmdOrCtrl + ' + S'],
          ['Close Corkboard', "Escape"]
        ]
      }
    ];

    shortcuts.forEach(function(short){
      var title = document.createElement('h2');
      title.innerText = short.title;
      popup.appendChild(title);

      var shortcutsTable = document.createElement('table');
      shortcutsTable.classList.add('shortcuts-table');

      short.shortcuts.forEach(function(cut){
        var row = document.createElement('tr');

        var shortLabel = document.createElement('td');
        shortLabel.innerText = cut[0];
        row.appendChild(shortLabel);

        var shortKeys = document.createElement('td');
        shortKeys.innerText = cut[1];
        row.appendChild(shortKeys);

        shortcutsTable.appendChild(row);
      });

      popup.appendChild(shortcutsTable);
    });

    popup.appendChild(document.createElement('br'));

    var closeBtn = createButton("Close");
    closeBtn.onclick = function(){
      removeElementsByClass('popup-dialog');
      focusCard(1);
    };
    popup.appendChild(closeBtn);

    popup.addEventListener('keydown', function(e){
      if(e.key == "Escape"){
        stopDefaultPropagation(e);
        removeElementsByClass('popup-dialog');
        focusCard(1);
      }
    });

    document.body.appendChild(popup);
    closeBtn.focus();
    popup.scrollTop = 0;
}

module.exports = showCorkboard;