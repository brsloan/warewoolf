//Phase 9b. The renderer's last two Node builtins were `fs` and `path`; this file is the `path` half.
//
//Nothing here touches the filesystem - every one of these is string manipulation on a path the
//caller already holds, which is why they are local helpers rather than new contract commands. A
//command would have to cross a process boundary to answer "what is the extension of this name",
//which is absurd, and would put a path-composition primitive in the bridge for no reason.
//
//They are deliberately NOT a reimplementation of Node's `path`. Node's `path` is
//platform-conditional: on Windows `path.join('C:/a/b', 'c')` returns 'C:\a\b\c', rewriting a
//separator the rest of this app has already settled on. The app's convention is forward slashes
//everywhere in the renderer - index.js normalizes every entry of sysDirectories on the way out
//(index.js:517-522), platform-node.js normalizes every path handed to a group B/C command
//(platform-node.js:293), and utils.js's convertFilepath() normalizes anything a user types into a
//settings field. So these split on '/' alone after normalizing, and compose with '/' - matching
//what the paths actually look like rather than what Node would do on the host.
//
//Backslashes are still tolerated on the way *in*: a path can arrive from a native dialog, from a
//settings file written by an older version, or from a user typing one, and none of those have been
//through convertFilepath yet.

//The single place backslashes are dealt with. Everything below is written as if only '/' exists,
//because after this line only '/' does.
function normalizeSlashes(p){
  return String(p).replaceAll('\\', '/');
}

//Trailing separators are stripped before the split, which is what makes basename('D:/Backups/')
//answer 'Backups' rather than '' - reachable from the settings field, where a user typing a
//trailing slash used to be the difference between creating the backup directory and asking the
//main process to create a directory with no name. A path that is *nothing but* separators is the
//root, and keeps its one.
function splitPath(fullPath){
  var normalized = normalizeSlashes(fullPath);
  var trimmed = normalized.replace(/\/+$/, '');

  if(trimmed === '')
    return { dir: '', base: normalized === '' ? '' : '/' };

  var parts = trimmed.split('/');
  var base = parts.pop();
  return { dir: parts.join('/'), base: base };
}

function basename(fullPath){
  return splitPath(fullPath).base;
}

//Splits only the base name's LAST extension - mirroring path.basename/path.extname rather than
//path's whole-path splitting, which is what corrupted a path with a dot in a parent directory's
//name (see file-manager.js's copyFiles regression tests). A name with no dot, or a dotfile with
//nothing before the dot, has no extension.
function extAndStem(base){
  var dot = base.lastIndexOf('.');
  if(dot <= 0)
    return { stem: base, ext: '' };
  return { stem: base.slice(0, dot), ext: base.slice(dot) };
}

//The whole of import.js's old `path.basename(p, path.extname(p))`: the filename with its directory
//and its final extension both removed.
function stemOfPath(fullPath){
  return extAndStem(basename(fullPath)).stem;
}

//Composes with '/' rather than the host separator - see the note at the top of this file. The seams
//get exactly one separator no matter how the caller's pieces were shaped, so join('a/', '/b') and
//join('a', 'b') agree.
function join(){
  var parts = [];

  for(var i = 0; i < arguments.length; i++){
    var part = normalizeSlashes(arguments[i]);

    if(part === '')
      continue;

    if(parts.length > 0)
      part = part.replace(/^\/+/, '');
    part = part.replace(/\/+$/, '');

    //An argument that was nothing but separators carries no name of its own. It is only meaningful
    //as a leading root, where it becomes the empty first element that puts a '/' at the front.
    if(part === ''){
      if(parts.length === 0)
        parts.push('');
      continue;
    }

    parts.push(part);
  }

  if(parts.length === 0)
    return '';
  if(parts.length === 1 && parts[0] === '')
    return '/';

  return parts.join('/');
}

module.exports = {
  normalizeSlashes,
  splitPath,
  basename,
  extAndStem,
  stemOfPath,
  join
}
