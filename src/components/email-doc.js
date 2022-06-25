function emailDoc(sender, pass, receiver, filetype, compileOptions, callback){
  var transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: sender,
      pass: pass
    }
  });

  var attachments = generateAttachments(filetype, compileOptions);

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
