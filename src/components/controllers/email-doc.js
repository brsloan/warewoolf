const os = require('os');
const nodemailer = require('nodemailer');
const { archiveProject } = require('./backup-project');
const { compileChapterDeltas } = require('./compile');
const { convertDeltaToDocx, packageDocxBase64 } = require('./delta-to-docx');
const { convertDeltaToMDF } = require('./markdownFic');
const { logError } = require('./error-log');
const { convertMdfcToMd } = require('./mdfc-to-md');
const { convertMdfcToHtmlPage, convertMdfcToHtml } = require('./mdfc-to-html');
const { htmlChaptersToEpub } = require('./epub');

function prepareAndEmail(project, userSettings, editorQuill, sender, pass, receiver, filetype, compileOptions, callback){
  var delt;
  var filename;

  if(compileOptions){
    delt = compileChapterDeltas(project, compileOptions);
    let projectTitle = project.filename == "" ? "untitled" : project.filename.split('.')[0];
    if(projectTitle == "untitled" && project.title != "")
      projectTitle = project.title;
    filename = projectTitle;
  }
  else {
    delt = editorQuill.getContents();
    let chapTitle = project.chapters[project.activeChapterIndex].title;
    filename = chapTitle == "" ? "untitled" : chapTitle;
  }

  if(filetype == ".docx"){
    emailDeltaAsDocx(project, userSettings, filename, delt, compileOptions, sender, pass, receiver, callback);
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
    emailAsEpub(filename, project, compileOptions, delt, sender, pass, receiver, callback);
  }
  else {
    //default to txt
    emailDeltaAsTxt(filename, delt, sender, pass, receiver, callback);
  }

}

function emailDeltaAsDocx(project, userSettings, filename, delt, options, sender, pass, receiver, callback){
  var doc = convertDeltaToDocx(delt, options, project, userSettings);
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
  var title = compileOptions ? project.title : project.chapters[project.activeChapterIndex].title;
  
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
  console.log('about to archive project');
  archiveProject(project, os.tmpdir(), function(archName){
    if(archName != 'error'){
      var attachments = [
        {
          filename: archName,
          path: os.tmpdir() + '/' + archName,
          contentType: 'application/javascript'
        }
      ];

      emailFile(sender, pass, receiver, attachments, callback);
    }
  });
}

function emailAsEpub(filename, project, compileOptions, delt, sender, pass, receiver, callback){
  var generateTitle = compileOptions ? compileOptions.generateTitlePage : false;
  var title = compileOptions ? project.title : project.chapters[project.activeChapterIndex].title;
  var filePath = os.tmpdir() + '/' + filename + '.epub';
  console.log('filepath: ' + filePath);
  var htmlChapters = [];

  if(compileOptions){
    project.chapters.forEach(function(chap){
      htmlChapters.push({
        title: chap.title,
        html: convertMdfcToHtml(convertDeltaToMDF(chap.getContentsOrFile()))
      })
    });
  }
  else{
    htmlChapters.push({
      title: title,
      html: convertMdfcToHtml(convertDeltaToMDF(delt))
    });
  }
  
  htmlChaptersToEpub(title, project.author, htmlChapters, filePath, generateTitle, function(generatedFilepath){
    if(generatedFilepath != 'error'){
      var attachments = [
        {
          filename: filename + '.epub',
          path: generatedFilepath,
          contentType: 'application/javascript'
        }
      ];

      emailFile(sender, pass, receiver, attachments, callback);
    }
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
      callback(error);
    } else {
      console.log('Email sent: ' + info.response);
      callback('Email sent successfully.');
    }
  });
}

function convertToPlainText(delt){
  var text = '';
  delt.ops.forEach(op => {
    text += op.insert;
  });
  return text;
}

module.exports = {
  prepareAndEmail,
  emailFile
}