'use strict';
/* CDP-driven YICOPY walkthrough + local prototype screenshots. No login, public pages only. */
const fs = require('fs');
const path = require('path');

const port = process.env.CDP_PORT || '9334';
const outDir = path.resolve('docs/对标快照');
fs.mkdirSync(outDir, { recursive: true });

async function cdp(ws, method, params = {}, sessionId) {
  const id = cdp.next++;
  const message = { id, method, params };
  if (sessionId) message.sessionId = sessionId;
  ws.send(JSON.stringify(message));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout ' + method)), 25000);
    function onMessage(event) {
      const data = JSON.parse(event.data);
      if (data.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      if (data.error) reject(new Error(JSON.stringify(data.error)));
      else resolve(data.result || {});
    }
    ws.addEventListener('message', onMessage);
  });
}
cdp.next = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function visit(ws, sessionId, name, url) {
  await cdp(ws, 'Page.navigate', { url }, sessionId);
  await sleep(3500);
  const shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png' }, sessionId);
  const file = path.join(outDir, name + '.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  const probe = 'document.title + " | buttons:" + document.querySelectorAll("button, a.btn").length + " | navLinks:" + document.querySelectorAll("nav a, header a").length';
  const title = await cdp(ws, 'Runtime.evaluate', { expression: probe, returnByValue: true }, sessionId);
  console.log(name, fs.statSync(file).size, JSON.stringify(title.result.value));
}

(async () => {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  const { targetId } = await cdp(ws, 'Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: true });
  await cdp(ws, 'Page.enable', {}, sessionId);
  await cdp(ws, 'Runtime.enable', {}, sessionId);
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false }, sessionId);

  await visit(ws, sessionId, 'yicopy-home', 'https://yicopy.com/');
  await visit(ws, sessionId, 'yicopy-tools', 'https://yicopy.com/tools');
  await visit(ws, sessionId, 'yicopy-traffic-structure', 'https://yicopy.com/tools/traffic-structure');
  await visit(ws, sessionId, 'yicopy-pricing', 'https://yicopy.com/pricing');
  await visit(ws, sessionId, 'yicopy-visual', 'https://yicopy.com/visual-studio');
  await visit(ws, sessionId, 'yicopy-ultra', 'https://yicopy.com/enterprise-agent');
  await visit(ws, sessionId, 'yicopy-extension', 'https://yicopy.com/extension-download');

  const local = process.env.LOCAL_SHOTS === '1';
  if (local) {
    const token = process.env.SHOT_TOKEN;
    if (token) await cdp(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: `sessionStorage.setItem('ppc_token', ${JSON.stringify(token)});` }, sessionId);
    await visit(ws, sessionId, 'local-login', 'http://127.0.0.1:8790/login.html');
    await visit(ws, sessionId, 'local-dashboard', 'http://127.0.0.1:8790/dashboard.html');
    await visit(ws, sessionId, 'local-workflow', 'http://127.0.0.1:8790/workflow.html');
  }
  ws.close();
  console.log('done');
})().catch((error) => { console.error(error); process.exit(1); });
