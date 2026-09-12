const { removeElementsByClass, disableSearchView } = require('./utils');
const { enableTypewriterMode, disableTypewriterMode } = require('./typewriter-mode');
const { goPageDown } = require('./quill-utils');
const { releaseSpellchecker } = require('./spellcheck');
const { createPlatform } = require('./platform');
const { createIpcBacking } = require('./platform-ipc');
const { getShortcutDefs, bindingFromEvent, bindingsEqual } = require('../models/shortcuts');

//A platform instance of its own rather than one threaded through `context`, matching how it already
//requires 'electron' independently of render.js - createIpcBacking() resolves ipcRenderer at call
//time (see platform-ipc.js), so this stays safe to re-require in tests the same way it always was.
var platform = createPlatform(createIpcBacking());

//The list of shortcuts lives in models/shortcuts.js; this is where the ones outside Quill are
//actually dispatched. Two listeners cover them: one on `document` for the shortcuts that make
//sense from anywhere ('global'), and one bound to each of the editor, chapter list and notes panes
//for the ones that act on "whichever of those has focus" ('pane'). Menu items go through the main
//process instead, and the formatting shortcuts through Quill's own keyboard module.
//
//Which key runs which action is read from context.getShortcuts() on every keypress rather than
//captured when this is registered, so a writer rebinding a shortcut takes effect immediately -
//there is nothing here to re-register.
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

  //What each rebindable action outside Quill actually does, keyed by the ids in shortcuts.js. The
  //`preventDefault` flag is per action rather than blanket, and says exactly what it did when these
  //were an if/else chain: the shortcuts that move focus, reorder chapters or toggle a pane swallow
  //the keypress, while the ones that nudge a setting (font size, editor width) leave it alone.
  var actions = {
    focusEditor: {
      preventDefault: true,
      run: function(){
        if(isVisible('writing-field')){
          removeElementsByClass('popup');
          disableSearchView();
          context.editorQuill.focus();
        }
      }
    },
    focusNotes: {
      preventDefault: true,
      run: function(){
        if(isVisible('project-notes')){
          removeElementsByClass('popup');
          disableSearchView();
          context.notesQuill.focus();
        }
      }
    },
    increaseFontSize: {
      run: function(){
        context.actions.increaseFontSizeSetting();
      }
    },
    decreaseFontSize: {
      run: function(){
        context.actions.decreaseFontSizeSetting();
      }
    },
    typewriterMode: {
      run: function(){
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
    },
    toggleChapterList: {
      preventDefault: true,
      run: function(){
        context.actions.togglePanelDisplay(1);
      }
    },
    toggleEditor: {
      preventDefault: true,
      run: function(){
        context.actions.togglePanelDisplay(2);
      }
    },
    toggleNotes: {
      preventDefault: true,
      run: function(){
        context.actions.togglePanelDisplay(3);
      }
    },
    toggleChapterNotes: {
      preventDefault: true,
      run: function(){
        context.actions.toggleChapterNotes();
      }
    },

    moveChapterUp: {
      preventDefault: true,
      run: function(){
        context.actions.moveChapUp(project().activeChapterIndex);
      }
    },
    moveChapterDown: {
      preventDefault: true,
      run: function(){
        context.actions.moveChapDown(project().activeChapterIndex);
      }
    },
    changeChapterLabel: {
      preventDefault: true,
      run: function(){
        if(isVisible('chapter-list-sidebar'))
          context.actions.changeChapterTitle(project().activeChapterIndex);
      }
    },
    previousChapter: {
      preventDefault: true,
      run: function(e){
        context.actions.displayPreviousChapter();
        if(e.currentTarget.id == 'notes-editor')
          context.notesQuill.focus();
      }
    },
    nextChapter: {
      preventDefault: true,
      run: function(e){
        context.actions.displayNextChapter();
        if(e.currentTarget.id == 'notes-editor')
          context.notesQuill.focus();
      }
    },
    decreaseEditorWidth: {
      run: function(){
        context.actions.descreaseEditorWidthSetting();
      }
    },
    increaseEditorWidth: {
      run: function(){
        context.actions.increaseEditorWidthSetting();
      }
    }
  };

  //Definition order decides which action wins if two ever share a binding. The popup will not let a
  //writer create that, but a hand-edited settings file can, and one shortcut quietly losing is a
  //better answer than both firing.
  var defs = getShortcutDefs();

  function dispatch(e, target){
    //Worked out once for the keypress rather than inside the search below. bindingMatchesEvent would
    //rebuild it for every shortcut considered - sixteen times a keystroke across the two listeners,
    //each time allocating the same object and running the same lookup - and this is the one path in
    //the app that every keystroke goes down.
    var pressed = bindingFromEvent(e);

    //A modifier held on its own, or a key that reported nothing to identify it by. No shortcut can
    //match either, and the early return is also what keeps bindingsEqual below from answering true
    //for an unbound action, since it considers two nulls equal.
    if(pressed == null)
      return false;

    var bindings = context.getShortcuts();

    var def = defs.find(function(candidate){
      return candidate.target === target && actions[candidate.id] != null &&
        bindingsEqual(bindings[candidate.id], pressed);
    });

    if(def == null)
      return false;

    var action = actions[def.id];

    if(action.preventDefault)
      stopDefaultPropagation(e);

    action.run(e);
    return true;
  }

  function handleGlobalKeydown(e){
    //Ctrl/Cmd+Left/Right is the native word-wise cursor jump inside a plain text field (the chapter
    //rename box, or any dialog input), and the shortcuts that move focus between the editor and
    //notes panes ship on exactly those keys. Leave the field to handle its own keys rather than
    //hijacking them - checked against the keypress itself rather than against whatever those two
    //shortcuts are currently bound to, because it is the native behaviour of THESE keys that is
    //being protected, whether or not a writer has moved the shortcuts off them.
    if((e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") &&
        (e.ctrlKey || e.metaKey) && (e.key === "ArrowLeft" || e.key === "ArrowRight")){
      return;
    }

    if(dispatch(e, 'global'))
      return;

    //Not customizable, and so not in the table above: Escape and the menu key are Tool/Menu
    //Navigation - the app's own structural keys, which the Shortcuts popup documents but does not
    //offer to rebind. A rebindable Escape could be rebound from inside a dialog that Escape is the
    //way out of.
    if(e.key === "Escape"){
      removeElementsByClass('popup');
      removeElementsByClass('popup-dialog');
      disableSearchView();
      //Escape is the other way out of the Spell Check popup, alongside its own Cancel button - and
      //the one that does not go through closePopups() - so the dictionaries a pass parsed are
      //dropped here too rather than staying resident for the rest of the session. Harmless when the
      //popup being dismissed was some other dialog: there is nothing cached to release.
      releaseSpellchecker();
      context.actions.updatePanelDisplays();
    }
    else if((e.ctrlKey || e.metaKey) && e.key === "m"){
      platform.showAppMenu().catch(function(err){
        require('./error-log').logError(err);
      });
    }
  }

  function editorControlEvents(e){
    //The chapter rename box is a plain text field living inside the sidebar pane, so these bubble
    //up through it. Ctrl/Cmd+Shift+Arrow is the native extend-selection-by-word there, and every
    //other shortcut below (chapter navigation, reordering, PageDown) would tear the box down in
    //the middle of a rename and throw away what had been typed. Leave a text field to handle its
    //own keys, the same way handleGlobalKeydown does above.
    if(e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")
      return;

    if(dispatch(e, 'pane'))
      return;

    //PageDown is not in the popup's list and so is not customizable: it is the native key doing
    //its native job in an editor that has no built-in equivalent (see goPageDown).
    if(e.key === "PageDown"){
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
