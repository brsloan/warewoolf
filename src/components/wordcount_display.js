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
  
    var closeBtn = createButton("Close");
    closeBtn.onclick = function(){
      popup.remove();
    };
    popup.appendChild(closeBtn);
  
    document.body.appendChild(popup);
  
    var activeTotal = countWords(editorQuill.getText());
  
    var total = 0;
    project.chapters.forEach(function(chap){
        var text = convertToPlainText(chap.contents ? chap.contents : chap.getFile());
        total += countWords(text);
    });
  
    chapTotalDisplay.innerText = "Chapter Word Count: " + activeTotal;
    totalDisplay.innerText = "Total Word Count: " + total;
    closeBtn.focus();
  };