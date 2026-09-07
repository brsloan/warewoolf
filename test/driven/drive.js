//Drives the PACKAGED app from a clean userData directory over CDP, and asserts against it.
//
//This is not part of `npm test` and must not become part of it: it launches a real window, needs a
//build that `npm run package` (or a .deb install) has already produced, and takes about a minute.
//`test/*.test.js` does not match this path, which is deliberate - see README.md here.
//
//Why it exists. The suite exercises the node backing directly and the bridge through a fake
//transport, and neither path runs with contextIsolation actually on. A green suite has failed to
//predict a working artifact five times in this project - the zstd .deb, the untested bundle, the
//close/finish guard, index.js not parsing, and the bundle's own output format at Phase 9b. Four of
//those were only findable against a packaged build. This is how you find the next one.
//
//  npm run package && node test/driven/drive.js
//  WAREWOOLF_EXE=/opt/WareWoolf/warewoolf node test/driven/drive.js
//
//Two debug channels are opened, and both are needed: --remote-debugging-port reaches the renderer,
//and --inspect reaches the main process, which is the only way to send a menu channel the way a
//menu click sends it rather than by calling the handler the renderer registered.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { waitForTarget, connect, evaluate } = require('./cdp');
const { resolveExe, freshUserData } = require('./app-path');

const RENDERER_PORT = Number(process.env.WAREWOOLF_CDP_PORT || 9222);
const MAIN_PORT = Number(process.env.WAREWOOLF_INSPECT_PORT || 9229);

const results = [];
function check(name, ok, detail){
  results.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name
    + (detail ? '\n        ' + String(detail).slice(0, 600) : ''));
}

async function main(){
  const exe = resolveExe();
  const userData = freshUserData();
  console.log('app      : ' + exe);
  console.log('userData : ' + userData + '  (clean)\n');

  const child = spawn(exe, [
    '--user-data-dir=' + userData,
    '--remote-debugging-port=' + RENDERER_PORT,
    '--remote-allow-origins=*',
    '--inspect=' + MAIN_PORT
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderr = '';
  child.stderr.on('data', function(c){ stderr += c; });
  child.stdout.on('data', function(){});
  child.on('exit', function(code){
    if(code !== 0 && code != null)
      console.log('\n!! the app exited on its own, code=' + code);
  });

  let page = null, main_ = null;
  try {
    const target = await waitForTarget(RENDERER_PORT, function(t){ return t.type === 'page'; }, 40000);
    page = await connect(target.webSocketDebuggerUrl);
    await page.send('Runtime.enable');
    await page.send('Console.enable').catch(function(){});

    //The renderer publishes its API under the global name index.html loads it with. Waiting on
    //`ready` is waiting on loadPlatformState() - getAppPaths, user settings, loadInitialProject.
    await evaluate(page, `(async function(){
      for(var i = 0; i < 300; i++){
        if(globalThis.warewoolfRenderer && globalThis.warewoolfRenderer.ready){
          await globalThis.warewoolfRenderer.ready;
          return true;
        }
        await new Promise(function(r){ setTimeout(r, 100); });
      }
      throw new Error('the renderer never became ready - warewoolfRenderer was never published');
    })()`);

    const mainTarget = await waitForTarget(MAIN_PORT, function(){ return true; }, 20000);
    main_ = await connect(mainTarget.webSocketDebuggerUrl);
    await main_.send('Runtime.enable');

    await require('./checks')({ page, main_, check, evaluate, userData });
  }
  catch(err){
    check('the driven pass ran to completion', false,
      err.message + '\n--- app stderr ---\n' + stderr.slice(-1500));
  }
  finally {
    try {
      if(main_) await main_.send('Runtime.evaluate', {
        expression: "process.mainModule.require('electron').app.exit(0)" });
    } catch(e){}
    if(page) page.close();
    if(main_) main_.close();
    setTimeout(function(){ try { child.kill('SIGKILL'); } catch(e){} }, 1500);
  }

  const failed = results.filter(function(r){ return !r.ok; });
  console.log('\n==== ' + (results.length - failed.length) + '/' + results.length
    + ' checks passed ====');
  if(failed.length){
    console.log('FAILED:');
    failed.forEach(function(f){ console.log('  - ' + f.name); });
  }

  const out = path.join(__dirname, 'results.json');
  fs.writeFileSync(out, JSON.stringify({
    app: exe, platform: process.platform, arch: process.arch,
    when: new Date().toISOString(), results: results
  }, null, 2));
  console.log('\nfull detail: ' + out);

  process.exit(failed.length ? 1 : 0);
}

main();
