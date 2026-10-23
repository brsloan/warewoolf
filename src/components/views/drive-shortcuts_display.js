const { listDrives, mountDrive, ejectDrive } = require('../controllers/drives');

var HINT = 'Enter opens the drive. Ctrl+E ejects it.';

function isDriveOption(option){
  return option != null && option.dataset.driveId != null;
}

//Adds a Drives section under the folder shortcuts in `listElement`, and the keys that act on it:
//Enter on a drive mounts it if it needs mounting (a USB stick on Pi OS Lite) and browses it, Ctrl+E
//ejects it. The dialog's own Enter handler skips drive entries - see isDriveOption.
//
//Drives are listed after the dialog is already up rather than before it: on Windows the listing is
//a PowerShell call that takes about a second. They are listed again each time the shortcuts list
//takes focus, so a stick plugged in while the dialog is open shows up on the next ArrowLeft.
//
//`hooks.browse(path)` lists a directory in the dialog; `hooks.currentDirectory()` is the directory
//showing, so ejecting the drive it is on can move the dialog back to the first shortcut. Returns the
//status line, for the dialog to place, and the refresh() promise for the first listing.
function attachDriveShortcuts(listElement, hooks){
  var status = document.createElement('p');
  status.classList.add('drive-status');
  status.setAttribute('role', 'status');

  var refreshCount = 0;

  async function refresh(){
    var thisRefresh = ++refreshCount;
    var drives = await listDrives();
    if(thisRefresh !== refreshCount)
      return;

    var selectedId = isDriveOption(listElement.selectedOptions[0]) ? listElement.value : null;

    Array.from(listElement.querySelectorAll('.drive-shortcut, .drive-heading')).forEach(function(option){
      option.remove();
    });

    if(drives.length === 0)
      return;

    var heading = document.createElement('option');
    heading.classList.add('drive-heading');
    heading.disabled = true;
    heading.innerText = '-- Drives --';
    listElement.appendChild(heading);

    drives.forEach(function(drive){
      var option = document.createElement('option');
      option.classList.add('drive-shortcut');
      option.value = drive.id;
      option.dataset.driveId = drive.id;
      option.dataset.drivePath = drive.path || '';
      option.dataset.driveName = drive.name;
      option.innerText = (drive.mounted ? '> ' : '+ ') + drive.name + (drive.mounted ? '' : ' (not mounted)');
      listElement.appendChild(option);
    });

    if(selectedId != null)
      listElement.value = selectedId;
  }

  async function openDrive(option){
    var drivePath = option.dataset.drivePath;

    if(drivePath === ''){
      status.innerText = 'Mounting ' + option.dataset.driveName + '...';
      try{
        drivePath = await mountDrive(option.dataset.driveId);
      }
      catch(err){
        status.innerText = 'Could not mount ' + option.dataset.driveName + ': ' + err.message;
        return;
      }
      option.dataset.drivePath = drivePath;
      option.innerText = '> ' + option.dataset.driveName;
      status.innerText = HINT;
    }

    await hooks.browse(drivePath);
  }

  async function eject(option){
    var name = option.dataset.driveName;
    var drivePath = option.dataset.drivePath;

    status.innerText = 'Ejecting ' + name + '...';
    try{
      await ejectDrive(option.dataset.driveId);
    }
    catch(err){
      status.innerText = 'Could not eject ' + name + ': ' + err.message;
      return;
    }

    status.innerText = name + ' can be removed safely.';

    var current = hooks.currentDirectory();
    if(drivePath !== '' && (current === drivePath || current.startsWith(drivePath + '/')))
      await hooks.browse(listElement.options[0].value);

    await refresh();
    listElement.selectedIndex = 0;
  }

  listElement.addEventListener('keydown', async function(e){
    var option = listElement.selectedOptions[0];
    if(!isDriveOption(option))
      return;

    if(e.key === 'Enter'){
      e.preventDefault();
      await openDrive(option);
    }
    //Plain Ctrl+E only: Ctrl+Shift+E is Export and Ctrl+Alt+E is Send via Email.
    else if((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'e' || e.key === 'E')){
      e.preventDefault();
      e.stopPropagation();
      await eject(option);
    }
  });

  listElement.addEventListener('change', function(){
    if(isDriveOption(listElement.selectedOptions[0]))
      status.innerText = HINT;
  });

  listElement.addEventListener('focus', function(){
    refresh();
  });

  return { status: status, ready: refresh() };
}

module.exports = { attachDriveShortcuts, isDriveOption };
