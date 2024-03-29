const os = require('os');
const nodemailer = require('nodemailer');
const { archiveProject } = require('./backup-project');
const { compileChapterDeltas } = require('./compile');
const { convertDeltaToDocx, packageDocxBase64 } = require('./delta-to-docx');
const markdownFic = require('./markdownFic');
const { logError } = require('./error-log');

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
    console.log('you chose to email as zip');
    emailAsZip(project, sender, pass, receiver, callback);
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

function emailDeltaAsMdfc(filename, delt, sender, pass, receiver, callback){
  var attachments = [
    {
      filename: filename + '.mdfc',
      content: markdownFic().convertDeltaToMDF(delt)
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