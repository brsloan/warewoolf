const { closePopups, createButton, removeElementsByClass, generateRow, describeDialog } = require('../controllers/utils');
const { initiateImport } = require('../controllers/import');

function showImportOptions(sysDirectories, addImportedChapter, onFinish){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var popupTitle = document.createElement('h1');
  popupTitle.innerText = 'Import Documents';
  popup.appendChild(popupTitle);
  describeDialog(popup, popupTitle);

  var importForm = document.createElement("form");

  var filetypeSet = document.createElement('fieldset');
  importForm.appendChild(filetypeSet);
  var filetypeLeg = document.createElement('legend');
  filetypeLeg.innerText = 'File Type';
  filetypeSet.appendChild(filetypeLeg);

  var filetypes = [
    { name: 'Docx', id: 'docxSelect', extensions: ['docx']},
    { name: 'Plain Text', id: 'txtSelect', extensions: ['txt'] },
    { name: 'MarkdownFic', id: 'mdfcSelect', extensions: ['mdfc', 'txt', "md"] },
    { name: 'HTML', id: 'htmlSelect', extensions: ['html', 'htm', 'xhtml'] },
    { name: 'EPUB', id: 'epubSelect', extensions: ['epub'] }
  ];

  filetypes.forEach((type, i) => {
    var filetypeSelect = document.createElement('input');
    filetypeSelect.type = 'radio';
    filetypeSelect.name = 'typeSelect';
    filetypeSelect.value = i;
    filetypeSelect.id = type.id;
    filetypeSet.appendChild(filetypeSelect);

    var typeLabel = document.createElement('label');
    typeLabel.htmlFor = filetypeSelect.id;
    typeLabel.innerText = type.name;
    filetypeSet.appendChild(typeLabel);
  });

  var plainTextOptionsSet = document.createElement('fieldset');

  var plainTextOptionsLabel = document.createElement('legend');
  plainTextOptionsLabel.innerText = 'Plaintext Options';
  plainTextOptionsSet.appendChild(plainTextOptionsLabel);

  var opsTable = document.createElement('table');

  var convertItalicsLabel = document.createElement("label");
  convertItalicsLabel.innerText = "Convert marked italics: ";
  convertItalicsLabel.htmlFor = "convert-italics-check";

  var convertItalicsCheck = document.createElement("input");
  convertItalicsCheck.type = "checkbox";
  convertItalicsCheck.id = "convert-italics-check";
  convertItalicsCheck.checked = true;

  opsTable.appendChild(generateRow(convertItalicsLabel, convertItalicsCheck));

  var italicsStrLabel = document.createElement("label");
  italicsStrLabel.innerText = "Marker character: ";
  italicsStrLabel.htmlFor = "italics-str-input";
  italicsStrLabel.classList.add('sublabel');

  var italicsStrInput = document.createElement("input");
  italicsStrInput.type = "text";
  italicsStrInput.value = "*";
  italicsStrInput.id = "italics-str-input";
  italicsStrInput.classList.add('sublabel');

  opsTable.appendChild(generateRow(italicsStrLabel, italicsStrInput));

  var convertTabsLabel = document.createElement("label");
  convertTabsLabel.innerText = "Convert marked tabs: ";
  convertTabsLabel.htmlFor = "convert-tabs-check";

  var convertTabsCheck = document.createElement("input");
  convertTabsCheck.type = "checkbox";
  convertTabsCheck.id = "convert-tabs-check";
  convertTabsCheck.checked = true;

  opsTable.appendChild(generateRow(convertTabsLabel, convertTabsCheck));

  var tabsStrLabel = document.createElement("label");
  tabsStrLabel.innerText = "Tab string (default 4 spaces): ";
  tabsStrLabel.htmlFor = "tabs-str-input";
  tabsStrLabel.classList.add('sublabel');

  var tabsStrInput = document.createElement("input");
  tabsStrInput.type = "text";
  tabsStrInput.value = "    ";
  tabsStrInput.id = "tabs-str-input";
  tabsStrInput.classList.add('sublabel');

  opsTable.appendChild(generateRow(tabsStrLabel, tabsStrInput));

  var splitChapsLabel = document.createElement("label");
  splitChapsLabel.innerText = "Split Into Chapters: ";
  splitChapsLabel.htmlFor = "split-chaps-check";

  var splitChapsCheck = document.createElement("input");
  splitChapsCheck.type = "checkbox";
  splitChapsCheck.id = "split-chaps-check";
  splitChapsCheck.checked = true;

  opsTable.appendChild(generateRow(splitChapsLabel, splitChapsCheck));

  var chapsStrLabel = document.createElement("label");
  chapsStrLabel.innerText = "Chapter Split Marker: ";
  chapsStrLabel.htmlFor = "chaps-str-input";
  chapsStrLabel.classList.add('sublabel');

  var chapsStrInput = document.createElement("input");
  chapsStrInput.type = "text";
  chapsStrInput.value = "<ch>";
  chapsStrInput.id = "chaps-str-input";
  chapsStrInput.classList.add('sublabel');

  opsTable.appendChild(generateRow(chapsStrLabel, chapsStrInput));

  var convertFirstLinesLabel = document.createElement("label");
  convertFirstLinesLabel.innerText = "Convert First Lines To Titles: ";
  convertFirstLinesLabel.htmlFor = "convert-first-lines-check";

  var convertFirstLinesCheck = document.createElement("input");
  convertFirstLinesCheck.type = "checkbox";
  convertFirstLinesCheck.id = "convert-first-lines-check";
  convertFirstLinesCheck.checked = true;

  opsTable.appendChild(generateRow(convertFirstLinesLabel, convertFirstLinesCheck));
  plainTextOptionsSet.appendChild(opsTable);
  importForm.appendChild(plainTextOptionsSet);

  var docxOptionsSet = document.createElement('fieldset');

  var docxOptionsLabel = document.createElement('legend');
  docxOptionsLabel.innerText = 'Docx Options';
  docxOptionsSet.appendChild(docxOptionsLabel);

  var docxOpsTable = document.createElement('table');

  var docxSplitChapsLabel = document.createElement("label");
  docxSplitChapsLabel.innerText = "Split Into Chapters At Headings (Lvl 1): ";
  docxSplitChapsLabel.htmlFor = "docx-split-chaps-check";

  var docxSplitChapsCheck = document.createElement("input");
  docxSplitChapsCheck.type = "checkbox";
  docxSplitChapsCheck.id = "docx-split-chaps-check";
  docxSplitChapsCheck.checked = true;

  docxOpsTable.appendChild(generateRow(docxSplitChapsLabel, docxSplitChapsCheck));
  docxOptionsSet.appendChild(docxOpsTable);
  importForm.appendChild(docxOptionsSet);

  var htmlOptionsSet = document.createElement('fieldset');

  var htmlOptionsLabel = document.createElement('legend');
  htmlOptionsLabel.innerText = 'HTML Options';
  htmlOptionsSet.appendChild(htmlOptionsLabel);

  var htmlOpsTable = document.createElement('table');

  var htmlSplitChapsLabel = document.createElement("label");
  htmlSplitChapsLabel.innerText = "Split Into Chapters At Headings: ";
  htmlSplitChapsLabel.htmlFor = "html-split-chaps-check";

  var htmlSplitChapsCheck = document.createElement("input");
  htmlSplitChapsCheck.type = "checkbox";
  htmlSplitChapsCheck.id = "html-split-chaps-check";
  htmlSplitChapsCheck.checked = true;

  htmlOpsTable.appendChild(generateRow(htmlSplitChapsLabel, htmlSplitChapsCheck));

  var htmlHeadingLevelLabel = document.createElement("label");
  htmlHeadingLevelLabel.innerText = "Heading level: ";
  htmlHeadingLevelLabel.htmlFor = "html-heading-level-select";
  htmlHeadingLevelLabel.classList.add('sublabel');

  //A level selector rather than the docx importer's fixed level 1, because an HTML book puts its
  //title in <h1> and its chapter titles in <h2> - every one of the sample books in
  //test/fixtures/books does - so a fixed level 1 would import the whole book as one chapter.
  var htmlHeadingLevelSelect = document.createElement("select");
  htmlHeadingLevelSelect.id = "html-heading-level-select";
  htmlHeadingLevelSelect.classList.add('sublabel');
  ["1", "2", "3", "4"].forEach(function(level){
    var levelOption = document.createElement("option");
    levelOption.value = level;
    levelOption.innerText = level;
    htmlHeadingLevelSelect.appendChild(levelOption);
  });
  htmlHeadingLevelSelect.value = "2";

  htmlOpsTable.appendChild(generateRow(htmlHeadingLevelLabel, htmlHeadingLevelSelect));

  var htmlSplitRulesLabel = document.createElement("label");
  htmlSplitRulesLabel.innerText = "Split At Horizontal Rules: ";
  htmlSplitRulesLabel.htmlFor = "html-split-rules-check";

  var htmlSplitRulesCheck = document.createElement("input");
  htmlSplitRulesCheck.type = "checkbox";
  htmlSplitRulesCheck.id = "html-split-rules-check";

  htmlOpsTable.appendChild(generateRow(htmlSplitRulesLabel, htmlSplitRulesCheck));

  var htmlStripBoilerplateLabel = document.createElement("label");
  htmlStripBoilerplateLabel.innerText = "Strip Project Gutenberg Boilerplate: ";
  htmlStripBoilerplateLabel.htmlFor = "html-strip-boilerplate-check";

  var htmlStripBoilerplateCheck = document.createElement("input");
  htmlStripBoilerplateCheck.type = "checkbox";
  htmlStripBoilerplateCheck.id = "html-strip-boilerplate-check";

  htmlOpsTable.appendChild(generateRow(htmlStripBoilerplateLabel, htmlStripBoilerplateCheck));
  htmlOptionsSet.appendChild(htmlOpsTable);
  importForm.appendChild(htmlOptionsSet);

  //An epub needs no split options at all: its own table of contents says where the chapters are and
  //what they are called, which is better than anything this dialog could ask for. See the note on
  //the spine in epub-import.js.
  var epubOptionsSet = document.createElement('fieldset');

  var epubOptionsLabel = document.createElement('legend');
  epubOptionsLabel.innerText = 'EPUB Options';
  epubOptionsSet.appendChild(epubOptionsLabel);

  var epubOpsTable = document.createElement('table');

  var epubStripBoilerplateLabel = document.createElement("label");
  epubStripBoilerplateLabel.innerText = "Strip Project Gutenberg Boilerplate: ";
  epubStripBoilerplateLabel.htmlFor = "epub-strip-boilerplate-check";

  var epubStripBoilerplateCheck = document.createElement("input");
  epubStripBoilerplateCheck.type = "checkbox";
  epubStripBoilerplateCheck.id = "epub-strip-boilerplate-check";

  epubOpsTable.appendChild(generateRow(epubStripBoilerplateLabel, epubStripBoilerplateCheck));

  var epubUseMetadataLabel = document.createElement("label");
  epubUseMetadataLabel.innerText = "Use Book's Title And Author (if blank): ";
  epubUseMetadataLabel.htmlFor = "epub-use-metadata-check";

  var epubUseMetadataCheck = document.createElement("input");
  epubUseMetadataCheck.type = "checkbox";
  epubUseMetadataCheck.id = "epub-use-metadata-check";
  epubUseMetadataCheck.checked = true;

  epubOpsTable.appendChild(generateRow(epubUseMetadataLabel, epubUseMetadataCheck));
  epubOptionsSet.appendChild(epubOpsTable);
  importForm.appendChild(epubOptionsSet);

  importForm.appendChild(document.createElement('br'));

  var chapLabelSet = document.createElement('fieldset');
  var chapLabelLegend = document.createElement('legend');
  chapLabelLegend.innerText = 'Chapter Label Options';
  chapLabelSet.appendChild(chapLabelLegend);

  var chapLabelFilename = document.createElement('input');
  chapLabelFilename.type = 'radio';
  chapLabelFilename.name = 'chapLabelSelect';
  chapLabelFilename.value = 'filename';
  chapLabelFilename.id = 'chapLabelFilename';
  chapLabelSet.appendChild(chapLabelFilename);

  var chapLabelFilenameLabel = document.createElement('label');
  chapLabelFilenameLabel.htmlFor = 'chapLabelFilename';
  chapLabelFilenameLabel.innerText = 'Filename';
  chapLabelSet.appendChild(chapLabelFilenameLabel);

  var chapLabelFirstLine = document.createElement('input');
  chapLabelFirstLine.type = 'radio';
  chapLabelFirstLine.name = 'chapLabelSelect';
  chapLabelFirstLine.value = 'firstLine';
  chapLabelFirstLine.id = 'chapLabelFirstLine';
  chapLabelFirstLine.checked = true;
  chapLabelSet.appendChild(chapLabelFirstLine);

  var chapLabelFirstLineLabel = document.createElement('label');
  chapLabelFirstLineLabel.htmlFor = 'chapLabelFirstLine';
  chapLabelFirstLineLabel.innerText = 'First line';
  chapLabelSet.appendChild(chapLabelFirstLineLabel);

  importForm.appendChild(chapLabelSet);
  

  importForm.appendChild(document.createElement('br'));

  var importBtn = document.createElement("input");
  importBtn.type = "submit";
  importBtn.value = "Import";
  importForm.appendChild(importBtn);

  var cancelBtn = createButton("Cancel");
  cancelBtn.onclick = function(){
    closePopups();
  };
  importForm.appendChild(cancelBtn);

  importForm.onsubmit = function(e){
    e.preventDefault();
    const selectedChapLabel = document.querySelector('input[name="chapLabelSelect"]:checked').value;
    var importOptions = {
      fileType: filetypes[document.querySelector('input[name="typeSelect"]:checked').value]
    };
    importOptions.txtOptions = {
      convertFirstLines: convertFirstLinesCheck.checked,
      convertItalics: {
        convert: convertItalicsCheck.checked,
        marker: italicsStrInput.value
      },
      convertTabs: {
        convert: convertTabsCheck.checked,
        marker: tabsStrInput.value
      },
      splitChapters: {
        split: splitChapsCheck.checked,
        marker: chapsStrInput.value
      },
      chapLabels: selectedChapLabel
    };

    importOptions.docxOptions = {
      splitChapters: docxSplitChapsCheck.checked,
      chapLabels: selectedChapLabel
    };

    importOptions.htmlOptions = {
      splitChapters: {
        //Null rather than the selected level when the box is unticked - that is what tells the
        //converter not to split at headings at all, and it leaves splitting at rules free to be
        //chosen on its own.
        headingLevel: htmlSplitChapsCheck.checked ? parseInt(htmlHeadingLevelSelect.value, 10) : null,
        atRules: htmlSplitRulesCheck.checked
      },
      stripBoilerplate: htmlStripBoilerplateCheck.checked,
      chapLabels: selectedChapLabel
    };

    importOptions.epubOptions = {
      stripBoilerplate: epubStripBoilerplateCheck.checked,
      useMetadata: epubUseMetadataCheck.checked,
      chapLabels: selectedChapLabel
    };

    importOptions.mdfcOptions = {
      chapLabels: selectedChapLabel
    };

    closePopups();
    initiateImport(sysDirectories, importOptions, addImportedChapter, onFinish);
  };

  popup.appendChild(importForm);
  document.body.appendChild(popup);

  var docxSelect = document.getElementById('docxSelect');
  docxSelect.checked = true;
  plainTextOptionsSet.disabled = true;
  docxOptionsSet.disabled = false;
  htmlOptionsSet.disabled = true;
  epubOptionsSet.disabled = true;

  var textSelect = document.getElementById('txtSelect');
  var htmlSelect = document.getElementById('htmlSelect');
  var epubSelect = document.getElementById('epubSelect');
  importForm.onchange = function(){
    plainTextOptionsSet.disabled = !textSelect.checked;
    docxOptionsSet.disabled = !docxSelect.checked;
    htmlOptionsSet.disabled = !htmlSelect.checked;
    epubOptionsSet.disabled = !epubSelect.checked;
  };

  importBtn.focus();
}

module.exports = showImportOptions;