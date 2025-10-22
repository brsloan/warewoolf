

function showScreenplayEditor(Quill, project){
    var screenplayQuill = setupQuill(Quill);

    project.activeChapterIndex = 0;
    screenplayQuill.setContents(project.chapters[0].getContentsOrFile(), 'api');

    const {styleFountainInlineMarkers} = require('../controllers/screenplay');
    styleFountainInlineMarkers(screenplayQuill);

    screenplayQuill.focus();
    screenplayQuill.setSelection(project.textCursorPosition);
}

function attachScreenplayEditorClass(quill){
    quill.root.classList.add('ql-editor-screenplay');
  }

function setupQuill(Quill){
    addScreenplayFormats(Quill);
    var editorDivName = createEditorDiv();
    var screenplayQuill = generateScreenplayQuill(Quill, editorDivName);
    addBindingsToScreenplayQuill(screenplayQuill);
    attachScreenplayEditorClass(screenplayQuill);
    return screenplayQuill;
}

function createEditorDiv(){
    const screenplayEditorDivName = 'editor-container-screenplay';
    var screenplayEditorDiv = document.createElement('div');
    screenplayEditorDiv.id = screenplayEditorDivName;

    var fictionEditorDiv = document.getElementById('editor-container');
    fictionEditorDiv.classList.add('hidden');
    var writingFieldDiv = document.getElementById('writing-field');
    writingFieldDiv.appendChild(screenplayEditorDiv);

    return screenplayEditorDivName;
}

function addScreenplayFormats(Quill){
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
  
  function generateScreenplayQuill(Quill, editorDivName){
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

  function getInitialBindings(){
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
            const prevLineType = thisLine[0].prev.statics.blotName;

            this.quill.deleteText(range.index - 1, 1, 'user');
            this.quill.format(prevLineType, 'true');
          }
          
            return useDefaultBackspace;
        }
      }
    }
  }

  function addBindingsToScreenplayQuill(q){
    q.keyboard.addBinding({
      key: '1',
      shortKey: true,
      handler: function(range, context) {
        this.quill.format('character-cue', true, 'user');
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

    q.root.addEventListener('keydown', function(e){
      if(e.key == "Enter"){
        const selectionIndex = q.getSelection().index;
        const thisLine = q.getLine(selectionIndex, 1);
        const previousLineType = thisLine[0].prev.statics.blotName;
        const enteringNewPara = thisLine[0].cache.length == 1;
        const enterWasPressedAtBeginningOfBlock = thisLine[0].prev.cache.length == 1;

        switch(previousLineType){
          case 'scene-header':
            if(enterWasPressedAtBeginningOfBlock) //Entire block was moved down, so style newly created empty line as default (action) line type
              q.formatText(selectionIndex - 1, 1, 'action-block', true, 'user');
            else
              q.format('action-block', true, 'user');
            break;
          case 'action':
            //Nothing special for action
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
              q.format('action-block', true, 'user');
            break;
          default:

        }
      }
    });
  
  };


  module.exports = {
    showScreenplayEditor
  }