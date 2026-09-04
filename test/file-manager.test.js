const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const archiver = require('archiver');

const errorLog = require('../src/components/controllers/error-log');
const fileManagerPath = require.resolve('../src/components/controllers/file-manager');
const fileManager = require(fileManagerPath);

//file-manager.js destructures `logError` from error-log.js at require-time, so a test that mocks
//errorLog.logError must re-require this module afterward for the fresh destructure to see it -
//same reasoning as docx-import.test.js.
function freshFileManager(){
  delete require.cache[fileManagerPath];
  return require(fileManagerPath);
}

function tempDir(){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warewoolf-file-manager-'));
  return dir;
}

//Keep any incidental real logError call (from a test that isn't specifically asserting on
//logging) out of the repo's cwd instead of the default bare "error_log.txt".
test.before(function(){
  errorLog.setLogDirectory(tempDir());
});

async function buildZipFixture(destPath, entries){
  await new Promise(function(resolve, reject){
    const output = fs.createWriteStream(destPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);

    archive.pipe(output);
    entries.forEach(function(entry){
      archive.append(entry.content, { name: entry.name });
    });
    archive.finalize();
  });
}

//---------------------------------------------------------------------------
// copyFiles
//---------------------------------------------------------------------------

test('copyFiles copies a file to the destination', function(){
  const src = tempDir();
  const dest = tempDir();
  fs.writeFileSync(path.join(src, 'notes.txt'), 'hello');

  fileManager.copyFiles([path.join(src, 'notes.txt')], dest);

  assert.strictEqual(fs.readFileSync(path.join(dest, 'notes.txt'), 'utf8'), 'hello');
});

test('copyFiles copies a directory recursively', function(){
  const src = tempDir();
  const dest = tempDir();
  fs.mkdirSync(path.join(src, 'chapters'));
  fs.writeFileSync(path.join(src, 'chapters', 'ch1.txt'), 'once upon a time');

  fileManager.copyFiles([path.join(src, 'chapters')], dest);

  assert.strictEqual(fs.readFileSync(path.join(dest, 'chapters', 'ch1.txt'), 'utf8'), 'once upon a time');
});

//Regression: makeFilenameUniqueIfExists used to split on every "." in the FULL destination path,
//so a dot in a parent directory's name (not the filename) corrupted the uniquified path.
test('copyFiles regression: a dot in the destination directory name does not corrupt the uniquified path', function(){
  const src = tempDir();
  const destParent = tempDir();
  const dest = path.join(destParent, 'John.Doe');
  fs.mkdirSync(dest);

  fs.writeFileSync(path.join(src, 'notes.txt'), 'new content');
  fs.writeFileSync(path.join(dest, 'notes.txt'), 'existing content');

  fileManager.copyFiles([path.join(src, 'notes.txt')], dest);

  //The existing file must survive untouched, and the copy must land inside "John.Doe" as
  //"notes_copy.txt" - not scattered into a mangled sibling path like "John_copy.Doe/notes.txt".
  assert.strictEqual(fs.readFileSync(path.join(dest, 'notes.txt'), 'utf8'), 'existing content');
  assert.strictEqual(fs.readFileSync(path.join(dest, 'notes_copy.txt'), 'utf8'), 'new content');
  assert.ok(!fs.existsSync(path.join(destParent, 'John_copy.Doe')));
});

//Regression: a multi-dot filename lost everything between the first and last dot
//(e.g. "archive.tar.gz" -> "archive_copy.gz").
test('copyFiles regression: uniquifying a multi-dot filename keeps the full name, not just the final extension', function(){
  const src = tempDir();
  const dest = tempDir();

  fs.writeFileSync(path.join(src, 'archive.tar.gz'), 'new archive');
  fs.writeFileSync(path.join(dest, 'archive.tar.gz'), 'old archive');

  fileManager.copyFiles([path.join(src, 'archive.tar.gz')], dest);

  assert.strictEqual(fs.readFileSync(path.join(dest, 'archive.tar.gz'), 'utf8'), 'old archive');
  assert.strictEqual(fs.readFileSync(path.join(dest, 'archive.tar_copy.gz'), 'utf8'), 'new archive');
});

//Regression: when the colliding item is itself a directory with a dot in its name, it must not
//be treated as having a file extension.
test('copyFiles regression: uniquifying a directory with a dot in its own name does not split off a fake extension', function(){
  const src = tempDir();
  const dest = tempDir();

  fs.mkdirSync(path.join(src, 'My Project v1.2'));
  fs.writeFileSync(path.join(src, 'My Project v1.2', 'draft.txt'), 'new draft');
  fs.mkdirSync(path.join(dest, 'My Project v1.2'));
  fs.writeFileSync(path.join(dest, 'My Project v1.2', 'draft.txt'), 'old draft');

  fileManager.copyFiles([path.join(src, 'My Project v1.2')], dest);

  assert.strictEqual(fs.readFileSync(path.join(dest, 'My Project v1.2', 'draft.txt'), 'utf8'), 'old draft');
  assert.strictEqual(fs.readFileSync(path.join(dest, 'My Project v1.2_copy', 'draft.txt'), 'utf8'), 'new draft');
});

//Regression: copyFiles used to wrap the whole batch in one try/catch, so one missing/failing
//file aborted every file after it in the list.
test('copyFiles regression: a failing file in the batch does not stop the rest from copying', async function(){
  const logErrorMock = test.mock.method(errorLog, 'logError', function(){});
  const fm = freshFileManager();

  const src = tempDir();
  const dest = tempDir();
  fs.writeFileSync(path.join(src, 'ok.txt'), 'fine');

  fm.copyFiles([path.join(src, 'missing.txt'), path.join(src, 'ok.txt')], dest);

  assert.strictEqual(fs.readFileSync(path.join(dest, 'ok.txt'), 'utf8'), 'fine');
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

//---------------------------------------------------------------------------
// moveFiles
//---------------------------------------------------------------------------

test('moveFiles moves a file to the destination and removes the original', function(){
  const src = tempDir();
  const dest = tempDir();
  const srcFile = path.join(src, 'draft.txt');
  fs.writeFileSync(srcFile, 'moving day');

  fileManager.moveFiles([srcFile], dest);

  assert.strictEqual(fs.readFileSync(path.join(dest, 'draft.txt'), 'utf8'), 'moving day');
  assert.ok(!fs.existsSync(srcFile));
});

//Regression: moveFiles used fs.renameSync directly with no collision check, so cutting and
//pasting onto a file with the same name silently destroyed it - unlike copyFiles, which already
//protected against this via makeFilenameUniqueIfExists.
test('moveFiles regression: does not overwrite an existing file with the same name at the destination', function(){
  const src = tempDir();
  const dest = tempDir();
  const srcFile = path.join(src, 'draft.txt');
  fs.writeFileSync(srcFile, 'new version');
  fs.writeFileSync(path.join(dest, 'draft.txt'), 'do not lose me');

  fileManager.moveFiles([srcFile], dest);

  assert.strictEqual(fs.readFileSync(path.join(dest, 'draft.txt'), 'utf8'), 'do not lose me');
  assert.strictEqual(fs.readFileSync(path.join(dest, 'draft_copy.txt'), 'utf8'), 'new version');
});

test('moveFiles regression: a failing file in the batch does not stop the rest from moving', function(){
  test.mock.method(errorLog, 'logError', function(){});
  const fm = freshFileManager();

  const src = tempDir();
  const dest = tempDir();
  const srcFile = path.join(src, 'ok.txt');
  fs.writeFileSync(srcFile, 'fine');

  fm.moveFiles([path.join(src, 'missing.txt'), srcFile], dest);

  assert.strictEqual(fs.readFileSync(path.join(dest, 'ok.txt'), 'utf8'), 'fine');
});

//---------------------------------------------------------------------------
// renameFiles
//---------------------------------------------------------------------------

test('renameFiles renames a single file', function(){
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'old.txt'), 'content');

  fileManager.renameFiles(['old.txt'], 'new.txt', dir);

  assert.strictEqual(fs.readFileSync(path.join(dir, 'new.txt'), 'utf8'), 'content');
  assert.ok(!fs.existsSync(path.join(dir, 'old.txt')));
});

//Regression: renameFiles used fs.renameSync directly, so renaming onto an existing filename
//silently destroyed the other file with no warning.
test('renameFiles regression: refuses to overwrite an existing file and logs instead of destroying it', function(){
  const logErrorMock = test.mock.method(errorLog, 'logError', function(){});
  const fm = freshFileManager();

  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'A content');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'B content');

  fm.renameFiles(['a.txt'], 'b.txt', dir);

  assert.strictEqual(fs.readFileSync(path.join(dir, 'b.txt'), 'utf8'), 'B content');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'A content');
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

test('renameFiles renaming a file to its own current name is a no-op, not an error', function(){
  const logErrorMock = test.mock.method(errorLog, 'logError', function(){});
  const fm = freshFileManager();

  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'A content');

  fm.renameFiles(['a.txt'], 'a.txt', dir);

  assert.strictEqual(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'A content');
  assert.strictEqual(logErrorMock.mock.calls.length, 0);
});

test('renameFiles batch-renames multiple files, numbering them and keeping each original extension', function(){
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'one.txt'), 'one');
  fs.writeFileSync(path.join(dir, 'two.txt'), 'two');

  fileManager.renameFiles(['one.txt', 'two.txt'], 'chapter', dir);

  assert.strictEqual(fs.readFileSync(path.join(dir, 'chapter_0.txt'), 'utf8'), 'one');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'chapter_1.txt'), 'utf8'), 'two');
});

//Regression: batch renaming used newName.split('.')[0] as the base, discarding everything after
//the FIRST dot in the new name (e.g. "My.Vacation.Photos" -> "My_0", "My_1"...). It should only
//strip the final extension-like segment.
test('renameFiles regression: a multi-dot new name keeps everything but the final segment', function(){
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b');

  fileManager.renameFiles(['a.txt', 'b.txt'], 'My.Vacation.Photos', dir);

  assert.ok(fs.existsSync(path.join(dir, 'My.Vacation_0.txt')));
  assert.ok(fs.existsSync(path.join(dir, 'My.Vacation_1.txt')));
});

test('renameFiles with an empty list does not throw', function(){
  const dir = tempDir();
  assert.doesNotThrow(function(){ fileManager.renameFiles([], 'whatever', dir); });
});

//---------------------------------------------------------------------------
// createNewDirectory
//---------------------------------------------------------------------------

test('createNewDirectory creates a new directory', function(){
  const dir = tempDir();
  fileManager.createNewDirectory('chapters', dir);
  assert.ok(fs.statSync(path.join(dir, 'chapters')).isDirectory());
});

test('createNewDirectory does not throw when the directory already exists', function(){
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, 'chapters'));
  assert.doesNotThrow(function(){ fileManager.createNewDirectory('chapters', dir); });
});

//---------------------------------------------------------------------------
// deleteFile
//---------------------------------------------------------------------------

test('deleteFile removes an existing file', function(){
  const dir = tempDir();
  const filePath = path.join(dir, 'gone.txt');
  fs.writeFileSync(filePath, 'bye');

  fileManager.deleteFile(filePath);

  assert.ok(!fs.existsSync(filePath));
});

test('deleteFile removes a directory recursively', function(){
  const dir = tempDir();
  const dirPath = path.join(dir, 'chapters');
  fs.mkdirSync(dirPath);
  fs.writeFileSync(path.join(dirPath, 'ch1.txt'), 'content');

  fileManager.deleteFile(dirPath);

  assert.ok(!fs.existsSync(dirPath));
});

test('deleteFile on a missing path does not throw', function(){
  const dir = tempDir();
  assert.doesNotThrow(function(){ fileManager.deleteFile(path.join(dir, 'missing.txt')); });
});

//---------------------------------------------------------------------------
// getParentDirectory
//---------------------------------------------------------------------------

test('getParentDirectory returns the containing directory', function(){
  assert.strictEqual(fileManager.getParentDirectory('/home/user/docs'), '/home/user');
});

//Regression: a root-level path like "/etc" has its only "/" at index 0, so the old
//`cutIndex > 0` check returned the path unchanged instead of climbing to "/".
test('getParentDirectory regression: a root-level path climbs to "/" instead of staying put', function(){
  assert.strictEqual(fileManager.getParentDirectory('/etc'), '/');
});

test('getParentDirectory on a bare drive letter stays put (nothing above it)', function(){
  assert.strictEqual(fileManager.getParentDirectory('C:'), 'C:');
});

//---------------------------------------------------------------------------
// getFileList
//---------------------------------------------------------------------------

test('getFileList lists files and directories, filtering out dotfiles', function(){
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'visible.txt'), '');
  fs.writeFileSync(path.join(dir, '.hidden'), '');
  fs.mkdirSync(path.join(dir, 'subdir'));

  const names = fileManager.getFileList(dir).map(function(d){ return d.name; }).sort();

  assert.deepStrictEqual(names, ['subdir', 'visible.txt']);
});

test('getFileList on a missing directory logs an error and does not throw', function(){
  const logErrorMock = test.mock.method(errorLog, 'logError', function(){});
  const fm = freshFileManager();

  assert.doesNotThrow(function(){ fm.getFileList(path.join(tempDir(), 'does-not-exist')); });
  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});

//---------------------------------------------------------------------------
// thisFileExists
//---------------------------------------------------------------------------

test('thisFileExists returns true for an existing path and false for a missing one', function(){
  const dir = tempDir();
  const filePath = path.join(dir, 'here.txt');
  fs.writeFileSync(filePath, '');

  assert.strictEqual(fileManager.thisFileExists(filePath), true);
  assert.strictEqual(fileManager.thisFileExists(path.join(dir, 'not-here.txt')), false);
});

//---------------------------------------------------------------------------
// unzipProject
//---------------------------------------------------------------------------

test('unzipProject extracts a zip and calls back once extraction is complete', async function(){
  const dir = tempDir();
  const zipPath = path.join(dir, 'project.zip');
  await buildZipFixture(zipPath, [{ name: 'book.md', content: 'chapter one' }]);

  await new Promise(function(resolve){
    fileManager.unzipProject(zipPath, resolve);
  });

  assert.strictEqual(fs.readFileSync(path.join(dir, 'project', 'book.md'), 'utf8'), 'chapter one');
});

//Regression: extractPath used zipPath.replace('.zip', ''), which rewrites the FIRST occurrence
//of that substring anywhere in the path - a directory name containing ".zip" corrupted the
//extraction path instead of only the trailing extension being stripped.
test('unzipProject regression: only strips the trailing ".zip", not an earlier occurrence in the path', async function(){
  const dir = tempDir();
  const oddDir = path.join(dir, 'archive.zipfiles');
  fs.mkdirSync(oddDir);
  const zipPath = path.join(oddDir, 'data.zip');
  await buildZipFixture(zipPath, [{ name: 'book.md', content: 'chapter one' }]);

  await new Promise(function(resolve){
    fileManager.unzipProject(zipPath, resolve);
  });

  assert.strictEqual(fs.readFileSync(path.join(oddDir, 'data', 'book.md'), 'utf8'), 'chapter one');
});

//Regression: a corrupt zip fails asynchronously via the extraction stream's 'error' event, which
//previously had no listener - an unhandled stream error can crash the process instead of being
//reported through logError like every other failure path in this module.
test('unzipProject regression: a corrupt zip is reported via logError instead of crashing', async function(){
  const errorLogged = new Promise(function(resolve){
    test.mock.method(errorLog, 'logError', function(err){
      resolve(err);
    });
  });
  const fm = freshFileManager();

  const dir = tempDir();
  const zipPath = path.join(dir, 'corrupt.zip');
  fs.writeFileSync(zipPath, 'not actually a zip file');

  fm.unzipProject(zipPath, function(){
    assert.fail('callback should not fire for a corrupt zip');
  });

  const err = await errorLogged;
  assert.ok(err);
});

test('unzipProject on a non-zip path logs an error and does not invoke the callback', function(){
  const logErrorMock = test.mock.method(errorLog, 'logError', function(){});
  const fm = freshFileManager();

  const dir = tempDir();
  const notAZip = path.join(dir, 'notes.txt');
  fs.writeFileSync(notAZip, 'just text');

  fm.unzipProject(notAZip, function(){
    assert.fail('callback should not fire for a non-zip path');
  });

  assert.strictEqual(logErrorMock.mock.calls.length, 1);
});
