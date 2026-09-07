//Phase 9b. path-utils.js is what replaced the renderer's require('path') - see the note at the top
//of that file for why it is deliberately not a reimplementation of Node's path module.
//
//These tests are written the way the difference matters: every assertion below states an absolute
//answer, never one computed with path.join()/path.basename() on the host. A test that asserted
//join(a, b) === path.join(a, b) would pass on Linux, pass on Windows, and prove nothing about the
//one behavior this module exists to guarantee - that the answer is the same on both.
const test = require('node:test');
const assert = require('node:assert');

const {
  normalizeSlashes, splitPath, basename, extAndStem, stemOfPath, join
} = require('../src/components/controllers/path-utils');

const BACKSLASH = String.fromCharCode(92);
function win(p){ return p.split('/').join(BACKSLASH); }

// ---------------------------------------------------------------------------------------------
// join - the separator guarantee
// ---------------------------------------------------------------------------------------------

//The whole point. On Windows path.join('C:/a/b', 'c') answers 'C:\a\b\c', rewriting a separator
//the rest of the renderer has already settled on; index.js hands sysDirectories over already
//forward-slashed, so that rewrite fought the app's own convention.
test('join composes with forward slashes on every host', function(){
  assert.strictEqual(join('C:/Users/me/Documents', 'backups'), 'C:/Users/me/Documents/backups');
  assert.strictEqual(join('/home/me/Documents', 'backups'), '/home/me/Documents/backups');
});

//backup-project.js's deleteOldBackups joins a stored backupDirectory with a filename. A settings
//file written before this phase holds a backslash path, and it has to keep working.
test('join normalizes a backslash path handed to it', function(){
  assert.strictEqual(join(win('C:/Users/me/Documents/backups'), 'notes20250101000001.zip'),
    'C:/Users/me/Documents/backups/notes20250101000001.zip');
});

test('join puts exactly one separator at each seam however the pieces were shaped', function(){
  assert.strictEqual(join('a/', 'b'), 'a/b');
  assert.strictEqual(join('a', '/b'), 'a/b');
  assert.strictEqual(join('a//', '//b'), 'a/b');
  assert.strictEqual(join('a', 'b', 'c'), 'a/b/c');
});

test('join keeps a leading root and ignores empty pieces', function(){
  assert.strictEqual(join('/', 'etc'), '/etc');
  assert.strictEqual(join('/home', '', 'me'), '/home/me');
  assert.strictEqual(join(''), '');
  assert.strictEqual(join('/'), '/');
});

// ---------------------------------------------------------------------------------------------
// splitPath / basename
// ---------------------------------------------------------------------------------------------

test('splitPath separates the parent directory from the final name', function(){
  assert.deepStrictEqual(splitPath('/home/me/Documents/backups'),
    { dir: '/home/me/Documents', base: 'backups' });
  assert.deepStrictEqual(splitPath('C:/Users/me/notes.woolf'),
    { dir: 'C:/Users/me', base: 'notes.woolf' });
});

test('splitPath accepts a backslash path, since one can arrive from a dialog or an old settings file', function(){
  assert.deepStrictEqual(splitPath(win('C:/Users/me/Documents/backups')),
    { dir: 'C:/Users/me/Documents', base: 'backups' });
});

//backup-project.js's ensureBackupDirectory splits userSettings.backupDirectory into
//{parent, name} for createDirectory. That value comes straight from a text field in the settings
//dialog, and a user typing a trailing slash used to be the difference between creating the
//directory and asking the main process to create one with an empty name.
test('splitPath ignores a trailing separator rather than reporting an empty name', function(){
  assert.deepStrictEqual(splitPath('D:/Backups/'), { dir: 'D:', base: 'Backups' });
  assert.deepStrictEqual(splitPath('/home/me/'), { dir: '/home', base: 'me' });
  assert.strictEqual(basename('D:/Backups/'), 'Backups');
});

test('splitPath reports the root as its own name, not as nothing', function(){
  assert.deepStrictEqual(splitPath('/'), { dir: '', base: '/' });
  assert.deepStrictEqual(splitPath(''), { dir: '', base: '' });
});

test('basename returns the final segment', function(){
  assert.strictEqual(basename('/home/me/notes.woolf'), 'notes.woolf');
  assert.strictEqual(basename('notes.woolf'), 'notes.woolf');
});

// ---------------------------------------------------------------------------------------------
// extAndStem / stemOfPath
// ---------------------------------------------------------------------------------------------

test('extAndStem splits only the last extension', function(){
  assert.deepStrictEqual(extAndStem('chapter 1.5.txt'), { stem: 'chapter 1.5', ext: '.txt' });
  assert.deepStrictEqual(extAndStem('notes'), { stem: 'notes', ext: '' });
});

test('extAndStem treats a dotfile as having no extension', function(){
  assert.deepStrictEqual(extAndStem('.bashrc'), { stem: '.bashrc', ext: '' });
});

//Regression for import.js's documented bug: splitting on the FIRST "." lost everything after it,
//so "chapter 1.5.txt" imported as "chapter 1" and "my.novel.draft.txt" as "my".
test('stemOfPath keeps every dot but the last extension', function(){
  assert.strictEqual(stemOfPath('/home/me/chapter 1.5.txt'), 'chapter 1.5');
  assert.strictEqual(stemOfPath('/home/me/my.novel.draft.txt'), 'my.novel.draft');
});

//The other half of the same bug: a dot in a PARENT directory's name must not be mistaken for the
//file's extension, which is what path-level splitting got wrong.
test('stemOfPath ignores a dot in a parent directory name', function(){
  assert.strictEqual(stemOfPath('/home/me/my.projects/chapter one.txt'), 'chapter one');
  assert.strictEqual(stemOfPath('/home/me/my.projects/README'), 'README');
});

test('stemOfPath accepts a Windows path', function(){
  assert.strictEqual(stemOfPath(win('C:/Users/me/my.novel.draft.txt')), 'my.novel.draft');
});

// ---------------------------------------------------------------------------------------------

test('normalizeSlashes is the one place backslashes are dealt with', function(){
  assert.strictEqual(normalizeSlashes(win('C:/a/b')), 'C:/a/b');
  assert.strictEqual(normalizeSlashes('/a/b'), '/a/b');
});
