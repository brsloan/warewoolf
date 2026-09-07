//Minimal CDP/inspector client - no dependencies, Node 22's global WebSocket.
const http = require('http');

function getJson(port, path){
  return new Promise(function(resolve, reject){
    const req = http.get({ host: '127.0.0.1', port: port, path: path }, function(res){
      let body = '';
      res.on('data', function(c){ body += c; });
      res.on('end', function(){
        try { resolve(JSON.parse(body)); } catch(e){ reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(2000, function(){ req.destroy(new Error('timeout')); });
  });
}

async function waitForTarget(port, predicate, timeoutMs){
  const deadline = Date.now() + (timeoutMs || 30000);
  let lastErr = null;
  while(Date.now() < deadline){
    try {
      const list = await getJson(port, '/json/list');
      const hit = list.filter(predicate)[0];
      if(hit) return hit;
    } catch(e){ lastErr = e; }
    await new Promise(function(r){ setTimeout(r, 250); });
  }
  throw new Error('no target on port ' + port + (lastErr ? ' (' + lastErr.message + ')' : ''));
}

function connect(wsUrl){
  return new Promise(function(resolve, reject){
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const events = [];
    ws.addEventListener('message', function(ev){
      const msg = JSON.parse(ev.data);
      if(msg.id != null && pending.has(msg.id)){
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if(msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      } else {
        events.push(msg);
      }
    });
    ws.addEventListener('error', function(){ reject(new Error('ws error ' + wsUrl)); });
    ws.addEventListener('open', function(){
      resolve({
        events: events,
        close: function(){ try { ws.close(); } catch(e){} },
        send: function(method, params){
          const myId = ++id;
          return new Promise(function(res, rej){
            pending.set(myId, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id: myId, method: method, params: params || {} }));
            setTimeout(function(){
              if(pending.has(myId)){ pending.delete(myId); rej(new Error(method + ' timed out')); }
            }, 30000);
          });
        }
      });
    });
  });
}

//Evaluates `expr` and returns its value by JSON round trip, so anything non-serializable is caught
//here rather than turning into "[object Object]" in a report.
async function evaluate(session, expr, opts){
  const r = await session.send('Runtime.evaluate', Object.assign({
    expression: '(async () => { return JSON.stringify(await (' + expr + ')); })()',
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  }, opts || {}));
  if(r.exceptionDetails)
    throw new Error('EVAL THREW: ' + (r.exceptionDetails.exception
      ? (r.exceptionDetails.exception.description || r.exceptionDetails.exception.value)
      : r.exceptionDetails.text));
  if(r.result.value === undefined) return undefined;
  return JSON.parse(r.result.value);
}

module.exports = { getJson, waitForTarget, connect, evaluate };
