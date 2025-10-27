/* This module uses global objects Quill, Project, from render.js. Not best practice, I know, but if they're there... */
/* This module also horrifically abuses QuillJS in ways it was never meant to have been used, because the usual ways are
just too slow (2-5 seconds to load a full screenplay). You aren't supposed to directly insert HTML like I do here, so things
get...wonky. Plan to eventually replace Quill with my own editor object. */

const { ipcRenderer } = require('electron'); //Not technically necessary since it has access through global const in render.js

var screenplayQuill = setupQuill();

function showScreenplayEditor(){
  hideFictionEditor();
  unhideScreenplayEditor();
  restyleSceneList();
  project.activeChapterIndex = 0;

  screenplayQuill.root.innerHTML = project.chapters[0].getContentsOrFile();
  screenplayQuill.update(); //Since we're adding html manually, have to update Quill manually or settimeout for html updates
  project.hasUnsavedChanges = false; //Correct for initial insert setting off onchange event and marking unsaved changes
  screenplayQuill.setSelection(project.textCursorPosition);
  screenplayQuill.focus();
  
  requestIdleCallback(updateSceneList);
  requestIdleCallback(setWordCountOnLoad);

  updateIPCBindings();
}

function setupQuill(){
    addScreenplayFormats();
    var editorDivName = createEditorDiv();
    var screenplayQuill = generateScreenplayQuill(editorDivName);
    addBindingsToScreenplayQuill(screenplayQuill);
    screenplayQuill.root.classList.add('ql-editor-screenplay');
    screenplayQuill.root.id = 'screenplay-editor';
    return screenplayQuill;
}

function createEditorDiv(){
    const screenplayEditorDivName = 'editor-container-screenplay';

    var screenplayEditorDiv = document.createElement('div');
    screenplayEditorDiv.id = screenplayEditorDivName;
    var writingFieldDiv = document.getElementById('writing-field');
    writingFieldDiv.appendChild(screenplayEditorDiv);   

    return screenplayEditorDivName;
}

function hideFictionEditor(){
  var fictionEditorDiv = document.getElementById('editor-container');
  fictionEditorDiv.classList.add('hidden');
}

function unhideScreenplayEditor(){
  var screenplayEditorContainer = document.getElementById('editor-container-screenplay');
  screenplayEditorContainer.classList.remove('hidden');
}

function restyleSceneList(){
  document.getElementById('chapter-list-sidebar').classList.add('sidebar-screenplay');
}

function addScreenplayFormats(){
  const Block = Quill.import('blots/block');

  class CharacterBlock extends Block {}
  CharacterBlock.blotName = 'character-cue'; 
  CharacterBlock.tagName = 'p'; 
  CharacterBlock.className = 'character-cue'; 
  Quill.register(CharacterBlock, true);

  class SceneBlock extends Block {}
  SceneBlock.blotName = 'scene-header'; 
  SceneBlock.tagName = 'p'; 
  SceneBlock.className = 'scene-header';
  Quill.register(SceneBlock, true);

  class ActionBlock extends Block {}
  ActionBlock.blotName = 'action-block'; 
  ActionBlock.tagName = 'p'; 
  ActionBlock.className = 'action-block'; 
  Quill.register(ActionBlock, true);

  class DialogBlock extends Block {}
  DialogBlock.blotName = 'dialog-block';
  DialogBlock.tagName = 'p';
  DialogBlock.className = 'dialog-block';
  Quill.register(DialogBlock, true);

  class ParentheticalBlock extends Block {}
  ParentheticalBlock.blotName = 'parenthetical-block';
  ParentheticalBlock.tagName = 'p';
  ParentheticalBlock.className = 'parenthetical-block';
  Quill.register(ParentheticalBlock, true);

  class TransitionBlock extends Block {}
  TransitionBlock.blotName = 'transition-block';
  TransitionBlock.tagName = 'p';
  TransitionBlock.className = 'transition-block';
  Quill.register(TransitionBlock, true);
}

function generateScreenplayQuill(editorDivName){
  return new Quill('#' + editorDivName, {
    modules: {
      history: {
        userOnly: true
      },
      keyboard: {
        bindings: getInitialBindings()
      }
    },
    placeholder: '',
    formats: ['bold', 
              'italic', 
              'underline', 
              'align', 
              'character-cue', 
              'scene-header', 
              'action-block', 
              'dialog-block', 
              'parenthetical-block', 
              'transition-block']
  });
}

function updateSceneList(){
  var list = document.getElementById("chapter-list");
  clearDiv(list);

  document.getElementById('chapters-header').innerText = project.hasUnsavedChanges ? 'Scenes*' : 'Scenes';

  var scenes = document.getElementsByClassName('scene-header');
  for(let i=0;i<scenes.length;i++){
    var scene = document.createElement('li');
    scene.innerText = scenes[i].innerText.toLowerCase();
    list.appendChild(scene);
  }

}

function clearDiv(d){
  while (d.hasChildNodes()) {
    try{
      d.removeChild(d.firstChild);
    }
    catch(err){
      //console.log(err);
    }
  }
}

function getScreenplayQuillText(){
  var screenplayEditor = document.getElementById('screenplay-editor');

  var text = '';

  var elements = screenplayEditor.children;

  for(let i=0;i<elements.length;i++){
    text += elements[i].innerText + '\n';
  }
  
  return text;
}

function estimatePageLength(){
  //Since screenplays have a very rigid page layout with monospace text,
  //we should be able to estimate page length fairly accurately based on some averages.
  const linesPerParenthetical = 1;
  const linesPerTransition = 2; //1 text, 1 blank
  const linesPerCharacterCue = 1;
  const linesPerScene = 3; //1 text, 1 blank below, 1 blank above
  const page = {
    lines: 53,
    charsPerLine: 60
  };
  const action = {
    blankLinesPerInstance: 1,
    charsPerLine: page.charsPerLine
  };
  const dialog = {
    blankLinesPerInstance: 1,
    charsPerLine: 37
  };

  var acts = document.getElementsByClassName('action-block');
  var scenes = document.getElementsByClassName('scene-header');
  var cues = document.getElementsByClassName('character-cue');
  var dias = document.getElementsByClassName('dialog-block');
  var trans = document.getElementsByClassName('transition-block');
  var pars = document.getElementsByClassName('parenthetical-block');

  //Start with easy ones that only take one line for text, so are predictable
  var linesFilled = (pars.length * linesPerParenthetical) + (trans.length * linesPerTransition) + 
                    (cues.length * linesPerCharacterCue) + (scenes.length * linesPerScene); 

  //Now add for Action lines and dialog lines
  for(let i=0;i<acts.length;i++){
    linesFilled += action.blankLinesPerInstance;
    linesFilled += Math.ceil(acts[i].innerText.length / action.charsPerLine);
  }
  for(let i=0; i<dias.length;i++){
    linesFilled += dialog.blankLinesPerInstance;
    linesFilled += Math.ceil(dias[i].innerText.length / dialog.charsPerLine);
  }

  const pagesFilledDecimal = linesFilled / page.lines;
  const roundedUp = Math.ceil(pagesFilledDecimal);
  const roundedDown = Math.floor(pagesFilledDecimal);

  var pagesFilled = {
    rounded: roundedUp,
    eighths:  roundedDown + ' ' + Math.round((pagesFilledDecimal - roundedDown) * 8) + '/8'
  };

  return pagesFilled;
}

function setWordCountOnLoad(){
  const { countWords } = require('../controllers/wordcount');
  project.wordCountOnLoad = countWords(screenplayQuill.getText());
}

function moveSceneDown(range, context){
  const thisLine = screenplayQuill.getLine(range.index, 1);
  
  //Current selection could be anywhere within a scene, so first cycle back
  //through lines until we find the index of the header for this scene...
  var currentSceneHeaderIndex = -1;
  //(Unless we are already on a scene header, in which case we skip this step and use this line's index)
  if(thisLine[0].statics.blotName == 'scene-header'){
    currentSceneHeaderIndex = range.index - context.offset;
  }
  var prevLine = thisLine[0].prev;
  while(currentSceneHeaderIndex == -1){
    var prevLineType =  prevLine ? prevLine.statics.blotName : null;
    if(prevLineType == null)
      currentSceneHeaderIndex = 0;
    else if(prevLineType == 'scene-header'){
      currentSceneHeaderIndex = prevLine.offset(thisLine);
    }
    else
      prevLine = prevLine.prev;
  }

  //Finding the next scene header index gives us the lower boundary of the current scene
  var nextSceneIndex = 0;
  var nextLine = thisLine[0].next;
  while(nextSceneIndex == 0){
    let nextLineType =  nextLine ? nextLine.statics.blotName : null;
    if(nextLineType == null)
      nextSceneIndex = -1;
    else if(nextLineType == 'scene-header'){
      nextSceneIndex = nextLine.offset(thisLine);
    }
    else
      nextLine = nextLine.next;
  }

  if(nextLine){//Only continue if this scene isn't already at the end of the document

  //We need to find the third scene index in order to find our insertion point. 
  //Nextline should still be on the second scene line, so continue from there...
    var insertIndex = 0;
    nextLine = nextLine.next;
    while(insertIndex == 0){
      let nextLineType =  nextLine ? nextLine.statics.blotName : null;
      if(nextLineType == null){
        insertIndex = -1; //Flag that we are inserting at the end of the document
      }
      else if(nextLineType == 'scene-header'){
        insertIndex = nextLine.offset(thisLine);
      }
      else
      nextLine = nextLine.next;
    }

  //Nextline should now be set to the scene header just after our new insertion point, 
  //so we can just insert our lines before it
    var sceneLength = nextSceneIndex - currentSceneHeaderIndex;
    var linesToMove = screenplayQuill.getLines(currentSceneHeaderIndex, sceneLength);

    if(insertIndex > -1)
      linesToMove.forEach(function(line){
        nextLine.domNode.before(line.domNode); 
      });
    else{//If moving to end of document...
      var endOfDocIndex = screenplayQuill.getLength();
      insertIndex = endOfDocIndex;
      var lastLine = screenplayQuill.getLine(endOfDocIndex, 0)[0];
      linesToMove.reverse();
      linesToMove.forEach(function(line){
        lastLine.domNode.after(line.domNode); 
      });
    }

    var selectionPoint = range.index + (insertIndex - nextSceneIndex);   
    screenplayQuill.update();
    screenplayQuill.setSelection(selectionPoint);
  }

}

function moveSceneUp(range, context){
  const thisLine = screenplayQuill.getLine(range.index, 1);
  
  //Current selection could be anywhere within a scene, so first cycle back
  //through lines until we find the index of the header for this scene...
  var currentSceneHeaderIndex = -1;
  //(Unless we are already on a scene header, in which case we skip this step and use this line's index)
  if(thisLine[0].statics.blotName == 'scene-header'){
    currentSceneHeaderIndex = range.index - context.offset;
  }
  var prevLine = thisLine[0].prev;
  while(currentSceneHeaderIndex == -1){
    let prevLineType =  prevLine ? prevLine.statics.blotName : null;
    if(prevLineType == null)
      currentSceneHeaderIndex = 0;
    else if(prevLineType == 'scene-header'){
      currentSceneHeaderIndex = prevLine.offset(thisLine);
    }
    else
      prevLine = prevLine.prev;
  }

  //Finding the next scene header index gives us the lower boundary of the current scene
  var nextSceneIndex = 0;
  var nextLine = thisLine[0].next;
  while(nextSceneIndex == 0){
    let nextLineType =  nextLine ? nextLine.statics.blotName : null;
    if(nextLineType == null)
      nextSceneIndex = -1;
    else if(nextLineType == 'scene-header'){
      nextSceneIndex = nextLine.offset(thisLine);
    }
    else
      nextLine = nextLine.next;
  }

//We need to find the scene index before ours in order to find our insertion point. 
//PRevline could be above our scene line or at it, depending on where the inital index was, so...
 // if(prevLine != thisLine[0].prev) //If we started on our header line, this is the line before it, and we're good to start with it
    prevLine = prevLine.prev; //But if we didn't, then it will be set to our header, and we need to move up a line to start
  var insertIndex = -1;
  while(insertIndex == -1){
    let prevLineType =  prevLine ? prevLine.statics.blotName : null;
    if(prevLineType == null){ //If null, insert at beginning of document
      insertIndex = 0;
      prevLine = screenplayQuill.getLine(0,1)[0];
    }
    else if(prevLineType == 'scene-header'){
      insertIndex = prevLine.offset(thisLine);
    }
    else
    prevLine = prevLine.prev;
  }

  //Nextline should now be set to the scene header just after our new insertion point, 
  //so we can just insert our lines before it
  if(insertIndex > -1 && currentSceneHeaderIndex > 0){
    var sceneLength = nextSceneIndex - currentSceneHeaderIndex;
    var linesToMove = screenplayQuill.getLines(currentSceneHeaderIndex, sceneLength);

    linesToMove.forEach(function(line){
      prevLine.domNode.before(line.domNode); 
    })

    var selectionPoint = range.index - (currentSceneHeaderIndex - insertIndex);   
    screenplayQuill.update();
    screenplayQuill.setSelection(selectionPoint);
  }

}

/* ~~~~~~~~~~~~~~ Event Handlers / Key Bindings ~~~~~~~~~~~~~ */

function getInitialBindings(){
  /* With Quill, some special bindings (enter, backspace, tab) have to be set at time of initializiation if
  you want to customize behavior *before* default behavior. For Enter, some of my customizations can be run
  after default, so not all are here */
  return {
    backspace: {
      key: 'backspace',
      handler:function(range, context){
        var useDefaultBackspace = true;

        //If backspacing at beginning of paragraph to combine with previous,
        //take the previous paragraph's style (default is opposite for custom block types for some reason)
        if(context.offset == 0 && range.length < 1){
          useDefaultBackspace = false;
          const thisLine = this.quill.getLine(range.index, 1);
          const prevLineType = thisLine[0].prev ? thisLine[0].prev.statics.blotName : null;

          this.quill.deleteText(range.index - 1, 1, 'user');
          if(prevLineType)
            this.quill.format(prevLineType, 'true');
        }
        
          return useDefaultBackspace;
      }
    },
    tab: {
      key: 'tab',
      handler:function(range, context){
        const atEndOfBlock = context.suffix == '';
        const isEmptyLine = context.empty;
        const thisLine = this.quill.getLine(range.index, 1);
        const thisLineType = thisLine[0].statics.blotName;
        const nextLineType = thisLine[0].next ? thisLine[0].next.statics.blotName : null;

        if(atEndOfBlock){
          if(thisLineType == 'action-block' && isEmptyLine)
            this.quill.format('character-cue', true, 'user');
          else if(thisLineType == 'character-cue' && !isEmptyLine){
            this.quill.insertText(range.index + 1, '()\n', 'parenthetical-block', true, 'user');
            this.quill.setSelection(range.index + 2, 'user');
          }
          else if(thisLineType == 'dialog-block'){
            if(isEmptyLine){
              this.quill.format('parenthetical-block', true, 'user');
              this.quill.insertText(range.index, '()', 'user');
              this.quill.setSelection(range.index + 1, 'user');
            }
            else{
              this.quill.insertText(range.index + 1, '()\n', 'parenthetical-block', true, 'user');
              this.quill.setSelection(range.index + 2, 'user');
            }
          }
          else if(thisLineType == 'scene-header' && isEmptyLine){
            const sceneAutofill = 'INT. ';
            this.quill.insertText(range.index, sceneAutofill, 'user');
            this.quill.setSelection(range.index + sceneAutofill.length, 'user');
          }
        }
        else if(thisLineType == 'parenthetical-block'){
          if(nextLineType != 'dialog-block')
            this.quill.insertText(range.index + context.suffix.length + 1, '\n', 'dialog-block', true, 'user');
          this.quill.setSelection(range.index + context.suffix.length + 1, 'user');
        }
        return false;
      }
    },
    enter: {
      key: 'Enter',
      handler:function(range, context){
        var useDefaultEnter = true;
        const thisLine = this.quill.getLine(range.index, 1);

        const thisLineType = thisLine[0].statics.blotName;
        const nextLineType = thisLine[0].next ? thisLine[0].next.statics.blotName : null;

        if(thisLineType == 'parenthetical-block' && context.offset > 0 && context.suffix.length > 0){
          useDefaultEnter = false;
          if(nextLineType != 'dialog-block')
            this.quill.insertText(range.index + context.suffix.length + 1, '\n', 'dialog-block', true, 'user');
          this.quill.setSelection(range.index + context.suffix.length + 1, 'user');
        }
        
        return useDefaultEnter;
      }
    }
  }
}

function addBindingsToScreenplayQuill(q){
  q.keyboard.addBinding({
    key: '1',
    shortKey: true,
    handler: function(range, context) {

      console.log('current index: ' + range.index);
    }
  });

  q.keyboard.addBinding({
    key: 'L',
    shortKey: true,
    handler: function(range, context) {
      this.quill.format('align', null, 'user');
    }
  });

  q.keyboard.addBinding({
    key: 'E',
    shortKey: true,
    handler: function(range, context) {
      this.quill.format('align', 'center', 'user');
    }
  });

  q.keyboard.addBinding({
    key: 'R',
    shortKey: true,
    handler: function(range, context) {
      this.quill.format('align', 'right', 'user');
    }
  });

  q.keyboard.addBinding({
    key: 'Down',
    shortKey: true,
    handler: function(range, context) {
      moveSceneDown(range, context);
      requestIdleCallback(updateSceneList);
    }
  });

  q.keyboard.addBinding({
    key: 'Up',
    shortKey: true,
    handler: function(range, context) {
      moveSceneUp(range, context);
      requestIdleCallback(updateSceneList);
    }
  });

  q.on('text-change', function(delta, oldDelta, source) {
    if(source == "user"){
      var chap = project.chapters[0];
      chap.contents = q.root.innerHTML;
      chap.hasUnsavedChanges = true;
      project.hasUnsavedChanges = true;
    }
  });

  q.on('selection-change', function(range, oldRange, source){
    if(range)
      project.textCursorPosition = range.index;
  });

  q.root.addEventListener('keydown', function(e){
    //Quill doesn't like adding bindings to Enter after initialization, so we go around it with manual event listeners
    if(e.key == "Enter"){
      const selectionIndex = q.getSelection().index;
      const thisLine = q.getLine(selectionIndex, 1);
      const previousLineType = thisLine[0].prev ? thisLine[0].prev.statics.blotName : null;
      const enteringNewPara = thisLine[0].cache && thisLine[0].cache.length == 1;
      const enterWasPressedAtBeginningOfBlock = thisLine[0].prev && thisLine[0].prev.cache.length == 1;

      switch(previousLineType){
        case 'scene-header':
          if(enterWasPressedAtBeginningOfBlock) //Entire block was moved down, so style newly created empty line as default (action) line type
            q.formatText(selectionIndex - 1, 1, 'action-block', true, 'user');
          else
            q.format('action-block', true, 'user');
          break;
        case 'action-block':
          //If action line just terminated is formatted as a scene header or transition, format it as such
          const previousLineText = thisLine[0].prev.cache.delta.ops[0].insert;
          let styleToConvertPrevious = checkForFormatMatch(previousLineText);
          if(styleToConvertPrevious)
            q.formatText(selectionIndex - 1, 1, styleToConvertPrevious, true, 'user');
          if(styleToConvertPrevious == 'transition-block')
            q.format('scene-header', true, 'user');
          break;
        case 'character-cue':
          if(enterWasPressedAtBeginningOfBlock)
            q.formatText(selectionIndex - 1, 1, 'action-block', true, 'user');
          else
            q.format('dialog-block', true, 'user');
          break;
        case 'dialog-block':
          if(enteringNewPara)
            q.format('action-block', true, 'user');
          break;
        case 'parenthetical-block':
          if(enterWasPressedAtBeginningOfBlock)
            q.formatText(selectionIndex - 1, 1, 'dialog-block', true, 'user');
          else
            q.format('dialog-block', true, 'user');
          break;
        case 'transition-block':
          if(enterWasPressedAtBeginningOfBlock)
            q.formatText(selectionIndex - 1, 1, 'action-block', true, 'user');
          else
            q.format('scene-header', true, 'user');
          break;
        default:

      }
      requestIdleCallback(updateSceneList);
    }
    else if(e.key === 'Backspace'){
      requestIdleCallback(updateSceneList);
    }
  });
};

function checkForFormatMatch(str){
  let sceneHeader = /(?<=\n|^)(([iI][nN][tT]|[eE][xX][tT]|[^\w][eE][sS][tT]|[iI]\.?\/[eE]\.?)([.\s][^\n]+))/g;
  let transition = /^(([^<>\na-z]*TO:|FADE TO BLACK\.|FADE OUT\.|CUT TO BLACK\.))/g;
  let format = null;
  if(sceneHeader.test(str))
    format = 'scene-header';
  else if(transition.test(str))
    format = 'transition-block';

  return format;
}

function updateIPCBindings(){
  //Disable those features that won't be used at all
  const toBeDisabled = ['convert-first-lines', 'headings-to-chaps', 'convert-italics', 
    'split-chapter', 'convert-tabs', 'renumber-chapters', 'outliner'
  ];
  ipcRenderer.send('disable-menu-items', toBeDisabled);

   //Clear listeners for features will need adjusted/re-written for screenplay
  const toBeReset = ['find-replace-clicked', 
    'word-count-clicked', 'spellcheck-clicked', 'add-chapter-clicked', 
    'delete-chapter-clicked', 'restore-chapter-clicked', 'outliner-clicked'];
  ipcRenderer.removeAllListeners(toBeReset);

  ipcRenderer.on('find-replace-clicked', function(e){
    if(editorHasFocus()){
      const showFindReplace = require('./findreplace_display');
      showFindReplace(project, screenplayQuill, function(){});
    }
  });

  ipcRenderer.on('spellcheck-clicked', function(e){
    if(editorHasFocus()){
      const showSpellcheck = require('./spellcheck_display');
      const { getBeginningOfCurrentWord } = require('../controllers/spellcheck');
      var currentIndex = screenplayQuill.getSelection(true).index;
      var beginningOfWord = getBeginningOfCurrentWord(screenplayQuill.getText(), currentIndex);
      showSpellcheck(screenplayQuill, project, sysDirectories, function(){}, beginningOfWord);
    }
  });
  
  ipcRenderer.on('word-count-clicked', function(e){
    const showWordCount = require('./wordcount_display');
    showWordCount(project, screenplayQuill);
  });

}

function editorHasFocus(){
  return editorIsVisible() && document.querySelector(".ql-editor-screenplay") === document.activeElement;
}

function editorIsVisible(){
  return document.getElementById('writing-field').classList.contains('visible');
}

function stopDefaultPropagation(keyEvent){
  keyEvent.preventDefault();
  keyEvent.stopPropagation();
}

module.exports = {
  showScreenplayEditor
}