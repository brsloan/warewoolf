//Reads the renderer's actual security posture back off a running packaged build.
//
//Written for the sandbox decision at Phase 9b and kept for the Pi pass that decision is gated on.
//The point is that "nothing broke" is worthless evidence if the flag was silently ignored: this
//distinguishes requested from effective. On Windows, `sandbox: true` gives Tab sandboxed=true and
//`sandbox: false` gives Tab sandboxed=false, so the flag is real there. Whether it is real on the
//Pi - where the OS sandbox needs unprivileged user namespaces or a correctly SUID chrome-sandbox
//in the installed tree - is the open question, and this is what answers it.
//
//  npm run package && node test/driven/sandbox-probe.js
//  WAREWOOLF_EXE=/opt/WareWoolf/warewoolf node test/driven/sandbox-probe.js
//
//A Tab reporting sandboxed=false while index.js asks for sandbox:true means the OS sandbox is not
//actually available on that machine, which is the failure to catch BEFORE shipping a kiosk build.
const { spawn } = require('child_process');
const { waitForTarget, connect } = require('./cdp');
const { resolveExe, freshUserData } = require('./app-path');

const RENDERER_PORT = Number(process.env.WAREWOOLF_CDP_PORT || 9223);
const MAIN_PORT = Number(process.env.WAREWOOLF_INSPECT_PORT || 9230);

async function main(){
  const exe = resolveExe();
  const userData = freshUserData();
  console.log('app: ' + exe + '\n');

  const child = spawn(exe, [
    '--user-data-dir=' + userData,
    '--remote-debugging-port=' + RENDERER_PORT,
    '--inspect=' + MAIN_PORT
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', function(){});
  child.stderr.on('data', function(){});

  let main_ = null;
  let exitCode = 0;
  try {
    await waitForTarget(RENDERER_PORT, function(t){ return t.type === 'page'; }, 40000);
    const mt = await waitForTarget(MAIN_PORT, function(){ return true; }, 20000);
    main_ = await connect(mt.webSocketDebuggerUrl);
    await main_.send('Runtime.enable');

    const prefs = await main_.send('Runtime.evaluate', {
      expression: `JSON.stringify((function(){
        var e = process.mainModule.require('electron');
        var w = e.BrowserWindow.getAllWindows()[0];
        var p = w.webContents.getLastWebPreferences() || {};
        return {
          contextIsolation: p.contextIsolation,
          nodeIntegration: p.nodeIntegration,
          requestedSandbox: p.sandbox,
          noSandboxSwitch: e.app.commandLine.hasSwitch('no-sandbox')
        };
      })())`,
      returnByValue: true
    });
    const p = JSON.parse(prefs.result.value);
    console.log('requested (webPreferences):');
    console.log('  contextIsolation : ' + p.contextIsolation);
    console.log('  nodeIntegration  : ' + p.nodeIntegration);
    console.log('  sandbox          : ' + p.requestedSandbox);
    console.log('  --no-sandbox     : ' + p.noSandboxSwitch);

    //Electron's own accounting of its child processes. This is the effective answer, not the ask.
    const metrics = await main_.send('Runtime.evaluate', {
      expression: `JSON.stringify(process.mainModule.require('electron').app.getAppMetrics()
        .map(function(m){ return { type: m.type, sandboxed: m.sandboxed }; }))`,
      returnByValue: true
    });
    const procs = JSON.parse(metrics.result.value);
    console.log('\neffective (getAppMetrics):');
    procs.forEach(function(m){
      console.log('  ' + String(m.type).padEnd(9) + ' sandboxed=' + m.sandboxed);
    });

    const tab = procs.filter(function(m){ return m.type === 'Tab'; })[0];
    console.log('');
    if(p.contextIsolation !== true){
      console.log('WRONG: contextIsolation is not true. Phase 9b regressed.');
      exitCode = 1;
    }
    if(p.nodeIntegration === true){
      console.log('WRONG: nodeIntegration is on.');
      exitCode = 1;
    }
    if(tab == null){
      console.log('INCONCLUSIVE: no Tab process in the metrics.');
      exitCode = 1;
    }
    else if(p.requestedSandbox === true && tab.sandboxed !== true){
      console.log('WRONG: sandbox:true was asked for and the renderer is NOT sandboxed. On Linux '
        + 'this usually means unprivileged user namespaces are off or chrome-sandbox is not SUID '
        + 'in the installed tree. Do not ship sandbox:true on this platform yet.');
      exitCode = 1;
    }
    else if(p.requestedSandbox === true){
      console.log('OK: sandbox:true is asked for and effective on this platform.');
    }
    else {
      console.log('OK: sandbox is off by choice (Phase 9b), and the renderer reports sandboxed='
        + tab.sandboxed + ' to match.');
    }
  }
  catch(err){
    console.log('PROBE FAILED: ' + err.message);
    exitCode = 1;
  }
  finally {
    try {
      if(main_) await main_.send('Runtime.evaluate', {
        expression: "process.mainModule.require('electron').app.exit(0)" });
    } catch(e){}
    if(main_) main_.close();
    setTimeout(function(){
      try { child.kill('SIGKILL'); } catch(e){}
      process.exit(exitCode);
    }, 1500);
  }
}

main();
