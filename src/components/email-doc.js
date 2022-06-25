function prepareAndEmail(sender, pass, receiver, filetype, compileOptions, callback){
  var delt;
  var filename;

  if(compileOptions){
    delt = compileChapterDeltas(compileOptions);
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
    emailDeltaAsDocx(filename, delt, sender, pass, receiver, callback);
  }
  else if(filetype == ".mdfc"){
    emailDeltaAsMdfc(filename, delt, sender, pass, receiver, callback);
  }
  else {
    //default to txt
    emailDeltaAsTxt(filename, delt, sender, pass, receiver, callback);
  }

}

function emailDeltaAsDocx(filename, delt, sender, pass, receiver, callback){
  var doc = convertDeltaToDocx(delt);
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

function generateAttachments(filetype, compileOptions){
  let attachments = [];

  if(compileOptions == null){
    attachments.push(generateChapterAttachment(filetype));
  }

  return attachments;
}

function generateChapterAttachment(filetype){
  let filename;
  let content;

  if(filetype == ".docx"){
    //convert to docx
  }
  else if(filetype == ".mdfc"){
    //convert to mdfc
    filename = project.chapters[project.activeChapterIndex].title + '.mdfc';
    content = markdownFic().convertDeltaToMDF(editorQuill.getContents());
  }
  else {
    //default to txt
    filename = project.chapters[project.activeChapterIndex].title + '.txt';
    content = editorQuill.getText();
  }

  return {
    filename: filename,
    content: content
  }
}
