function emailDoc(sender, pass, receiver, callback){
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
    attachments: [
      {
        filename: project.chapters[project.activeChapterIndex].title + '.txt',
        content: markdownFic().convertDeltaToMDF(editorQuill.getContents())
      }
    ]
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
