require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const unzipper = require('unzipper');

const { makeChapter, makeProject } = require('./helpers');
const { compileProject, compileChapterDeltas } = require('../src/components/controllers/compile');

function textDelta(text){
  return { ops: [ { insert: text }, { insert: '\n' } ] };
}

function tempFilePath(t, ext){
  const filepath = path.join(os.tmpdir(), 'compile-test-' + Date.now() + '-' + Math.random().toString(36).slice(2) + ext);
  t.after(function(){
    if(fs.existsSync(filepath))
      fs.unlinkSync(filepath);
  });
  return filepath;
}

//docx is written synchronously (fs.writeFileSync) once docx.Packer.toBuffer's promise resolves, so
//once the file shows up on disk it is complete - just wait for it to appear.
async function waitForFile(filepath, timeoutMs){
  const start = Date.now();
  while(!fs.existsSync(filepath)){
    if(Date.now() - start > timeoutMs)
      throw new Error('timed out waiting for file: ' + filepath);
    await new Promise(function(r){ setTimeout(r, 20); });
  }
}

//Epub is written via a zip archive stream, so the file can exist on disk before the archive's
//central directory is fully flushed. Retry opening it as a zip until that succeeds.
async function waitForEpub(filepath, timeoutMs){
  const start = Date.now();
  while(true){
    if(fs.existsSync(filepath)){
      try{
        return await unzipper.Open.file(filepath);
      }
      catch(err){ /* not fully written yet */ }
    }
    if(Date.now() - start > timeoutMs)
      throw new Error('timed out waiting for epub: ' + filepath);
    await new Promise(function(r){ setTimeout(r, 20); });
  }
}

function makeTestProject(chapters){
  chapters.forEach(function(chap, i){
    //newChapter() defaults title to the literal string 'new' - only fill in a title if the test
    //didn't already set a real one.
    if(chap.title === 'new')
      chap.title = 'Chapter ' + (i + 1);
  });
  var project = makeProject(chapters);
  project.title = 'Test Project';
  project.author = 'Test Author';
  return project;
}

//Regression: compileDocx referenced the bare identifiers `project` and `userSettings`, which were
//never parameters, module-scoped variables, or passed through from compileProject/compile_display.
//Compiling to .docx always threw a ReferenceError before this fix, and since compileDocx (unlike
//every other compile* function) had no try/catch, it wasn't even caught and logged.
test('compileProject writes a .docx file instead of throwing when project/userSettings are missing from the call chain', async function(t){
  var chap = makeChapter(textDelta('Some prose.'));
  var project = makeTestProject([chap]);
  var userSettings = { addressInfo: null };
  var options = { type: '.docx', insertStrng: '***', insertHead: false, generateTitlePage: false, styleHeadingAsChapter: true };
  var filepath = tempFilePath(t, '.docx');

  assert.doesNotThrow(function(){
    compileProject(project, userSettings, options, filepath);
  });

  await waitForFile(filepath, 2000);

  var dir = await unzipper.Open.file(filepath);
  var documentXml = (await dir.files.find(f => f.path === 'word/document.xml').buffer()).toString();
  assert.ok(documentXml.includes('Some prose.'), 'compiled .docx is missing the chapter text');
});

//Regression: compileProject/compileEpub had no way to signal completion, so compile_display.js
//had to hideWorking() and close its popup immediately after calling compileProject - fine for the
//synchronous formats, but wrong for .epub, whose archive write finishes asynchronously.
test('compileProject invokes its callback once a synchronous format has finished writing', async function(t){
  var chap = makeChapter(textDelta('Some text.'));
  var project = makeTestProject([chap]);
  var options = { type: '.md', insertStrng: '***', insertHead: false };
  var filepath = tempFilePath(t, '.md');

  await new Promise(function(resolve){
    compileProject(project, {}, options, filepath, resolve);
  });

  assert.ok(fs.existsSync(filepath), 'expected the .md file to exist once the callback fired');
});

test('compileProject callback for .epub only fires once the archive has actually finished writing, not synchronously', async function(t){
  var chap = makeChapter(textDelta('Epub text.'));
  chap.title = 'Chapter One';
  var project = makeTestProject([chap]);
  var options = { type: '.epub', insertStrng: '***', insertHead: false, generateTitlePage: false };
  var filepath = tempFilePath(t, '.epub');

  var callbackFired = false;
  compileProject(project, {}, options, filepath, function(){
    callbackFired = true;
  });

  assert.strictEqual(callbackFired, false, 'epub callback should not fire synchronously');

  await waitForEpub(filepath, 2000);
  assert.strictEqual(callbackFired, true, 'epub callback should have fired by the time the archive is readable');
});

test('compileProject does not throw when called without a callback (legacy call shape)', function(t){
  var chap = makeChapter(textDelta('Some text.'));
  var project = makeTestProject([chap]);
  var options = { type: '.mdfc', insertStrng: '***', insertHead: false };
  var filepath = tempFilePath(t, '.mdfc');

  assert.doesNotThrow(function(){
    compileProject(project, {}, options, filepath);
  });
});

test('compileChapterDeltas does not leak an implicit global "i"', function(){
  delete global.i;

  var chapters = [makeChapter(textDelta('One')), makeChapter(textDelta('Two')), makeChapter(textDelta('Three'))];
  var project = makeTestProject(chapters);

  compileChapterDeltas(project, { insertStrng: '***', insertHead: false });

  assert.strictEqual(typeof global.i, 'undefined', 'compileChapterDeltas leaked "i" as an implicit global');
});

test('compileChapterDeltas inserts the divider between chapters and a header per chapter when requested', function(){
  var chap1 = makeChapter(textDelta('First chapter text.'));
  var chap2 = makeChapter(textDelta('Second chapter text.'));
  var project = makeTestProject([chap1, chap2]);

  var compiled = compileChapterDeltas(project, { insertStrng: '***', insertHead: true });

  //Adjacent plain-text inserts get merged by Delta.concat, so assert on the full joined text and op
  //order rather than looking for each title as its own op.
  var fullText = compiled.ops.map(op => op.insert).join('');
  assert.ok(/Chapter 1[\s\S]*First chapter text\.[\s\S]*\*\*\*[\s\S]*Chapter 2[\s\S]*Second chapter text\./.test(fullText),
    'expected title, divider and body text in order, got: ' + fullText);

  var headerOps = compiled.ops.filter(op => op.attributes && op.attributes.header === 1);
  assert.strictEqual(headerOps.length, 2, 'expected one heading op per chapter');
});

test('compileChapterDeltas omits headers when insertHead is false', function(){
  var chap1 = makeChapter(textDelta('First chapter text.'));
  var project = makeTestProject([chap1]);

  var compiled = compileChapterDeltas(project, { insertStrng: '***', insertHead: false });
  var headerOps = compiled.ops.filter(op => op.attributes && op.attributes.header === 1);

  assert.strictEqual(headerOps.length, 0);
});

//Regression: compileEpub bypassed compileChapterDeltas entirely and never looked at options, so the
//"Insert chapter titles as headings" checkbox had no effect on .epub output even though it worked
//for every other compile format.
test('compileProject inserts a heading into each epub chapter when insertHead is true', async function(t){
  var chap = makeChapter(textDelta('Some epub prose.'));
  chap.title = 'Chapter One';
  var project = makeTestProject([chap]);
  var userSettings = { addressInfo: null };
  var options = { type: '.epub', insertStrng: '***', insertHead: true, generateTitlePage: false };
  var filepath = tempFilePath(t, '.epub');

  compileProject(project, userSettings, options, filepath);

  var dir = await waitForEpub(filepath, 2000);
  var chapterEntry = dir.files.find(f => f.path === 'OEBPS/chapter_1.xhtml');
  assert.ok(chapterEntry, 'missing epub chapter file');
  var chapterHtml = (await chapterEntry.buffer()).toString('utf8');

  assert.match(chapterHtml, /<h1>Chapter One<\/h1>/);
  assert.match(chapterHtml, /Some epub prose\./);
});

test('compileProject leaves epub chapter body without a heading when insertHead is false', async function(t){
  var chap = makeChapter(textDelta('Some epub prose.'));
  chap.title = 'Chapter One';
  var project = makeTestProject([chap]);
  var userSettings = { addressInfo: null };
  var options = { type: '.epub', insertStrng: '***', insertHead: false, generateTitlePage: false };
  var filepath = tempFilePath(t, '.epub');

  compileProject(project, userSettings, options, filepath);

  var dir = await waitForEpub(filepath, 2000);
  var chapterEntry = dir.files.find(f => f.path === 'OEBPS/chapter_1.xhtml');
  var chapterHtml = (await chapterEntry.buffer()).toString('utf8');

  assert.doesNotMatch(chapterHtml, /<h1>/);
  assert.match(chapterHtml, /Some epub prose\./);
});

//Regression: compileProject unconditionally console.log'd the raw options object and filepath on
//every call, left over from debugging.
test('compileProject does not dump options/filepath to the console', function(t){
  var chap = makeChapter(textDelta('Text.'));
  var project = makeTestProject([chap]);
  var options = { type: '.mdfc', insertStrng: '***', insertHead: false };
  var filepath = tempFilePath(t, '.mdfc');

  var originalLog = console.log;
  var loggedArgs = [];
  console.log = function(){ loggedArgs.push(Array.from(arguments)); };
  t.after(function(){ console.log = originalLog; });

  compileProject(project, {}, options, filepath);

  console.log = originalLog;

  var loggedOptionsDirectly = loggedArgs.some(function(args){ return args[0] === options; });
  var loggedFilepathAlone = loggedArgs.some(function(args){ return args.length === 1 && args[0] === filepath; });

  assert.ok(!loggedOptionsDirectly, 'compileProject still logs the raw options object');
  assert.ok(!loggedFilepathAlone, 'compileProject still logs the raw filepath');
});
