const { compileChapterDeltas } = require('./compile');
const { getTotalWordCount } = require('./wordcount');
const { convertDeltaToDocx, packageDocxBase64 } = require('./delta-to-docx');
const { convertDeltaToMDF } = require('./markdownFic');
const { convertMdfcToMd } = require('./mdfc-to-md');
const { convertMdfcToHtmlPage, convertMdfcToHtml } = require('./mdfc-to-html');
const { assembleEpubEntries } = require('./epub');
const { convertToPlainText } = require('./quill-utils');
const { logError } = require('./error-log');

//Phase 8 closes Phase 7's one standing rule-6 exception: emailFile() used to resolve SAVED_SECRET
//itself, through a resolver render.js handed over explicitly (setSecretResolver), because
//sendEmail did not exist yet as a real command. It now does, and resolves the sentinel on the far
//side of the boundary exactly like storeCredential already does - so `platform` (render.js's
//node-backed instance, the same one email-doc_display.js and error-log_display.js already hold,
//for the same session-scoped-credential-store reason) is threaded through instead, and this file
//never sees a stored password at all, typed or saved. setSecretResolver/readSavedSecret and the
//module-level resolver they set are gone entirely, not merely unused.
//
//This also absorbs the os.tmpdir() dance emailAsZip/emailAsEpub used to do themselves
//(archiveProject/htmlChaptersToEpub into a temp file, attach by path, unlink after sending) -
//sendEmail's projectArchive/epubEntries attachment kinds do that natively now, so this file hands
//over identities (a project's directory/chapters/filename) or pre-assembled content (epub.js's
//own entries) and never learns a temp path. See platform.js's note on sendEmail for why a `path`
//here would have been exactly the arbitrary-file-read primitive Phase 7 declined to pull forward.

//Async because compiling the project, and building an .epub from it, read any chapter that is not
//already in memory off disk - which now goes through the platform facade. Every caller already
//waits on `callback` rather than on this returning, so nothing about the reporting changes.
async function prepareAndEmail(project, userSettings, editorQuill, platform, sender, pass, receiver, filetype, compileOptions, callback){
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
    await emailDeltaAsDocx(platform, project, userSettings, filename, delt, compileOptions, sender, pass, receiver, callback);
  }
  else if(filetype == ".mdfc"){
    emailDeltaAsMdfc(platform, filename, delt, sender, pass, receiver, callback);
  }
  else if(filetype == ".zip"){
    emailAsZip(platform, project, sender, pass, receiver, callback);
  }
  else if(filetype == '.md'){
    emailDeltaAsMd(platform, filename, delt, sender, pass, receiver, callback);
  }
  else if(filetype == '.html'){
    emailDeltaAsHtml(platform, filename, project, compileOptions, delt, sender, pass, receiver, callback);
  }
  else if(filetype == '.epub'){
    await emailAsEpub(platform, filename, project, compileOptions, delt, sender, pass, receiver, callback);
  }
  else {
    //default to txt
    emailDeltaAsTxt(platform, filename, delt, sender, pass, receiver, callback);
  }

}

//The manuscript title page's project-wide word count is counted here now rather than inside
//delta-to-docx - see the note on convertDeltaToDocx for why.
async function emailDeltaAsDocx(platform, project, userSettings, filename, delt, options, sender, pass, receiver, callback){
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
    emailFile(platform, sender, pass, receiver, attachments, callback);
  });
}

function emailDeltaAsMd(platform, filename, delt, sender, pass, receiver, callback){
  var attachments = [
    {
      filename: filename + '.md',
      content: convertMdfcToMd(convertDeltaToMDF(delt))
    }
  ];

  emailFile(platform, sender, pass, receiver, attachments, callback);
}

function emailDeltaAsHtml(platform, filename, project, compileOptions, delt, sender, pass, receiver, callback){
  var generateTitle = compileOptions ? compileOptions.generateTitlePage : false;
  var title = compileOptions.compile ? project.title : project.getActiveChapter().title;

  var attachments = [
    {
      filename: filename + '.html',
      content: convertMdfcToHtmlPage(convertDeltaToMDF(delt), title, project.author, generateTitle)
    }
  ];

  emailFile(platform, sender, pass, receiver, attachments, callback);
}

function emailDeltaAsMdfc(platform, filename, delt, sender, pass, receiver, callback){
  var attachments = [
    {
      filename: filename + '.mdfc',
      content: convertDeltaToMDF(delt)
    }
  ];

  emailFile(platform, sender, pass, receiver, attachments, callback);
}

function emailDeltaAsTxt(platform, filename, delt, sender, pass, receiver, callback){
  var attachments = [
    {
      filename: filename + '.txt',
      content: convertToPlainText(delt)
    }
  ];

  emailFile(platform, sender, pass, receiver, attachments, callback);
}

//No filename is given for the archive itself - sendEmail's projectArchive attachment allocates one
//natively (project title + timestamp), the same reason archiveProject (group H) allocates rather
//than takes one. "Cannot back up a project with no filename" now comes back as sendEmail's own
//rejection (archiveProject's own guard, reached through platform-node.js), not a check made here.
function emailAsZip(platform, project, sender, pass, receiver, callback){
  var attachments = [
    {
      projectArchive: {
        projectDir: project.directory,
        chapsDir: project.chapsDirectory,
        sourceFilename: project.filename
      }
    }
  ];

  emailFile(platform, sender, pass, receiver, attachments, callback);
}

async function emailAsEpub(platform, filename, project, compileOptions, delt, sender, pass, receiver, callback){
  var generateTitle = compileOptions ? compileOptions.generateTitlePage : false;
  var title = compileOptions.compile ? project.title : project.getActiveChapter().title;
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

  var entries = assembleEpubEntries(title, project.author, htmlChapters, generateTitle);

  var attachments = [
    {
      filename: filename + '.epub',
      epubEntries: entries
    }
  ];

  emailFile(platform, sender, pass, receiver, attachments, callback);
}

function emailFile(platform, sender, pass, receiver, attachments, callback){
  platform.sendEmail({
    service: 'email',
    sender: sender,
    secret: pass,
    receiver: receiver,
    attachments: attachments
  }).then(function(){
    callback('Email sent successfully.');
  }).catch(function(err){
    logError(err);
    callback('Error sending email: ' + err.message);
  });
}

module.exports = {
  prepareAndEmail,
  emailFile
}
