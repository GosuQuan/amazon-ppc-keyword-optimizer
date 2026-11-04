'use strict';
const fs = require('fs');
const path = require('path');

const token = process.env.SHOT_TOKEN;
const port = process.env.SHOT_PORT || '9333';
const outDir = path.resolve('docs/原型截图');
if (!token) throw new Error('missing token');

async function cdp(ws, method, params = {}, sessionId) {
  const id = cdp.next++;
  const message = { id, method, params };
  if (sessionId) message.sessionId = sessionId;
  ws.send(JSON.stringify(message));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout ' + method)), 20000);
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

async function shoot(ws, sessionId, name, url) {
  await cdp(ws, 'Page.navigate', { url }, sessionId);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png' }, sessionId);
  const file = path.join(outDir, name + '.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log(name, fs.statSync(file).size);
}

(async () => {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  const { targetId } = await cdp(ws, 'Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: true });
  await cdp(ws, 'Page.enable', {}, sessionId);
  await cdp(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: `sessionStorage.setItem('ppc_token', ${JSON.stringify(token)});` }, sessionId);
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: 1440, height: 1400, deviceScaleFactor: 1, mobile: false }, sessionId);
  await shoot(ws, sessionId, 'login', 'http://127.0.0.1:8790/login.html');
  await shoot(ws, sessionId, 'dashboard', 'http://127.0.0.1:8790/dashboard.html');
  await shoot(ws, sessionId, 'points', 'http://127.0.0.1:8790/points.html');
  await shoot(ws, sessionId, 'workflow', 'http://127.0.0.1:8790/workflow.html');
  ws.close();
})().catch((error) => { console.error(error); process.exit(1); });
