const { closePopups, createButton, removeElementsByClass, describeDialog } = require('../controllers/utils');
const { getFileList } = require('../controllers/file-manager');
const { createPlatform } = require('../controllers/platform');
const { createIpcBacking } = require('../controllers/platform-ipc');

//pathExists()/listDirectory() take no injected config, so this holds its own standing instance -
//same reason file-manager.js and corkboard.js do.
var platform = createPlatform(createIpcBacking());

//Each document's notes are saved beside it under this prefix (chapter.js owns the convention), and
//the corkboard has its own fixed name (corkboard.js). Both live in the chapters directory, so the
//listing below has to know about them or it reports the project's own files as strays.
const notesNamePrepend = '-notes_';
const corkboardFilename = 'project_corkboard.txt';

//Async because working out which chapter files are actually missing now goes through the platform
//facade. The popup is still appended in one pass at the end, so the reader never sees it half-drawn.
async function promptForMissingPups(project, callback){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var title = document.createElement('h1');
  title.innerText = 'Missing Chapters';
  popup.appendChild(title);
  describeDialog(popup, title);

  var warningTitle = document.createElement("h1");
  warningTitle.innerText = "Oops! Some of your chapters are missing.";
  warningTitle.classList.add('warning-text');
  popup.appendChild(warningTitle);

  var warning = document.createElement("p");
  warning.innerText = "You may have deleted or renamed one of the individual chapter files in the chapters subdirectory, or you may have renamed the subdirectory itself. If the subdirectory is wrong, fixing that should fix your chapters.";
  popup.appendChild(warning);

  var projDirLabel = document.createElement('h2');
  projDirLabel.innerText = 'Project Directory: ';
  popup.appendChild(projDirLabel);

  var projDir = document.createElement('p');
  projDir.innerText = project.directory;
  projDir.classList.add('popup-text-small');
  popup.appendChild(projDir);

  //A heading rather than a <label>, so it cannot point at the field with `for`; the field points
  //back at it instead, and a reader hears "Expected Subdirectory" on landing in the box.
  var chapsDirLabel = document.createElement('h2');
  chapsDirLabel.innerText = 'Expected Subdirectory:';
  chapsDirLabel.id = 'chaps-dir-label';
  popup.appendChild(chapsDirLabel);

  var chapsDirIn = document.createElement('input');
  chapsDirIn.type = 'text';
  chapsDirIn.id = 'chaps-dir-input';
  chapsDirIn.setAttribute('aria-labelledby', 'chaps-dir-label');
  chapsDirIn.value = project.chapsDirectory;
  popup.appendChild(chapsDirIn);

  var dirExistsCheck = document.createElement('label');
  popup.appendChild(dirExistsCheck);

  await updateDirExists(project, dirExistsCheck);

  var subdirsList = document.createElement('div');
  subdirsList.id = 'subdirs-list';
  await fillSubdirsList(project, subdirsList);
  popup.appendChild(subdirsList);

  var missingChapsList = document.createElement('div');
  popup.appendChild(missingChapsList);

  var fileList = document.createElement('div');
  fileList.id = 'missing-file-list';

  await fillFileList(project, fileList, chapsDirIn);

  popup.appendChild(fileList);

  var saveChangesBtn = createButton('Save & Reload');
  //Awaited so the reload the callback triggers reads a project file that has actually been written.
  saveChangesBtn.onclick = async function(){
    await project.saveFile();
    closePopups();
    callback('save');
  }
  popup.appendChild(saveChangesBtn);

  var cancel = createButton("Close");
  cancel.onclick = function(){
    closePopups();
    callback('cancel');
  };
  popup.appendChild(cancel);


  await fillMissingChapsList(project, missingChapsList, fileList, chapsDirIn);

  chapsDirIn.onkeyup = async function(ev){
    project.chapsDirectory = normalizeTrailingSlash(chapsDirIn.value);
    await updateDirExists(project, dirExistsCheck);
    await fillSubdirsList(project, subdirsList);
    await fillFileList(project, fileList, chapsDirIn);
    await fillMissingChapsList(project, missingChapsList, fileList, chapsDirIn);
  };

  document.body.appendChild(popup);
  chapsDirIn.focus();
}

async function fillMissingChapsList(project, missingChapsList, fileList, chapsDirIn){
  var missingChaps = await project.testChapsDirectory();
  //Cleared only once the answer is in hand, so a redraw that is still waiting on the check does not
  //leave the reader looking at an empty list.
  missingChapsList.innerHTML = '';
  var missingChapsLabel = document.createElement('h2');
  missingChapsLabel.innerText = "Missing Chapter Files: ";
  missingChapsList.appendChild(missingChapsLabel);

  for(const chap of missingChaps){
    let deleteBtn = createButton('Delete');
    missingChapsList.appendChild(deleteBtn);

    let chapTitle = document.createElement('label');
    chapTitle.innerText = chap.title + ': ';
    missingChapsList.appendChild(chapTitle);

    let chapFilename = document.createElement('input');
    chapFilename.setAttribute('aria-label', 'Filename for ' + (chap.title || '(untitled)'));
    chapFilename.type = 'text';
    chapFilename.value = chap.filename;
    missingChapsList.appendChild(chapFilename);

    let chapExistsCheck = document.createElement('label');
    missingChapsList.appendChild(chapExistsCheck);

    await updateChapExistsCheck(project, chapExistsCheck, chap);

    chapFilename.onkeyup = async function(e){
      chap.filename = chapFilename.value;
      await updateChapExistsCheck(project, chapExistsCheck, chap);
      await fillFileList(project, fileList, chapsDirIn);
    };

    deleteBtn.onclick = async function(){
      if(deleteBtn.innerText == 'Delete'){
        deleteBtn.innerText = 'Click Again To DELETE';
      }
      else{
        removeChapterFromProject(project, chap);
        await fillMissingChapsList(project, missingChapsList, fileList, chapsDirIn);
        await fillFileList(project, fileList, chapsDirIn);
      }
    }

    missingChapsList.appendChild(document.createElement('br'));
  }
}

//A missing document can be in any of the project's three lists, so it has to come out of the one
//it is actually in. Reaching for project.chapters.indexOf() alone returned -1 for a reference or
//trashed document, and splice(-1, 1) then quietly removed the last real chapter instead of it.
function removeChapterFromProject(project, chap){
  var lists = [project.chapters, project.reference, project.trash];

  for(let i = 0; i < lists.length; i++){
    if(!lists[i])
      continue;

    var ind = lists[i].indexOf(chap);
    if(ind > -1){
      lists[i].splice(ind, 1);
      return true;
    }
  }

  return false;
}

//Every list the project keeps files for, so a reference or trashed document is not mistaken for an
//unexpected file on disk or missed when checking whether two documents claim the same filename.
//Each list is defaulted because concat() would otherwise splice a bare undefined into the result
//for a project that is missing one.
function allChapters(project){
  return (project.chapters || []).concat(project.reference || [], project.trash || []);
}

//Every filename this project is expected to keep in its chapters directory: each document's own
//file, the notes file that sits alongside it under the '-notes_' prefix, and the corkboard. The
//project-wide notes belong to notesChap, which is not in any of the three lists, so it is added
//here as well - without it the reader was told their project notes file was an unexpected stray.
function expectedFilenames(project){
  var filenames = [corkboardFilename];

  allChapters(project).concat(project.notesChap || []).forEach(function(chap){
    if(!chap || chap.filename == null)
      return;

    filenames.push(chap.filename);
    filenames.push(notesNamePrepend + chap.filename);
  });

  return filenames;
}

async function updateChapExistsCheck(project, chapExistsCheck, chap){
  var exists = await platform.pathExists({ path: project.directory + project.chapsDirectory + chap.filename });

  if(exists){
    if(allChapters(project).filter(function(ch){
      return ch.filename == chap.filename;
    }).length > 1){
      chapExistsCheck.classList.add('unsure-check');
      chapExistsCheck.classList.remove('bad-check');
      chapExistsCheck.classList.remove('good-check');
      chapExistsCheck.innerText = " !! File Already Used By Another Chapter";

    }
    else {
      chapExistsCheck.classList.add('good-check');
      chapExistsCheck.classList.remove('bad-check');
      chapExistsCheck.classList.remove('unsure-check');
      chapExistsCheck.innerText = ' ✔ Exists';
    }
  }
  else{
    chapExistsCheck.classList.add('bad-check');
    chapExistsCheck.classList.remove('good-check');
    chapExistsCheck.classList.remove('unsure-check');
    chapExistsCheck.innerText = ' ✖ Missing';
  }
}

async function fillFileList(project, fileList, chapsDirIn){
  fileList.innerHTML = '';

  var fileListTitle = document.createElement('p');
  fileListTitle.innerText = 'Files In Subdirectory: ';
  fileList.appendChild(fileListTitle);

  var chapsDir = normalizeTrailingSlash(chapsDirIn.value);
  var dirExists = await platform.pathExists({ path: project.directory + chapsDir });

  if(dirExists){
    var files = await getFileList(project.directory + chapsDir);
    files.forEach(function(file){
      let filename = document.createElement('label');
      filename.innerText = file.isDirectory ? '> ' + file.name : file.name;
      fileList.appendChild(filename);

      let fileExpected = document.createElement('label');
      fileList.appendChild(fileExpected);
      if(expectedFilenames(project).includes(file.name)){
        fileExpected.innerText = ' ✔';
        fileExpected.classList.add('good-check');
      }
      else {
        fileExpected.innerText = ' ??? Unexpected File';
        fileExpected.classList.add('unsure-check');
      }
      fileList.appendChild(document.createElement('br'));
    });
  }
  else {
    let none = document.createElement('label');
    none.innerText = '(None: Subdirectory Does Not Exist)';
    fileList.appendChild(none);

    let noneCheck = document.createElement('label');
    noneCheck.innerText = ' ✖';
    noneCheck.classList.add('bad-check');
    fileList.appendChild(noneCheck);
  }
}

async function fillSubdirsList(project, subdirsList){
  subdirsList.innerHTML = '';

  var subdirsTitle = document.createElement('p');
  subdirsTitle.innerText = 'Subdirectories Available:';
  subdirsList.appendChild(subdirsTitle);

  var subdirs = await getAvailableSubdirs(project);

  for(let i=0;i<subdirs.length;i++){
    let thisDir = document.createElement('label');
    thisDir.innerText = subdirs[i];
    subdirsList.appendChild(thisDir);
    let currentDir = document.createElement('label');
    subdirsList.appendChild(currentDir);
    if(subdirs[i] == project.chapsDirectory){
      currentDir.innerText = ' ✔';
      currentDir.classList.add('good-check');
    }
    else {
      currentDir.innerText = ' ??? Unexpected Directory';
      currentDir.classList.add('unsure-check');
    }
    subdirsList.appendChild(document.createElement('br'));
  }
}

function normalizeTrailingSlash(value){
  if(value.length > 0 && value[value.length - 1] != '/')
    return value + '/';
  return value;
}

async function updateDirExists(project, dirExistsCheck){
  var exists = await platform.pathExists({ path: project.directory + project.chapsDirectory });

  if(exists){
    dirExistsCheck.classList.add('good-check');
    dirExistsCheck.classList.remove('bad-check');
    dirExistsCheck.innerText = ' ✔ Exists';
  }
  else{
    dirExistsCheck.classList.add('bad-check');
    dirExistsCheck.classList.remove('good-check');
    dirExistsCheck.innerText = ' ✖ Missing';
  }
}

async function getAvailableSubdirs(project){
  var dirs = await getFirstLevelDirs(project.directory);
  return dirs.map(function(dir){
    return dir.replace(project.directory + '/', '') + '/';
  });
}

async function getFirstLevelDirs(rootPath){
  var entries = await platform.listDirectory({ path: rootPath });
  return entries.filter(function(entry){
    return entry.isDirectory;
  }).map(function(entry){
    return rootPath + '/' + entry.name;
  });
}

module.exports = promptForMissingPups;
