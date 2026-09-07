//Where the packaged app is. Deliberately not a constant: the whole point of these scripts is that
//they run against the artifact on each target, and on the Pi that artifact is not in out/ at all -
//it is whatever the .deb installed, which is the version of it that has actually been through
//packaging. WAREWOOLF_EXE overrides everything; otherwise this looks where `npm run package` puts
//it for the host, and then where a Linux package install puts it.
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function candidates(){
  const plat = process.platform;
  const arch = process.arch;
  const out = path.join(REPO_ROOT, 'out');
  const list = [];

  if(plat === 'win32'){
    list.push(path.join(out, 'warewoolf-win32-' + arch, 'warewoolf.exe'));
  }
  else if(plat === 'darwin'){
    list.push(path.join(out, 'warewoolf-darwin-' + arch,
      'WareWoolf.app', 'Contents', 'MacOS', 'WareWoolf'));
    list.push(path.join(out, 'warewoolf-darwin-' + arch,
      'warewoolf.app', 'Contents', 'MacOS', 'warewoolf'));
    list.push('/Applications/WareWoolf.app/Contents/MacOS/WareWoolf');
  }
  else {
    list.push(path.join(out, 'warewoolf-linux-' + arch, 'warewoolf'));
    //Where electron-installer-debian lands it. This is the one that matters for the Pi pass:
    //running out/ there would test a directory this machine built, not the package the device
    //installed, and the difference is exactly what the zstd .deb bug lived in.
    list.push('/opt/WareWoolf/warewoolf');
    list.push('/usr/lib/warewoolf/warewoolf');
    list.push('/opt/warewoolf/warewoolf');
  }

  return list;
}

function resolveExe(){
  if(process.env.WAREWOOLF_EXE){
    const named = path.resolve(process.env.WAREWOOLF_EXE);
    if(!fs.existsSync(named))
      throw new Error('WAREWOOLF_EXE is set to a path that does not exist: ' + named);
    return named;
  }

  const tried = candidates();
  for(var i = 0; i < tried.length; i++){
    if(fs.existsSync(tried[i]))
      return tried[i];
  }

  throw new Error('No packaged WareWoolf found. Run `npm run package`, or set WAREWOOLF_EXE.\n'
    + 'Looked in:\n  ' + tried.join('\n  '));
}

//A clean userData every run, which is not incidental. loadInitialProject()'s materialize-the-
//bundled-example branch only runs when there is no last project and no copy in userData, so a
//reused profile silently tests a different startup path than a first launch does.
function freshUserData(){
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ww-driven-'));
}

module.exports = { REPO_ROOT, resolveExe, freshUserData };
