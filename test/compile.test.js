require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const unzipper = require('unzipper');
const docx = require('docx');

const { makeChapter, makeProject } = require('./helpers');
const { compileProject, compileChapterDeltas } = require('../src/components/controllers/compile');

//The modules under test hold their own createPlatform(createIpcBacking()) instance and reach the
//machine through window.warewoolf, exactly as they do in the app. This puts a bridge there, with a
//real node backing (and a real structured-clone boundary) behind it - so these tests still assert
//against real files in real temp directories, and now also prove the arguments and results survive
//being sent somewhere.
const { installBridge, uninstallBridge } = require('./fake-bridge');

test.before(function(){ installBridge(); });
test.after(uninstallBridge);

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

  await assert.doesNotReject(function(){
    return compileProject(project, userSettings, options, filepath);
  });

  await waitForFile(filepath, 2000);

  var dir = await unzipper.Open.file(filepath);
  var documentXml = (await dir.files.find(f => f.path === 'word/document.xml').buffer()).toString();
  assert.ok(documentXml.includes('Some prose.'), 'compiled .docx is missing the chapter text');
});

//Regression: compileDocx awaited saveDocx's completion callback and discarded the result outright.
//saveDocx never rejects - a packing failure resolves the string 'error' instead (see
//delta-to-docx.js) - so with nothing checking that value, compileProject reached its unconditional
//cback() exactly as if the write had succeeded, and compile_display.js reported the compile done
//while the .docx did not exist on disk. That silently loses a manuscript export the writer believes
//they have.
test('compileProject rejects instead of silently reporting success when the .docx write fails', async function(t){
  const packError = new Error('packing failed');
  t.mock.method(docx.Packer, 'toBlob', function(){ return Promise.reject(packError); });

  var chap = makeChapter(textDelta('Some prose.'));
  var project = makeTestProject([chap]);
  var userSettings = { addressInfo: null };
  var options = { type: '.docx', insertStrng: '***', insertHead: false, generateTitlePage: false, styleHeadingAsChapter: true };
  var filepath = tempFilePath(t, '.docx');

  await assert.rejects(function(){
    return compileProject(project, userSettings, options, filepath);
  }, /saveDocx failed to write/);

  assert.strictEqual(fs.existsSync(filepath), false,
    'expected no .docx file on disk when the packing step failed');
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
  await compileProject(project, {}, options, filepath, function(){
    callbackFired = true;
  });

  assert.strictEqual(callbackFired, false, 'epub callback should not fire synchronously');

  await waitForEpub(filepath, 2000);
  assert.strictEqual(callbackFired, true, 'epub callback should have fired by the time the archive is readable');
});

test('compileProject does not throw when called without a callback (legacy call shape)', async function(t){
  var chap = makeChapter(textDelta('Some text.'));
  var project = makeTestProject([chap]);
  var options = { type: '.mdfc', insertStrng: '***', insertHead: false };
  var filepath = tempFilePath(t, '.mdfc');

  await assert.doesNotReject(function(){
    return compileProject(project, {}, options, filepath);
  });
});

//Regression: whole-project compile concatenates every chapter into one delta before converting it,
//but each chapter numbers its own footnotes independently starting at 1 - so two chapters that each
//had a "note 1" collided into duplicate id="fnote_1" anchors in the compiled HTML/EPUB, wrong
//backlinks, and delta-to-docx resolving every "[^1]" reference to whichever chapter's body came
//first. Reconciling the concatenated copy renumbers globally instead.
test('compileProject renumbers footnotes across chapters instead of colliding on duplicate numbers', async function(t){
  var chap1 = makeChapter({ ops: [
    { insert: 'first chapter' }, { insert: { footnote: { n: '1' } } }, { insert: '\n' },
    { insert: 'note in chapter one' }, { insert: '\n', attributes: { footnoteBody: '1' } }
  ]});
  var chap2 = makeChapter({ ops: [
    { insert: 'second chapter' }, { insert: { footnote: { n: '1' } } }, { insert: '\n' },
    { insert: 'note in chapter two' }, { insert: '\n', attributes: { footnoteBody: '1' } }
  ]});
  var project = makeTestProject([chap1, chap2]);
  var options = { type: '.mdfc', insertStrng: '***', insertHead: false };
  var filepath = tempFilePath(t, '.mdfc');

  await compileProject(project, {}, options, filepath);

  var text = fs.readFileSync(filepath, 'utf8');

  assert.match(text, /first chapter\[\^1\]/);
  assert.match(text, /\[\^1\]: note in chapter one/);
  assert.match(text, /second chapter\[\^2\]/);
  assert.match(text, /\[\^2\]: note in chapter two/);
});

test('compileChapterDeltas does not leak an implicit global "i"', async function(){
  delete global.i;

  var chapters = [makeChapter(textDelta('One')), makeChapter(textDelta('Two')), makeChapter(textDelta('Three'))];
  var project = makeTestProject(chapters);

  await compileChapterDeltas(project, { insertStrng: '***', insertHead: false });

  assert.strictEqual(typeof global.i, 'undefined', 'compileChapterDeltas leaked "i" as an implicit global');
});

test('compileChapterDeltas inserts the divider between chapters and a header per chapter when requested', async function(){
  var chap1 = makeChapter(textDelta('First chapter text.'));
  var chap2 = makeChapter(textDelta('Second chapter text.'));
  var project = makeTestProject([chap1, chap2]);

  var compiled = await compileChapterDeltas(project, { insertStrng: '***', insertHead: true });

  //Adjacent plain-text inserts get merged by Delta.concat, so assert on the full joined text and op
  //order rather than looking for each title as its own op.
  var fullText = compiled.ops.map(op => op.insert).join('');
  assert.ok(/Chapter 1[\s\S]*First chapter text\.[\s\S]*\*\*\*[\s\S]*Chapter 2[\s\S]*Second chapter text\./.test(fullText),
    'expected title, divider and body text in order, got: ' + fullText);

  var headerOps = compiled.ops.filter(op => op.attributes && op.attributes.header === 1);
  assert.strictEqual(headerOps.length, 2, 'expected one heading op per chapter');
});

test('compileChapterDeltas omits headers when insertHead is false', async function(){
  var chap1 = makeChapter(textDelta('First chapter text.'));
  var project = makeTestProject([chap1]);

  var compiled = await compileChapterDeltas(project, { insertStrng: '***', insertHead: false });
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

  await compileProject(project, userSettings, options, filepath);

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

  await compileProject(project, userSettings, options, filepath);

  var dir = await waitForEpub(filepath, 2000);
  var chapterEntry = dir.files.find(f => f.path === 'OEBPS/chapter_1.xhtml');
  var chapterHtml = (await chapterEntry.buffer()).toString('utf8');

  assert.doesNotMatch(chapterHtml, /<h1>/);
  assert.match(chapterHtml, /Some epub prose\./);
});

//Regression: compileProject unconditionally console.log'd the raw options object and filepath on
//every call, left over from debugging.
test('compileProject does not dump options/filepath to the console', async function(t){
  var chap = makeChapter(textDelta('Text.'));
  var project = makeTestProject([chap]);
  var options = { type: '.mdfc', insertStrng: '***', insertHead: false };
  var filepath = tempFilePath(t, '.mdfc');

  var originalLog = console.log;
  var loggedArgs = [];
  console.log = function(){ loggedArgs.push(Array.from(arguments)); };
  t.after(function(){ console.log = originalLog; });

  await compileProject(project, {}, options, filepath);

  console.log = originalLog;

  var loggedOptionsDirectly = loggedArgs.some(function(args){ return args[0] === options; });
  var loggedFilepathAlone = loggedArgs.some(function(args){ return args.length === 1 && args[0] === filepath; });

  assert.ok(!loggedOptionsDirectly, 'compileProject still logs the raw options object');
  assert.ok(!loggedFilepathAlone, 'compileProject still logs the raw filepath');
});

//---- Mark scene breaks ----

//The gap between two scenes is marked on each chapter separately, before they are joined, so the
//blank lines a writer leaves trailing at the bottom of a chapter never end up looking like a gap
//between two paragraphs once the next chapter is concatenated onto them.
function sceneDelta(){
  var ops = [];
  Array.prototype.forEach.call(arguments, function(line){
    if(line !== '')
      ops.push({ insert: line });
    ops.push({ insert: '\n' });
  });
  return { ops: ops };
}

test('compileChapterDeltas marks scene breaks when the option is on', async function(){
  var chap = makeChapter(sceneDelta('One.', '', 'Two.'));
  var project = makeTestProject([chap]);

  var compiled = await compileChapterDeltas(project, { insertStrng: '', insertHead: false, markSceneBreaks: true });
  var centered = compiled.ops.filter(function(op){ return op.attributes && op.attributes.align === 'center'; });

  assert.strictEqual(centered.length, 1, 'expected the blank line between the two paragraphs to be centered');
  assert.match(compiled.ops.map(function(op){ return op.insert; }).join(''), /One\.\n#\nTwo\./);
});

test('compileChapterDeltas leaves blank lines alone when the option is off', async function(){
  var chap = makeChapter(sceneDelta('One.', '', 'Two.'));
  var project = makeTestProject([chap]);

  var compiled = await compileChapterDeltas(project, { insertStrng: '', insertHead: false, markSceneBreaks: false });

  assert.strictEqual(compiled.ops.map(function(op){ return op.insert; }).join(''), 'One.\n\nTwo.\n');
});

test('compileChapterDeltas does not mark trailing blank lines once the next chapter follows them', async function(){
  var chap1 = makeChapter(sceneDelta('One.', '', ''));
  var chap2 = makeChapter(sceneDelta('Two.'));
  var project = makeTestProject([chap1, chap2]);

  var compiled = await compileChapterDeltas(project, { insertStrng: '', insertHead: false, markSceneBreaks: true });
  var centered = compiled.ops.filter(function(op){ return op.attributes && op.attributes.align === 'center'; });

  assert.strictEqual(centered.length, 0, 'the blank lines at the end of a chapter are not a scene break');
});

test('compileChapterDeltas does not mark the blank line under an inserted chapter heading', async function(){
  var chap = makeChapter(sceneDelta('', 'One.', '', 'Two.'));
  var project = makeTestProject([chap]);

  var compiled = await compileChapterDeltas(project, { insertStrng: '', insertHead: true, markSceneBreaks: true });
  var centered = compiled.ops.filter(function(op){ return op.attributes && op.attributes.align === 'center'; });

  assert.strictEqual(centered.length, 1, 'only the gap between the two paragraphs should be marked');
});

test('compileProject writes the scene-break mark into an epub chapter', async function(t){
  var chap = makeChapter(sceneDelta('One.', '', 'Two.'));
  chap.title = 'Chapter One';
  var project = makeTestProject([chap]);
  var options = { type: '.epub', insertStrng: '', insertHead: false, generateTitlePage: false, markSceneBreaks: true };
  var filepath = tempFilePath(t, '.epub');

  await compileProject(project, { addressInfo: null }, options, filepath);

  var dir = await waitForEpub(filepath, 2000);
  var chapterEntry = dir.files.find(function(f){ return f.path === 'OEBPS/chapter_1.xhtml'; });
  var chapterHtml = (await chapterEntry.buffer()).toString('utf8');

  assert.match(chapterHtml, /class="center">#</);
});

