const fs = require('fs');
const os = require('os');
const path = require('path');
const nodemailer = require('nodemailer');
const { archiveProject } = require('./backup-project');
const { compileChapterDeltas } = require('./compile');
const { getTotalWordCount } = require('./wordcount');
const { convertDeltaToDocx, packageDocxBase64 } = require('./delta-to-docx');
const { convertDeltaToMDF } = require('./markdownFic');
const { logError } = require('./error-log');
const { convertMdfcToMd } = require('./mdfc-to-md');
const { convertMdfcToHtmlPage, convertMdfcToHtml } = require('./mdfc-to-html');
const { htmlChaptersToEpub } = require('./epub');
const { convertToPlainText } = require('./quill-utils');
const { SAVED_SECRET } = require('./platform');

//Phase 7 stopped the saved email password reaching the DOM. The dialogs now put SAVED_SECRET in the
//password field instead of a password, and it arrives here as `pass` untouched, so the only place
//in the renderer that ever sees the plaintext is the two lines of emailFile() below that hand it to
//nodemailer.
//
//That is the one rule-6 ("secrets are referenced, never returned") violation Phase 7 leaves
//standing, and it is deliberate and temporary. Phase 8 turns emailFile() into a single
//platform.sendEmail() call, which takes SAVED_SECRET across the boundary and resolves it on the far
//side - at which point the resolver below, and the plaintext, are gone from the renderer entirely.
//
//The resolver is injected by render.js from the node backing's resolveSecret(), which is
//deliberately not a declared command (see platform-node.js) and so is unreachable through the
//facade. Nothing can get at it by holding a platform instance; it has to be handed in here, on
//purpose, by the one file that builds the backing.
let resolveSavedSecret = null;

function setSecretResolver(resolver){
  resolveSavedSecret = resolver;
}

//Async because compiling the project, and building an .epub from it, read any chapter that is not
//already in memory off disk - which now goes through the platform facade. Every caller already
//waits on `callback` rather than on this returning, so nothing about the reporting changes.
async function prepareAndEmail(project, userSettings, editorQuill, sender, pass, receiver, filetype, compileOptions, callback){
  var delt;
  var filename;

  if(compileOptions.compile){
    delt = await compileChapterDeltas(project, compileOptions);
    let projectTitle = project.filename == "" ? "untitled" : project.filename.split('.')[0];
    if(projectTitle == "untitled" && project.title != "")
      projectTitle = project.title;
    filename = projectTitle;
  }
  else {
    delt = editorQuill.getContents();
    let chapTitle = project.getActiveChapter().title;
    filename = chapTitle == "" ? "untitled" : chapTitle;
  }

  if(filetype == ".docx"){
    await emailDeltaAsDocx(project, userSettings, filename, delt, compileOptions, sender, pass, receiver, callback);
  }
  else if(filetype == ".mdfc"){
    emailDeltaAsMdfc(filename, delt, sender, pass, receiver, callback);
  }
  else if(filetype == ".zip"){
    emailAsZip(project, sender, pass, receiver, callback);
  }
  else if(filetype == '.md'){
    emailDeltaAsMd(filename, delt, sender, pass, receiver, callback);
  }
  else if(filetype == '.html'){
    emailDeltaAsHtml(filename, project, compileOptions, delt, sender, pass, receiver, callback);
  }
  else if(filetype == '.epub'){
    await emailAsEpub(filename, project, compileOptions, delt, sender, pass, receiver, callback);
  }
  else {
    //default to txt
    emailDeltaAsTxt(filename, delt, sender, pass, receiver, callback);
  }

}

//The manuscript title page's project-wide word count is counted here now rather than inside
//delta-to-docx - see the note on convertDeltaToDocx for why.
async function emailDeltaAsDocx(project, userSettings, filename, delt, options, sender, pass, receiver, callback){
  var totalWordCount = options && options.generateTitlePage ? await getTotalWordCount(project) : 0;
  var doc = convertDeltaToDocx(delt, options, project, userSettings.addressInfo, totalWordCount);
  packageDocxBase64(doc, (docString) => {
    var attachments = [
      {
          filename: filename + '.docx',
          content: docString,
          encoding: 'base64'
      }
    ]
    emailFile(sender, pass, receiver, attachments, callback);
  });
}

function emailDeltaAsMd(filename, delt, sender, pass, receiver, callback){
  var attachments = [
    {
      filename: filename + '.md',
      content: convertMdfcToMd(convertDeltaToMDF(delt)) 
    }
  ];

  emailFile(sender, pass, receiver, attachments, callback);
}

function emailDeltaAsHtml(filename, project, compileOptions, delt, sender, pass, receiver, callback){
  var generateTitle = compileOptions ? compileOptions.generateTitlePage : false;
  var title = compileOptions.compile ? project.title : project.getActiveChapter().title;

  var attachments = [
    {
      filename: filename + '.html',
      content: convertMdfcToHtmlPage(convertDeltaToMDF(delt), title, project.author, generateTitle) 
    }
  ];

  emailFile(sender, pass, receiver, attachments, callback);
}

function emailDeltaAsMdfc(filename, delt, sender, pass, receiver, callback){
  var attachments = [
    {
      filename: filename + '.mdfc',
      content: convertDeltaToMDF(delt)
    }
  ];

  emailFile(sender, pass, receiver, attachments, callback);
}

function emailDeltaAsTxt(filename, delt, sender, pass, receiver, callback){
  var attachments = [
    {
      filename: filename + '.txt',
      content: convertToPlainText(delt)
    }
  ];

  emailFile(sender, pass, receiver, attachments, callback);
}

function emailAsZip(project, sender, pass, receiver, callback){
  archiveProject(project, os.tmpdir(), function(err, archName){
    if(err){
      logError(err);
      callback('Error archiving project: ' + err.message);
      return;
    }
    var archPath = path.join(os.tmpdir(), archName);
    var attachments = [
      {
        filename: archName,
        path: archPath,
        contentType: 'application/zip'
      }
    ];

    emailFile(sender, pass, receiver, attachments, function(resp){
      fs.unlink(archPath, function(unlinkErr){
        if(unlinkErr)
          logError(unlinkErr);
        callback(resp);
      });
    });
  });
}

async function emailAsEpub(filename, project, compileOptions, delt, sender, pass, receiver, callback){
  var generateTitle = compileOptions ? compileOptions.generateTitlePage : false;
  var title = compileOptions.compile ? project.title : project.getActiveChapter().title;
  var filePath = os.tmpdir() + '/' + filename + '.epub';
  var htmlChapters = [];

  if(compileOptions.compile){
    for(let i = 0; i < project.chapters.length; i++){
      htmlChapters.push({
        title: project.chapters[i].title,
        html: convertMdfcToHtml(convertDeltaToMDF(await project.chapters[i].getContentsOrFile()))
      })
    }
  }
  else{
    htmlChapters.push({
      title: title,
      html: convertMdfcToHtml(convertDeltaToMDF(delt))
    });
  }
  
  htmlChaptersToEpub(title, project.author, htmlChapters, filePath, generateTitle, function(generatedFilepath){
    if(generatedFilepath == 'error'){
      callback('Error generating EPUB.');
      return;
    }

    var attachments = [
      {
        filename: filename + '.epub',
        path: generatedFilepath,
        contentType: 'application/epub+zip'
      }
    ];

    emailFile(sender, pass, receiver, attachments, function(resp){
      fs.unlink(generatedFilepath, function(unlinkErr){
        if(unlinkErr)
          logError(unlinkErr);
        callback(resp);
      });
    });
  });
}

function emailFile(sender, pass, receiver, attachments, callback){
  var secret;

  //Reported through `callback` rather than thrown: every caller here is a completion callback
  //chain, and a throw from this point would leave the sending dialog stuck on "Sending..." with
  //nothing to say. A locked passphrase-protected credential arrives as a LOCKED PlatformError,
  //whose message is already the sentence to show the writer.
  try{
    secret = pass === SAVED_SECRET ? readSavedSecret() : pass;
  }
  catch(err){
    logError(err);
    callback('Error sending email: ' + err.message);
    return;
  }

  var transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: sender,
      pass: secret
    }
  });

  var mailOptions = {
    from: sender,
    to: receiver,
    subject: 'WareWoolf backup',
    text: 'Document will be attached.',
    attachments: attachments
  };

  transporter.sendMail(mailOptions, function(error, info){
    if (error) {
      logError(error);
      callback('Error sending email: ' + error.message);
    } else {
      console.log('Email sent: ' + info.response);
      callback('Email sent successfully.');
    }
  });
}

function readSavedSecret(){
  if(resolveSavedSecret == null)
    throw new Error('No saved password is available.');

  var secret = resolveSavedSecret({ service: 'email' });

  //Null means the credential went away between the dialog drawing itself and Send being clicked -
  //cleared in another window, or a keystore that stopped answering. Distinct from LOCKED, which
  //resolveSecret throws for itself.
  if(secret == null)
    throw new Error('The saved password could not be read.');

  return secret;
}

module.exports = {
  prepareAndEmail,
  emailFile,
  setSecretResolver
}