'use strict';
/* Capture current UI screenshots for the four key views (login-free via test account). */
const fs = require('fs');
const path = require('path');
const port = process.env.CDP_PORT || '9333';
const outDir = path.resolve('docs/对标快照');

async function cdp(ws, method, params = {}, sessionId) {
  const id = cdp.next++;
  const message = { id, method, params };
  if (sessionId) message.sessionId = sessionId;
  ws.send(JSON.stringify(message));
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout ' + method)), 60000);
    function onMessage(e) {
      const d = JSON.parse(e.data);
      if (d.id !== id) return;
      clearTimeout(t); ws.removeEventListener('message', onMessage);
      if (d.error) reject(new Error(JSON.stringify(d.error))); else resolve(d.result || {});
    }
    ws.addEventListener('message', onMessage);
  });
}
cdp.next = 1;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function ev(ws, s, expr) {
  const r = await cdp(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, s);
  return r.result ? r.result.value : undefined;
}
async function shot(ws, s, name) {
  const d = await cdp(ws, 'Page.captureScreenshot', { format: 'png' }, s);
  fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(d.data, 'base64'));
  console.log('shot', name);
}

(async () => {
  const pages = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json());
  const page = pages.find(p => p.type === 'page' && p.url.includes('8790'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId: page.id, flatten: true });
  await cdp(ws, 'Page.enable', {}, sessionId);
  await cdp(ws, 'Runtime.enable', {}, sessionId);
  await cdp(ws, 'DOM.enable', {}, sessionId);
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId).catch(() => {});

  await cdp(ws, 'Page.navigate', { url: 'http://127.0.0.1:8790/' }, sessionId);
  await sleep(3000);
  await cdp(ws, 'Page.reload', { ignoreCache: true }, sessionId);
  await sleep(8000);
  if (await ev(ws, sessionId, `!!document.querySelector('input[type=email]')`)) {
    await shot(ws, sessionId, 'sprint-login');
    await ev(ws, sessionId, `(() => {
      const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set; d.call(el, v); el.dispatchEvent(new Event('input', {bubbles:true})); };
      set(document.querySelector('input[type=email]'), 'real-run@example.com');
      set(document.querySelector('input[type=password]'), 'password1');
      document.querySelector('button.primary').click(); return 'ok';
    })()`);
    await sleep(8000);
  }
  await shot(ws, sessionId, 'sprint-dashboard');

  await cdp(ws, 'Page.navigate', { url: 'http://127.0.0.1:8790/#/tool' }, sessionId);
  await sleep(9000);
  await shot(ws, sessionId, 'sprint-tool-top');

  // Fill the dedup panel and run it, then capture.
  await ev(ws, sessionId, `(() => {
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set; d.call(el, v); el.dispatchEvent(new Event('input', {bubbles:true})); };
    const areas = [...document.querySelectorAll('textarea')];
    const existing = areas.find(a => (a.placeholder||'').includes('cell phone stand'));
    const planned = areas.find(a => (a.placeholder||'').includes('laptop stand'));
    if (existing && planned) {
      set(existing, 'cell phone stand\\nphone holder');
      set(planned, 'cell phone stand\\nstand for cell phone\\nlaptop stand');
    }
    const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='开始去重');
    if(b)b.click();
    return 'ok';
  })()`);
  await sleep(3000);
  const dedupEl = await ev(ws, sessionId, `(() => {
    const h = [...document.querySelectorAll('h2')].find(x => x.textContent.includes('投放前去重'));
    if (!h) return null;
    h.scrollIntoView({ block: 'start' });
    return true;
  })()`);
  if (dedupEl) await shot(ws, sessionId, 'sprint-dedup');
  ws.close();
  console.log('done');
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
