const { removeElementsByClass, disableSearchView } = require('./utils');
const { enableTypewriterMode, disableTypewriterMode } = require('./typewriter-mode');
const { goPageDown, goPageUp, goToStart, goToEnd } = require('./quill-utils');
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

  //The pane a 'pane' shortcut was pressed in, as its Quill - or null for the chapter list, which
  //holds no text and has no caret to move. Only the four movement actions below ask: everything
  //else on that listener acts on the project rather than on what is written in it.
  //
  //Answered from the pane the listener is attached to rather than from document.activeElement,
  //because that is what "whichever pane has focus" has always meant here - the same question
  //previousChapter asks of e.currentTarget to decide where to leave the focus.
  function quillForPane(e){
    if(e.currentTarget.id === 'notes-editor')
      return context.notesQuill;

    if(e.currentTarget.id === 'editor-container')
      return context.editorQuill;

    return null;
  }

  //What each rebindable action outside Quill actually does, keyed by the ids in shortcuts.js.
  //
  //An `appliesTo` says when an action is available at all, and is asked BEFORE the keypress is
  //swallowed - so a key an action cannot act on is left to do whatever it natively does, which is
  //how Page Down keeps paging the chapter list rather than being eaten there to no effect. It is
  //not a substitute for the visibility checks inside the handlers below: those decide whether the
  //action does anything, having already claimed the key.
  var actions = {
    focusEditor: {
      run: function(){
        if(isVisible('writing-field')){
          removeElementsByClass('popup');
          disableSearchView();
          context.editorQuill.focus();
        }
      }
    },
    focusNotes: {
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
      run: function(){
        context.actions.togglePanelDisplay(1);
      }
    },
    toggleEditor: {
      run: function(){
        context.actions.togglePanelDisplay(2);
      }
    },
    toggleNotes: {
      run: function(){
        context.actions.togglePanelDisplay(3);
      }
    },
    toggleChapterNotes: {
      run: function(){
        context.actions.toggleChapterNotes();
      }
    },

    moveChapterUp: {
      run: function(){
        context.actions.moveChapUp(project().activeChapterIndex);
      }
    },
    moveChapterDown: {
      run: function(){
        context.actions.moveChapDown(project().activeChapterIndex);
      }
    },
    changeChapterLabel: {
      run: function(){
        if(isVisible('chapter-list-sidebar'))
          context.actions.changeChapterTitle(project().activeChapterIndex);
      }
    },
    previousChapter: {
      run: function(e){
        context.actions.displayPreviousChapter();
        if(e.currentTarget.id == 'notes-editor')
          context.notesQuill.focus();
      }
    },
    nextChapter: {
      run: function(e){
        context.actions.displayNextChapter();
        if(e.currentTarget.id == 'notes-editor')
          context.notesQuill.focus();
      }
    },
    //No notes-focus clause, unlike the two above. Those flip the document under a writer who is
    //working in the notes and means to stay there; this one is a move to a particular document, to
    //read or write in it, so the editor is where it should end - which is where displaying a
    //document and setting its caret leaves the focus anyway.
    jumpToReference: {
      run: function(){
        context.actions.jumpToReference();
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
    },

    //Moving within a document, in whichever of the two editors the keypress came from. All four are
    //the app's own: Quill binds none of these keys, and the native Page Down crept a line at a time
    //rather than a screenful (see goPageDown). Page Down has worked this way all along and is only
    //now rebindable along with the other three.
    pageUp: {
      appliesTo: hasQuill,
      run: function(e){
        goPageUp(quillForPane(e));
      }
    },
    pageDown: {
      appliesTo: hasQuill,
      run: function(e){
        goPageDown(quillForPane(e));
      }
    },
    jumpToStart: {
      appliesTo: hasQuill,
      run: function(e){
        goToStart(quillForPane(e));
      }
    },
    jumpToEnd: {
      appliesTo: hasQuill,
      run: function(e){
        goToEnd(quillForPane(e));
      }
    }
  };

  function hasQuill(e){
    return quillForPane(e) != null;
  }

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
      var action = actions[candidate.id];

      return candidate.target === target && action != null &&
        bindingsEqual(bindings[candidate.id], pressed) &&
        (action.appliesTo == null || action.appliesTo(e));
    });

    if(def == null)
      return false;

    //A matched shortcut always swallows its key. This was once a per-action flag - the shortcuts
    //that nudge a setting let the keypress through, as they had when these were an if/else chain -
    //which held only because those shortcuts sat on keys with nothing native to do. Now that a
    //writer may put any of them on Home or Page Down (shortcuts.js), letting the key through would
    //mean a font size that grows AND a caret that jumps, from one press.
    stopDefaultPropagation(e);

    actions[def.id].run(e);
    return true;
  }

  //The keys a plain text field does its own work with, which a shortcut must not take while a
  //writer is typing in one. Ctrl/Cmd+Left/Right is the native word-wise jump, and the shortcuts
  //that move focus between the panes ship on exactly those keys. The caret keys are the newer half:
  //they are bindable on their own now (shortcuts.js), so a global shortcut on bare Home would
  //otherwise fire from inside the rename box instead of taking the caret to the start of the name.
  //
  //Read off the keypress rather than off what is bound to it, because it is the native behaviour of
  //THESE keys being protected, whether or not a writer has moved a shortcut onto or off them.
  var TEXT_FIELD_CARET_KEYS = ['PageUp', 'PageDown', 'Home', 'End'];

  function inTextField(e){
    return e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA";
  }

  function isTextFieldKey(e){
    if(e.altKey)
      return false;

    if(e.ctrlKey || e.metaKey)
      return e.key === "ArrowLeft" || e.key === "ArrowRight";

    return TEXT_FIELD_CARET_KEYS.indexOf(e.key) !== -1;
  }

  function handleGlobalKeydown(e){
    //A plain text field - the chapter rename box, a dialog input - keeps its own keys while a writer
    //is typing in one. See isTextFieldKey for which, and why they are read off the keypress rather
    //than off whatever happens to be bound to them.
    if(inTextField(e) && isTextFieldKey(e))
      return;

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
    //up through it. Every shortcut on this listener - chapter navigation, reordering, paging - would
    //tear the box down in the middle of a rename and throw away what had been typed, and the keys
    //the field wants for itself are its own besides. So a text field keeps all of them, which is
    //blunter than the global listener's guard above and can afford to be: none of these shortcuts
    //mean anything while a name is being typed.
    if(inTextField(e))
      return;

    dispatch(e, 'pane');
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
