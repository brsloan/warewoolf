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
  var attachments = await buildAttachments(project, userSettings, editorQuill, filetype, compileOptions);
  emailFile(platform, sender, pass, receiver, attachments, callback);
}

//The attachment descriptors for what the dialog asked for - the shape sendEmail takes, and
//wifiTransferOffer too, which is why this is its own function: Wi-Fi Transfer offers a phone
//exactly what Send via Email would have attached.
async function buildAttachments(project, userSettings, editorQuill, filetype, compileOptions){
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

  if(filetype == ".docx")
    return docxAttachments(project, userSettings, filename, delt, compileOptions);
  if(filetype == ".mdfc")
    return [{ filename: filename + '.mdfc', content: convertDeltaToMDF(delt) }];
  if(filetype == ".zip")
    return zipAttachments(project);
  if(filetype == '.md')
    return [{ filename: filename + '.md', content: convertMdfcToMd(convertDeltaToMDF(delt)) }];
  if(filetype == '.html')
    return htmlAttachments(filename, project, compileOptions, delt);
  if(filetype == '.epub')
    return epubAttachments(filename, project, compileOptions, delt);

  //default to txt
  return [{ filename: filename + '.txt', content: convertToPlainText(delt) }];
}

//The manuscript title page's project-wide word count is counted here now rather than inside
//delta-to-docx - see the note on convertDeltaToDocx for why.
async function docxAttachments(project, userSettings, filename, delt, options){
  var totalWordCount = options && options.generateTitlePage ? await getTotalWordCount(project) : 0;
  var doc = convertDeltaToDocx(delt, options, project, userSettings.addressInfo, totalWordCount);
  return new Promise(function(resolve){
    packageDocxBase64(doc, (docString) => {
      resolve([
        {
            filename: filename + '.docx',
            content: docString,
            encoding: 'base64'
        }
      ]);
    });
  });
}

function htmlAttachments(filename, project, compileOptions, delt){
  var generateTitle = compileOptions ? compileOptions.generateTitlePage : false;
  var title = compileOptions.compile ? project.title : project.getActiveChapter().title;

  return [
    {
      filename: filename + '.html',
      content: convertMdfcToHtmlPage(convertDeltaToMDF(delt), title, project.author, generateTitle)
    }
  ];
}

//No filename is given for the archive itself - sendEmail's projectArchive attachment allocates one
//natively (project title + timestamp), the same reason archiveProject (group H) allocates rather
//than takes one. "Cannot back up a project with no filename" now comes back as sendEmail's own
//rejection (archiveProject's own guard, reached through platform-node.js), not a check made here.
function zipAttachments(project){
  return [
    {
      projectArchive: {
        projectDir: project.directory,
        chapsDir: project.chapsDirectory,
        sourceFilename: project.filename
      }
    }
  ];
}

async function epubAttachments(filename, project, compileOptions, delt){
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

  return [
    {
      filename: filename + '.epub',
      epubEntries: entries
    }
  ];
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
  buildAttachments,
  emailFile
}
