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
  var transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: sender,
      pass: pass
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

module.exports = {
  prepareAndEmail,
  emailFile
}