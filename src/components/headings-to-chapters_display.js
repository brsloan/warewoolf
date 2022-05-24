function showBreakHeadingsOptions(){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");
  var breakHeadingsForm = document.createElement("form");

  var headingLevelLabel = document.createElement("label");
  headingLevelLabel.innerText = "Heading Level: ";
  headingLevelLabel.for = "heading-level-select";
  breakHeadingsForm.appendChild(headingLevelLabel);

  var headingSelect = document.createElement("select");
  const headingOptions = ["1", "2", "3", "4"];
  headingOptions.forEach(function(op){
    var hdOp = document.createElement("option");
    hdOp.value = op;
    hdOp.innerText = op;
    headingSelect.appendChild(hdOp);
  });
  breakHeadingsForm.appendChild(headingSelect);

  breakHeadingsForm.appendChild(document.createElement('br'));

  var breakHeadingsBtn = document.createElement("input");
  breakHeadingsBtn.type = "submit";
  breakHeadingsBtn.value = "Break Into Chapters";
  breakHeadingsForm.appendChild(breakHeadingsBtn);

  var cancelBtn = createButton("Cancel");
  cancelBtn.onclick = function(){
    closePopups();
  };
  breakHeadingsForm.appendChild(cancelBtn);

  breakHeadingsForm.onsubmit = function(){
    breakHeadingsIntoChapters(headingSelect.value);
    closePopups();
  };

  popup.appendChild(breakHeadingsForm);
  document.body.appendChild(popup);
}
