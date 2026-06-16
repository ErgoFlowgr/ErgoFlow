const http = require('http');
const WebSocket = require('ws');

const expression = process.argv.slice(2).join(' ');
if (!expression) {
  console.error('Usage: node scripts/cdp_eval_ergoflow.js <js-expression>');
  process.exit(2);
}

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: 9223, path }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

(async () => {
  const targets = await getJson('/json/list');
  const page = targets.find(t => t.type === 'page') || targets[0];
  if (!page || !page.webSocketDebuggerUrl) throw new Error('No page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1;
  const pending = new Map();
  ws.on('message', data => {
    const msg = JSON.parse(data.toString());
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  function send(method, params = {}) {
    return new Promise(resolve => {
      const msgId = id++;
      pending.set(msgId, resolve);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }
  await send('Runtime.enable');
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
    timeout: 10000,
  });
  console.log(JSON.stringify(result, null, 2));
  ws.close();
})().catch(err => { console.error(err.stack || err); process.exit(1); });
