'use strict';
/* Phase 2: after CDP login, drive the free-tool query flow and capture the workspace. */
const fs = require('fs');
const path = require('path');

const port = process.env.CDP_PORT || '9336';
const outDir = path.resolve('docs/对标快照');

async function cdp(ws, method, params = {}, sessionId) {
  const id = cdp.next++;
  const message = { id, method, params };
  if (sessionId) message.sessionId = sessionId;
  ws.send(JSON.stringify(message));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout ' + method)), 40000);
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

async function shot(ws, sessionId, name) {
  const data = await cdp(ws, 'Page.captureScreenshot', { format: 'png' }, sessionId);
  const file = path.join(outDir, name + '.png');
  fs.writeFileSync(file, Buffer.from(data.data, 'base64'));
  console.log('shot', name, fs.statSync(file).size);
}
async function evalJs(ws, sessionId, expression) {
  const result = await cdp(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  return result.result ? result.result.value : undefined;
}
async function shotFull(ws, sessionId, name) {
  const height = await evalJs(ws, sessionId, 'document.body.scrollHeight');
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: 1440, height: Math.min(Number(height) || 1200, 8000), deviceScaleFactor: 1, mobile: false }, sessionId);
  await sleep(800);
  await shot(ws, sessionId, name);
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false }, sessionId);
}

(async () => {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
  const pages = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const existing = pages.find((p) => p.type === 'page');
  const ws = new WebSocket(existing.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId: existing.id, flatten: true });
  await cdp(ws, 'Page.enable', {}, sessionId);
  await cdp(ws, 'Runtime.enable', {}, sessionId);

  // Login state lives in the tools subdomain context; re-open login modal and submit there first.
  await cdp(ws, 'Page.navigate', { url: 'https://yicopy.com/' }, sessionId);
  await sleep(3500);
  await evalJs(ws, sessionId, `[...document.querySelectorAll('button, a')].find((el) => (el.textContent || '').trim().includes('登录'))?.click()`);
  await sleep(2000);
  await evalJs(ws, sessionId, `[...document.querySelectorAll('button, a, [role=tab]')].find((el) => (el.textContent || '').trim() === '邮箱登录')?.click()`);
  await sleep(1200);
  await evalJs(ws, sessionId, `(() => {
    const email = document.querySelector('input[type=email]') || document.querySelector('input[placeholder*=邮箱]');
    const pass = document.querySelector('input[type=password]');
    const set = (el, value) => { const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set; d.call(el, value); el.dispatchEvent(new Event('input', {bubbles: true})); };
    set(email, process.env.YICOPY_EMAIL);
    set(pass, process.env.YICOPY_PASS);
    return true;
  })()`.replace('process.env.YICOPY_EMAIL', JSON.stringify(process.env.YICOPY_EMAIL)).replace('process.env.YICOPY_PASS', JSON.stringify(process.env.YICOPY_PASS)));
  await sleep(800);
  await evalJs(ws, sessionId, `[...document.querySelectorAll('button')].find((el) => (el.textContent || '').trim() === '登录')?.click()`);
  await sleep(6000);
  const loggedIn = await evalJs(ws, sessionId, `document.body.innerText.includes('登录 / 注册') ? 'no' : 'yes'`);
  console.log('logged in:', loggedIn);
  await shot(ws, sessionId, 'yicopy-10-after-login-home');

  // Traffic structure tool page: wait until the loading box resolves into the query UI.
  await cdp(ws, 'Page.navigate', { url: 'https://yicopy.com/tools/traffic-structure' }, sessionId);
  await sleep(9000);
  const toolText = await evalJs(ws, sessionId, 'document.body.innerText.slice(0, 1500)');
  console.log('tool page:', String(toolText).replace(/\n/g, ' / ').slice(0, 800));
  await shot(ws, sessionId, 'yicopy-11-traffic-tool');
  await shotFull(ws, sessionId, 'yicopy-11-traffic-tool-full');

  // Find the query input and run the demo ASIN.
  const typed = await evalJs(ws, sessionId, `(() => {
    const input = [...document.querySelectorAll('input, textarea')].find((el) => el.offsetParent !== null && (el.placeholder || '').match(/ASIN|关键词/i));
    if (!input) return 'no-input';
    const set = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set;
    set.call(input, 'B09B2SBHQK');
    input.dispatchEvent(new Event('input', {bubbles: true}));
    return 'typed:' + (input.placeholder || input.name);
  })()`);
  console.log('query input:', typed);
  await sleep(800);
  await shot(ws, sessionId, 'yicopy-12-query-filled');
  if (String(typed).startsWith('typed')) {
    await evalJs(ws, sessionId, `[...document.querySelectorAll('button')].find((el) => (el.textContent || '').match(/开始查询|查询/))?.click()`);
    await sleep(20000);
    await shot(ws, sessionId, 'yicopy-13-query-result');
    await shotFull(ws, sessionId, 'yicopy-13-query-result-full');
    const resultText = await evalJs(ws, sessionId, 'document.body.innerText.slice(0, 2000)');
    console.log('result text:', String(resultText).replace(/\n/g, ' / ').slice(0, 900));
  }

  // History / workspace entry if present in header.
  await shotFull(ws, sessionId, 'yicopy-14-final-state');
  ws.close();
  console.log('done');
})().catch((error) => { console.error(error); process.exit(1); });
