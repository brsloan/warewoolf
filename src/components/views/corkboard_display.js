const { closePopups, createButton, removeElementsByClass } = require('../controllers/utils');
const { getCardsFromFile, saveCards } = require('../controllers/corkboard');

/*Controls to add:
- Text size (CTRL + -)
- # of Columns (CTRL < >)
- view all cards ?
- Vert or Horiz sequence
X Add/remove cards
X Rearrange cards
- Change card colors
X Checkmark cards as written
- # cards total and # displayed
- Override escape for this screen and flag unsaved changes
- Override ctrl H for special help screen?
*/

var loadedCards = [];

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
    fillCorkboard(4);
    assignLoadedCards();
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
      }
    }
  }
  
  function fillCorkboard(numCols) {
    var corkboard = document.getElementById("corkboard");
    corkboard.innerHTML = "";
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
  
  function resetCorkboard(){
    fillCorkboard(4);
    assignLoadedCards();
  }
  
  function createCardSpot(num, xcor, ycor) {
    var card = document.createElement("div");
    card.id = "card" + num;
    card.classList.add("corkboard-card");
  
    var label = document.createElement("input");
    label.type = "text";
    label.classList.add("card-label");
    label.id = "card-label" + num;
    label.disabled = true;
  
    card.appendChild(label);
  
    var numLabel = document.createElement("h2");
    numLabel.innerText = num;
    numLabel.classList.add("card-num-label");
    card.appendChild(numLabel);
  
    var descr = document.createElement("textarea");
    descr.classList.add("card-description");
    descr.id = "card-descr" + num;
    descr.disabled = true;
  
    card.appendChild(descr);
    
    card.dataset.index = num - 1;
    card.dataset.xcor = xcor;
    card.dataset.ycor = ycor;
    card.addEventListener('keydown', cardCntrlEvents);
    card.classList.add('corkboard-card-unused');
    
    var checkmark = document.createElement('div');
    checkmark.id = "card-checkmark" + num;
    checkmark.classList.add('card-checkmark');
    card.appendChild(checkmark);
  
    return card;
  }
  
  function cardCntrlEvents(e) {
    if ((e.ctrlKey || e.metaKey)  && e.shiftKey && e.key === "ArrowUp")   {
      stopDefaultPropagation(e);
      moveCardUp(this);
      assignLoadedCards();
      focusCard(parseInt(this.dataset.index));
    }
    else if((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "ArrowDown"){
      stopDefaultPropagation(e);
      moveCardDown(this);
      resetCorkboard();
      focusCard(parseInt(this.dataset.index) + 2);
    }
    else if((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "ArrowRight"){
      stopDefaultPropagation(e);
      var newCardNum = moveCardRight(this);
      assignLoadedCards();
      focusCard(newCardNum);
    }
    else if((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "ArrowLeft"){
      stopDefaultPropagation(e);
      var newCardNum = moveCardLeft(this);
      assignLoadedCards();
      focusCard(newCardNum);
    }
    else if((e.ctrlKey || e.metaKey) && e.key === "ArrowUp"){
      stopDefaultPropagation(e);
      focusCard(parseInt(this.dataset.index));
    }
    else if((e.ctrlKey || e.metaKey) && e.key === "ArrowDown"){
      stopDefaultPropagation(e);
      if(parseInt(this.dataset.index) == loadedCards.length - 1){
        insertBlankCard(parseInt(this.dataset.index) + 2);
        resetCorkboard();
      }
      focusCard(parseInt(this.dataset.index) + 2);
    }
    else if((e.ctrlKey || e.metaKey) && e.key === "ArrowRight"){
      stopDefaultPropagation(e);
      var newCardNum = getRightCardNum(this);
      while(newCardNum > loadedCards.length){
          insertBlankCard(loadedCards.length);
      }
      resetCorkboard();
      focusCard(newCardNum);
    }
      else if((e.ctrlKey || e.metaKey) && e.key === "ArrowLeft"){
      stopDefaultPropagation(e);
      var newCardNum = getLeftCardNum(this);
      focusCard(newCardNum);
    }
      else if((e.ctrlKey || e.metaKey) && e.key === "i"){
        stopDefaultPropagation(e);
        insertBlankCard(parseInt(this.dataset.index));
        resetCorkboard();
        focusCard(parseInt(this.dataset.index) + 1);
    }
      else if((e.ctrlKey || e.metaKey) && (e.key === "Delete" || e.key === "Backspace")){
        stopDefaultPropagation(e);
        var thisIndex = parseInt(this.dataset.index);
        if(loadedCards.length > 1){
          loadedCards.splice(thisIndex, 1);
          resetCorkboard();
          focusCard(thisIndex < loadedCards.length ? thisIndex + 1 : thisIndex);  
        }
    }
    else if((e.ctrlKey || e.metaKey) && (e.key === "Enter")){
      stopDefaultPropagation(e);
      var thisIndex = parseInt(this.dataset.index);
      loadedCards[thisIndex].checked = !loadedCards[thisIndex].checked;
      resetCorkboard();
      focusCard(thisIndex + 1);
    }
    else if((e.ctrlKey || e.metaKey) && (e.key === "s")){
      stopDefaultPropagation(e);
      saveCards(loadedCards, project.directory + project.chapsDirectory);
    }
  }
  
  function stopDefaultPropagation(keyEvent) {
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
  }
  
  function moveCardUp(card){
    if(card.dataset.index && card.dataset.index != '0'){
      var oldCardIndex = parseInt(card.dataset.index);
      var newCardIndex = oldCardIndex - 1;
    
      loadedCards.splice(newCardIndex, 0, loadedCards.splice(oldCardIndex, 1)[0]);
    }
  }
  
  function moveCardDown(card){
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
  
  function getRightCardNum(card){
    if (card.dataset.index){
      var currentXCor = parseInt(card.dataset.xcor);
      var currentYCor = parseInt(card.dataset.ycor);
      var oldCardIndex = parseInt(card.dataset.index);
      var newCardSpace = document.querySelector('[data-xcor="' + (currentXCor + 1) + '"][data-ycor="' + currentYCor + '"]');
    
      //Default to returning current card number in case there is no column to right
      var newCardNumReturn = parseInt(card.dataset.index) + 1;
      
      if(newCardSpace){
        var newCardIndex = parseInt(newCardSpace.dataset.index);
        
        newCardNumReturn = newCardIndex + 1;
      }
      
      return newCardNumReturn;
    }
  }
  
  function getLeftCardNum(card){
    if (card.dataset.index){
      var currentXCor = parseInt(card.dataset.xcor);
      var currentYCor = parseInt(card.dataset.ycor);
      var oldCardIndex = parseInt(card.dataset.index);
      var newCardSpace = document.querySelector('[data-xcor="' + (currentXCor - 1) + '"][data-ycor="' + currentYCor + '"]');
    
      //Default to returning current card number in case there is no column to right
      var newCardNumReturn = parseInt(card.dataset.index) + 1;
      
      if(newCardSpace){
        var newCardIndex = parseInt(newCardSpace.dataset.index);
        
        newCardNumReturn = newCardIndex + 1;
      }
      
      return newCardNumReturn;
    }
  }
  
  function moveCardRight(card){
    if (card.dataset.index){
      var currentXCor = parseInt(card.dataset.xcor);
      var currentYCor = parseInt(card.dataset.ycor);
      var oldCardIndex = parseInt(card.dataset.index);
      var newCardSpace = document.querySelector('[data-xcor="' + (currentXCor + 1) + '"][data-ycor="' + currentYCor + '"]');
      
      //Default to returning current card number in case there is no column to right
      var newCardNumReturn = parseInt(card.dataset.index) + 1;
      
      if(newCardSpace){
        var newCardIndex = parseInt(newCardSpace.dataset.index);
      
        while(newCardIndex > loadedCards.length - 1){
          insertBlankCard(loadedCards.length);
        }
      
        loadedCards.splice(newCardIndex, 0, loadedCards.splice(oldCardIndex, 1)[0]);
        
        newCardNumReturn = newCardIndex + 1;
      }
      
      return newCardNumReturn;
    }
  };
  
  function moveCardLeft(card){
    if (card.dataset.index){
      var currentXCor = parseInt(card.dataset.xcor);
      var currentYCor = parseInt(card.dataset.ycor);
      var oldCardIndex = parseInt(card.dataset.index);
      var newCardSpace = document.querySelector('[data-xcor="' + (currentXCor - 1) + '"][data-ycor="' + currentYCor + '"]');
     
      //Default to returning current card number in case there is no column to left
      var newCardNumReturn = parseInt(card.dataset.index) + 1;
      
      if(newCardSpace){
        var newCardIndex = parseInt(newCardSpace.dataset.index);
      
        loadedCards.splice(newCardIndex, 0, loadedCards.splice(oldCardIndex, 1)[0]);
        
        newCardNumReturn = newCardIndex + 1;
      }
      
      return newCardNumReturn;
    }
  };
  
  function insertBlankCard(ind){
    var blankCard = { label: '', descr: '' };
    
    loadedCards.splice(ind, 0, blankCard);
  }
  
  function focusCard(num){
    if(num > 0){
     var card = document.getElementById("card-label" + num);
     if(card)
       card.focus();
    }
  }


module.exports = showCorkboard;