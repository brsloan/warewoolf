const { removeElementsByClass } = require('../controllers/utils');

//Shown when render.js's loadPlatformState() rejects - the app could not finish starting up.
//
//Every other failure in this app happens with a running UI behind it. This one does not: the
//boot sequence resolves the system paths, builds the platform instances, loads user settings and
//opens the initial project, and a rejection anywhere in there leaves the window with two empty
//Quill editors, no keybindings, no menu handlers, and nothing to say why. Until this existed the
//rejection was simply unhandled - a blank window with the failure only visible in devtools, which
//a packaged build does not have. That is exactly the silence platform.js's rule 5 exists to
//prevent, so it is reported the same way a project that will not load already is
//(project-load-error_display.js).
//
//Deliberately depends on nothing but the DOM and one pure helper. Anything this popup needed from
//the platform, from user settings or from the open project could be the very thing that failed.
//
//There is no dismiss button on purpose: there is no working app behind this to go back to. The
//window itself still closes normally - index.js's close guard only traps a close once the renderer
//has reported in via notifyRendererReady(), which a failed boot never reaches.
function reportStartupFailure(err){
  removeElementsByClass('popup');
  var popup = document.createElement('div');
  popup.classList.add('popup');

  var title = document.createElement('h1');
  title.innerText = 'WareWoolf Could Not Start';
  popup.appendChild(title);

  var warning = document.createElement('h1');
  warning.innerText = 'Something went wrong while starting up.';
  warning.classList.add('warning-text');
  popup.appendChild(warning);

  var explanation = document.createElement('p');
  explanation.innerText = 'Your projects and chapters are stored as ordinary files on disk and ' +
    'have not been touched - nothing has been overwritten. Close this window and try again. If it ' +
    'keeps happening, the details below say what failed.';
  popup.appendChild(explanation);

  var detailLabel = document.createElement('h2');
  detailLabel.innerText = 'Details:';
  popup.appendChild(detailLabel);

  var detail = document.createElement('p');
  detail.innerText = describe(err);
  detail.classList.add('popup-text-small');
  popup.appendChild(detail);

  document.body.appendChild(popup);
}

//A rejection reaching here is not necessarily an Error - a PlatformError carries a `code` worth
//showing, and a bare string or object has to be rendered as something other than "undefined".
function describe(err){
  if(err == null)
    return 'No further detail was reported.';

  var message = err.message || String(err);

  return err.code ? err.code + ': ' + message : message;
}

module.exports = reportStartupFailure;
