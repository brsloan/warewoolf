/* This module uses global objects Quill, Project, from render.js. Not best practice, I know, but if they're there... */
/* This module also horrifically abuses QuillJS in ways it was never meant to have been used, because the usual ways are
just too slow (2-5 seconds to load a full screenplay). You aren't supposed to directly insert HTML like I do here, so things
get...wonky. Plan to eventually replace Quill with my own editor object. */

const { ipcRenderer } = require('electron'); //Not technically necessary since it has access through global const in render.js

var screenplayQuill = setupQuill();

function showScreenplayEditor(){
    project.activeChapterIndex = 0;

    screenplayQuill.root.innerHTML = project.chapters[0].getContentsOrFile();

    updateSceneList();
    document.getElementById('chapter-list-sidebar').classList.add('sidebar-screenplay');

    //Appears that since I am hacking Quill a bit by directly placing contents into its HTML instead of using its own
    //painfully slow function, I have to set a delay before manipulating that HTML through Quill, for mysterious reasons
    setTimeout(function(){
      screenplayQuill.setSelection(project.textCursorPosition);
      screenplayQuill.focus();
      requestIdleCallback(setWordCountOnLoad);
    }, 10);

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

    if(document.getElementById(screenplayEditorDivName) == null){
      var screenplayEditorDiv = document.createElement('div');
      screenplayEditorDiv.id = screenplayEditorDivName;
      var writingFieldDiv = document.getElementById('writing-field');
      writingFieldDiv.appendChild(screenplayEditorDiv);
    }

    hideFictionEditor();

    return screenplayEditorDivName;
}

function hideFictionEditor(){
  var fictionEditorDiv = document.getElementById('editor-container');
  fictionEditorDiv.classList.add('hidden');
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

        const showFindReplace = require('./findreplace_display');
        showFindReplace(project, q, function(ind){
          console.log('display chapter by index ' + ind);
          console.log(screenplayQuill.getContents());
        });

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
      const enteringNewPara = thisLine[0].cache.length == 1;
      const enterWasPressedAtBeginningOfBlock = thisLine[0].prev.cache.length == 1;

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

module.exports = {
  showScreenplayEditor
}