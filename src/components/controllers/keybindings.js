const { ipcRenderer } = require('electron');
const { removeElementsByClass, disableSearchView } = require('./utils');
const { enableTypewriterMode, disableTypewriterMode } = require('./typewriter-mode');
const { goPageDown } = require('./quill-utils');

//Two listeners cover every keyboard shortcut that is not a menu item (those go through the main
//process instead): one on `document` for shortcuts that make sense from anywhere, and one bound to
//each of the editor, chapter list, and notes panes for shortcuts that act on "whichever of those
//has focus". They used to live directly in render.js; moved here so they can be tested without
//pulling in render.js's whole Electron/Quill bootstrapping.
//
//`context.project` is read through a getter, not captured directly, because render.js can replace
//its `project` with a brand new object (creating a new project) after this module has already been
//wired up - capturing the object itself would leave every shortcut acting on a stale one.
//`userSettings`/`editorQuill`/`notesQuill` are never replaced that way, so those are held directly.
//Everything in `context.actions` is a render.js function that has to stay there, either because it
//is core, shared app behaviour (moveChapUp/moveChapDown/changeChapterTitle - also driven by the
//menu) or because it shares state with something render.js needs at startup, independent of any
//shortcut (togglePanelDisplay/toggleChapterNotes/the font-size and editor-width adjusters).
//
//Returns an unregister() function that removes all four listeners - production has no use for it
//(the app has exactly one of these for its whole lifetime), but a test that calls this once per
//test needs a way to undo the previous call, or every registration after the first would pile up
//on the same `document`.
function registerKeybindings(context){
  function project(){
    return context.getProject();
  }

  function stopDefaultPropagation(keyEvent){
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
  }

  function isVisible(elementId){
    return document.getElementById(elementId).classList.contains('visible');
  }

  function handleGlobalKeydown(e){
    //Ctrl/Cmd+Left/Right below moves focus between the editor and notes panes. Inside a plain
    //text field (the chapter rename box, or any dialog input) the same combo is the native
    //word-wise cursor jump, so leave it alone there instead of hijacking it everywhere.
    if((e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") &&
        (e.ctrlKey || e.metaKey) && (e.key === "ArrowLeft" || e.key === "ArrowRight")){
      return;
    }
    else if((e.ctrlKey || e.metaKey) && e.key === "ArrowLeft"){
      stopDefaultPropagation(e);
      if(isVisible('writing-field')){
        removeElementsByClass('popup');
        disableSearchView();
        context.editorQuill.focus();
      }
    }
    else if((e.ctrlKey || e.metaKey) && e.key === "ArrowRight"){
      stopDefaultPropagation(e);
      if(isVisible('project-notes')){
        removeElementsByClass('popup');
        disableSearchView();
        context.notesQuill.focus();
      }
    }
    else if(e.key === "Escape"){
      removeElementsByClass('popup');
      removeElementsByClass('popup-dialog');
      disableSearchView();
      context.actions.updatePanelDisplays();
    }
    else if((e.ctrlKey || e.metaKey) && e.key === "="){
      context.actions.increaseFontSizeSetting();
    }
    else if((e.ctrlKey || e.metaKey) && e.key === "-"){
      context.actions.decreaseFontSizeSetting();
    }
    else if((e.ctrlKey || e.metaKey) && e.altKey && e.key === "t"){
      if(context.userSettings.typewriterMode){
        disableTypewriterMode(context.editorQuill);
        context.userSettings.typewriterMode = false;
      }
      else{
        enableTypewriterMode(context.editorQuill);
        context.userSettings.typewriterMode = true;
      }
      context.userSettings.save();
    }
    else if((e.ctrlKey || e.metaKey) && e.key === "m"){
      ipcRenderer.send('show-menu');
    }
    else if(e.key === 'F1'){
      stopDefaultPropagation(e);
      context.actions.togglePanelDisplay(1);
    }
    else if(!e.ctrlKey && e.key === "F2"){
      stopDefaultPropagation(e);
      context.actions.togglePanelDisplay(2);
    }
    else if((e.ctrlKey || e.metaKey) && e.key === "F3"){
      stopDefaultPropagation(e);
      context.actions.toggleChapterNotes();
    }
    else if(e.key === "F3"){
      stopDefaultPropagation(e);
      context.actions.togglePanelDisplay(3);
    }
  }

  function editorControlEvents(e){
    if((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "ArrowUp"){
      stopDefaultPropagation(e);
      context.actions.moveChapUp(project().activeChapterIndex);
    }
    else if((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "ArrowDown"){
      stopDefaultPropagation(e);
      context.actions.moveChapDown(project().activeChapterIndex);
    }
    else if((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "ArrowLeft"){
      stopDefaultPropagation(e);
      if(isVisible('chapter-list-sidebar'))
        context.actions.changeChapterTitle(project().activeChapterIndex);
    }
    else if((e.ctrlKey || e.metaKey) && e.key === "ArrowUp"){
      stopDefaultPropagation(e);
      context.actions.displayPreviousChapter();
      if(e.currentTarget.id == 'notes-editor')
        context.notesQuill.focus();
    }
    else if((e.ctrlKey || e.metaKey) && e.key === "ArrowDown"){
      stopDefaultPropagation(e);
      context.actions.displayNextChapter();
      if(e.currentTarget.id == 'notes-editor')
        context.notesQuill.focus();
    }
    else if((e.ctrlKey || e.metaKey) && e.key === ","){
      context.actions.descreaseEditorWidthSetting();
    }
    else if((e.ctrlKey || e.metaKey) && e.key === "."){
      context.actions.increaseEditorWidthSetting();
    }
    else if(e.key === "PageDown"){
      stopDefaultPropagation(e);
      if(e.currentTarget.id == 'notes-editor')
        goPageDown(context.notesQuill);
      else
        goPageDown(context.editorQuill);
    }
  }

  var paneIds = ['editor-container', 'chapter-list-sidebar', 'notes-editor'];

  document.addEventListener('keydown', handleGlobalKeydown);
  paneIds.forEach(function(id){
    document.getElementById(id).addEventListener('keydown', editorControlEvents);
  });

  return function unregister(){
    document.removeEventListener('keydown', handleGlobalKeydown);
    paneIds.forEach(function(id){
      var el = document.getElementById(id);
      if(el)
        el.removeEventListener('keydown', editorControlEvents);
    });
  };
}

module.exports = {
  registerKeybindings
};
