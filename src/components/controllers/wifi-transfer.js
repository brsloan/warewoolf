const { logError } = require('./error-log');
const { createPlatform } = require('./platform');
const { createIpcBacking } = require('./platform-ipc');
const { buildAttachments } = require('./email-doc');
const { join } = require('./path-utils');

//A standing instance for the same reason bluetooth-manager.js keeps one: nothing here takes
//injected config. The server itself is on the native side (wifi-transfer-server.js); this only
//switches it, asks how it is, and hands it things to offer.
var platform = createPlatform(createIpcBacking());

//UNAVAILABLE is the deck having no network to listen on, which the dialog shows as it is; anything
//else is a real failure and is logged as well.
function reportUnlessUnavailable(err){
  if(err == null || err.code !== 'UNAVAILABLE')
    logError(err);
}

//Each resolves { status, message }: the server's status (null when it could not be read) and the
//reason when something failed.
async function startTransfer(){
  try{
    return { status: await platform.wifiTransferStart(), message: null };
  }
  catch(err){
    reportUnlessUnavailable(err);
    return { status: null, message: err.message };
  }
}

async function stopTransfer(){
  try{
    await platform.wifiTransferStop();
    return null;
  }
  catch(err){
    reportUnlessUnavailable(err);
    return err.message;
  }
}

async function getTransferStatus(){
  try{
    return { status: await platform.wifiTransferStatus(), message: null };
  }
  catch(err){
    reportUnlessUnavailable(err);
    return { status: null, message: err.message };
  }
}

//Builds what Send via Email would attach - `filetype` and `compileOptions` mean what they do there -
//and puts it on the page. Resolves { status, message }.
async function offerToPage(project, userSettings, editorQuill, filetype, compileOptions){
  try{
    var attachments = await buildAttachments(project, userSettings, editorQuill, filetype, compileOptions);
    var status = await platform.wifiTransferOffer({ attachments: attachments });
    var names = status.offers.map(function(offer){ return offer.name; });
    return { status: status, message: 'On the page: ' + names.join(', ') + '.' };
  }
  catch(err){
    logError(err);
    return { status: null, message: 'Could not put it on the page: ' + err.message };
  }
}

//Resolves null, or the reason the file is still there.
async function discardInboxFile(inbox, name){
  try{
    await platform.deleteEntry({ path: join(inbox.path, name) });
    return null;
  }
  catch(err){
    logError(err);
    return 'Could not discard ' + name + ': ' + err.message;
  }
}

//Which Import file type reads a file sent to the inbox, by its extension - the ids
//import_display.js gives its radio buttons - or 'backup' for a .zip, which Restore Backup opens
//instead. null for anything else (the server refuses other types, so only a file put in the inbox
//by hand gets here). A .txt is Plain Text in either kind of project: a screenplay project imports
//one as a Reference document, and a script sent as .txt can still be switched to Fountain in the
//Import dialog.
var IMPORT_TYPES = {
  docx: 'docxSelect',
  txt: 'txtSelect',
  md: 'mdfcSelect',
  mdfc: 'mdfcSelect',
  html: 'htmlSelect',
  htm: 'htmlSelect',
  xhtml: 'htmlSelect',
  epub: 'epubSelect',
  fountain: 'fountainSelect',
  fdx: 'fdxSelect',
  fadein: 'fadeinSelect',
  zip: 'backup'
};

function importKindFor(name){
  var dot = name.lastIndexOf('.');
  if(dot === -1)
    return null;
  return IMPORT_TYPES[name.slice(dot + 1).toLowerCase()] || null;
}

module.exports = {
  startTransfer,
  stopTransfer,
  getTransferStatus,
  offerToPage,
  discardInboxFile,
  importKindFor
}
