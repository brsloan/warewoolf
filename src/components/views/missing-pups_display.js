const { closePopups, createButton, removeElementsByClass } = require('../controllers/utils');
const fs = require('fs');
const { getFileList } = require('../controllers/file-manager');
//Each document's notes are saved beside it under this prefix (chapter.js owns the convention), and
//the corkboard has its own fixed name (corkboard.js). Both live in the chapters directory, so the
//listing below has to know about them or it reports the project's own files as strays.
const notesNamePrepend = '-notes_';
const corkboardFilename = 'project_corkboard.txt';

function promptForMissingPups(project, callback){
  removeElementsByClass('popup');
  var popup = document.createElement("div");
  popup.classList.add("popup");

  var title = document.createElement('h1');
  title.innerText = 'Missing Chapters';
  popup.appendChild(title);

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

  var chapsDirLabel = document.createElement('h2');
  chapsDirLabel.innerText = 'Expected Subdirectory:';
  popup.appendChild(chapsDirLabel);

  var chapsDirIn = document.createElement('input');
  chapsDirIn.type = 'text';
  chapsDirIn.value = project.chapsDirectory;
  popup.appendChild(chapsDirIn);

  var dirExistsCheck = document.createElement('label');
  popup.appendChild(dirExistsCheck);

  updateDirExists(project, dirExistsCheck);

  var subdirsList = document.createElement('div');
  subdirsList.id = 'subdirs-list';
  fillSubdirsList(project, subdirsList);
  popup.appendChild(subdirsList);

  var missingChapsList = document.createElement('div');
  popup.appendChild(missingChapsList);

  var fileList = document.createElement('div');
  fileList.id = 'missing-file-list';

  fillFileList(project, fileList, chapsDirIn);

  popup.appendChild(fileList);

  var saveChangesBtn = createButton('Save & Reload');
  saveChangesBtn.onclick = function(){
    project.saveFile();
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


  fillMissingChapsList(project, missingChapsList, fileList, chapsDirIn);

  chapsDirIn.onkeyup = function(ev){
    project.chapsDirectory = normalizeTrailingSlash(chapsDirIn.value);
    updateDirExists(project, dirExistsCheck);
    fillSubdirsList(project, subdirsList);
    fillFileList(project, fileList, chapsDirIn);
    fillMissingChapsList(project, missingChapsList, fileList, chapsDirIn);
  };

  document.body.appendChild(popup);
  chapsDirIn.focus();
}

function fillMissingChapsList(project, missingChapsList, fileList, chapsDirIn){
  missingChapsList.innerHTML = '';
  var missingChaps = project.testChapsDirectory();
  var missingChapsLabel = document.createElement('h2');
  missingChapsLabel.innerText = "Missing Chapter Files: ";
  missingChapsList.appendChild(missingChapsLabel);

  missingChaps.forEach(chap => {
    let deleteBtn = createButton('Delete');
    missingChapsList.appendChild(deleteBtn);

    let chapTitle = document.createElement('label');
    chapTitle.innerText = chap.title + ': ';
    missingChapsList.appendChild(chapTitle);

    let chapFilename = document.createElement('input');
    chapFilename.type = 'text';
    chapFilename.value = chap.filename;
    missingChapsList.appendChild(chapFilename);

    let chapExistsCheck = document.createElement('label');
    missingChapsList.appendChild(chapExistsCheck);

    updateChapExistsCheck(project, chapExistsCheck, chap);

    chapFilename.onkeyup = function(e){
      chap.filename = chapFilename.value;
      updateChapExistsCheck(project, chapExistsCheck, chap);
      fillFileList(project, fileList, chapsDirIn);
    };

    deleteBtn.onclick = function(){
      if(deleteBtn.innerText == 'Delete'){
        deleteBtn.innerText = 'Click Again To DELETE';
      }
      else{
        removeChapterFromProject(project, chap);
        fillMissingChapsList(project, missingChapsList, fileList, chapsDirIn);
        fillFileList(project, fileList, chapsDirIn);
      }
    }

    missingChapsList.appendChild(document.createElement('br'));
  });
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

function updateChapExistsCheck(project, chapExistsCheck, chap){
  if(fs.existsSync(project.directory + project.chapsDirectory + chap.filename)){
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

function fillFileList(project, fileList, chapsDirIn){
  fileList.innerHTML = '';

  var fileListTitle = document.createElement('p');
  fileListTitle.innerText = 'Files In Subdirectory: ';
  fileList.appendChild(fileListTitle);

  var chapsDir = normalizeTrailingSlash(chapsDirIn.value);
  if(fs.existsSync(project.directory + chapsDir)){
    var files = getFileList(project.directory + chapsDir);
    files.forEach(function(file){
      let filename = document.createElement('label');
      filename.innerText = file.isDirectory() ? '> ' + file.name : file.name;
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

function fillSubdirsList(project, subdirsList){
  subdirsList.innerHTML = '';

  var subdirsTitle = document.createElement('p');
  subdirsTitle.innerText = 'Subdirectories Available:';
  subdirsList.appendChild(subdirsTitle);

  var subdirs = getAvailableSubdirs(project);

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

function updateDirExists(project, dirExistsCheck){

  if(fs.existsSync(project.directory + project.chapsDirectory)){
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

function getAvailableSubdirs(project){
  return getFirstLevelDirs(project.directory).map(function(dir){
    return dir.replace(project.directory + '/', '') + '/';
  });
}

function getAllSubdirs(rootPath, dirs = []){
  if(rootPath[rootPath.length - 1] == '/')
    rootPath = rootPath.slice(0,-1);

  var newDirs = getFirstLevelDirs(rootPath);
  if(newDirs.length > 0){
    dirs = dirs.concat(newDirs);
    newDirs.forEach(function(dir){
      dirs = getAllSubdirs(dir, dirs)
    });
  }
  return dirs;
}

function getFirstLevelDirs(rootPath){
  return fs.readdirSync(rootPath, {withFileTypes: true}).filter(function(d){
    return d.isDirectory();
  }).map(function(d){
    return rootPath + '/' + d.name;
  });
}

module.exports = promptForMissingPups;