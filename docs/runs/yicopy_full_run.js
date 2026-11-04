'use strict';
/* Full YICOPY run on the persistent CDP instance (port 9333): login -> confirm -> query -> result. */
const fs = require('fs');
const path = require('path');

const port = process.env.CDP_PORT || '9333';
const EMAIL = process.env.YICOPY_EMAIL;
const PASS = process.env.YICOPY_PASS;
const outDir = path.resolve('docs/runs/登录态快照');
fs.mkdirSync(outDir, { recursive: true });

async function cdp(ws, method, params = {}, sessionId) {
  const id = cdp.next++;
  const message = { id, method, params };
  if (sessionId) message.sessionId = sessionId;
  ws.send(JSON.stringify(message));
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout ' + method)), 40000);
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

async function shot(ws, s, name) {
  const d = await cdp(ws, 'Page.captureScreenshot', { format: 'png' }, s);
  fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(d.data, 'base64'));
  console.log('shot', name);
}
async function ev(ws, s, expr) {
  const r = await cdp(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, s);
  return r.result ? r.result.value : undefined;
}

(async () => {
  const pages = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json());
  const page = pages.find(p => p.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId: page.id, flatten: true });
  await cdp(ws, 'Page.enable', {}, sessionId);
  await cdp(ws, 'Runtime.enable', {}, sessionId);

  // 1. Check whether we are already logged in (extension install may have kept session).
  let guest = await ev(ws, sessionId, `document.body.innerText.includes('登录 / 注册')`);
  console.log('guest header:', guest);

  if (guest) {
    await cdp(ws, 'Page.navigate', { url: 'https://yicopy.com/' }, sessionId);
    await sleep(4000);
    await ev(ws, sessionId, `[...document.querySelectorAll('a, button')].find(el => (el.textContent||'').trim() === '登录 / 注册')?.click()`);
    await sleep(2500);
    await ev(ws, sessionId, `[...document.querySelectorAll('button, [role=tab], span, div')].find(el => (el.textContent||'').trim() === '邮箱登录')?.click()`);
    await sleep(1500);
    const filled = await ev(ws, sessionId, `(() => {
      const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set; d.call(el, v); el.dispatchEvent(new Event('input', {bubbles:true})); };
      const email = document.querySelector('input[type=email]') || document.querySelector('input[placeholder*=邮箱]');
      const pass = document.querySelector('input[type=password]');
      if (!email || !pass) return 'inputs-missing';
      set(email, ${JSON.stringify(EMAIL)}); set(pass, ${JSON.stringify(PASS)});
      return 'filled';
    })()`);
    console.log('fill:', filled);
    await shot(ws, sessionId, 'run-01-login-filled');
    await ev(ws, sessionId, `(() => {
      const c = [...document.querySelectorAll('button')].filter(el => el.offsetParent !== null && el.textContent.includes('登录'));
      if (!c.length) return;
      c[c.length - 1].click();
    })()`);
    await sleep(7000);
    // 2. Accept the "logged in elsewhere" confirmation if present.
    const confirm = await ev(ws, sessionId, `(() => {
      const btn = [...document.querySelectorAll('button')].filter(el => el.offsetParent !== null && el.textContent.includes('继续登录')).pop();
      if (!btn) return 'none';
      btn.click(); return 'clicked';
    })()`);
    console.log('confirm:', confirm);
    if (confirm === 'clicked') await sleep(8000);
    guest = await ev(ws, sessionId, `document.body.innerText.includes('登录 / 注册')`);
    console.log('still guest:', guest);
  }
  await shot(ws, sessionId, 'run-02-logged-in');

  // 3. Open the cheap keyword analysis tool and wait for the query UI (extension should unlock it).
  await cdp(ws, 'Page.navigate', { url: 'https://yicopy.com/tools/keyword-analysis' }, sessionId);
  let hasInput = false;
  for (let i = 0; i < 6; i++) {
    await sleep(6000);
    hasInput = await ev(ws, sessionId, `[...document.querySelectorAll('input, textarea')].some(el => el.offsetParent !== null && (el.placeholder||'').match(/关键词|keyword/i))`);
    console.log('input wait', i, hasInput);
    if (hasInput) break;
  }
  await shot(ws, sessionId, 'run-03-tool-page');
  const toolText = await ev(ws, sessionId, `document.body.innerText.slice(0, 1200).replace(/\\n/g, ' / ')`);
  console.log('tool page:', toolText);

  if (hasInput) {
    await ev(ws, sessionId, `(() => {
      const input = [...document.querySelectorAll('input, textarea')].find(el => el.offsetParent !== null && (el.placeholder||'').match(/关键词|keyword/i));
      const set = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set;
      set.call(input, 'portable fan'); input.dispatchEvent(new Event('input', {bubbles:true}));
      return 'typed';
    })()`);
    await shot(ws, sessionId, 'run-04-query-filled');
    const submit = await ev(ws, sessionId, `(() => {
      const btn = [...document.querySelectorAll('button')].find(el => (el.textContent||'').includes('免费工具算力') && el.offsetParent !== null);
      if (!btn) return 'no-button';
      btn.scrollIntoView({block:'center'}); btn.click(); return 'clicked';
    })()`);
    console.log('submit:', submit);
    let verdict = 'timeout';
    for (let i = 0; i < 10; i++) {
      await sleep(15000);
      const s = await ev(ws, sessionId, `(() => {
        const t = document.body.innerText;
        if (t.includes('Amazon 暂时限制')) return 'blocked';
        if (t.includes('本次查询没有完成')) return 'incomplete';
        if (t.match(/生成中|排队|正在查询|处理中|进行中/)) return 'running';
        if (t.match(/搜索量|相关性|出单概率|竞争度|月搜索/)) return 'done';
        return 'unknown';
      })()`);
      console.log('poll', i, s);
      if (s === 'blocked' || s === 'incomplete' || s === 'done') { verdict = s; break; }
    }
    await shot(ws, sessionId, 'run-05-result');
    const result = await ev(ws, sessionId, `document.body.innerText.slice(0, 3000).replace(/\\n/g, ' / ')`);
    console.log('RESULT PAGE:', result);
    console.log('VERDICT:', verdict);
  } else {
    console.log('query UI still unavailable');
  }
  ws.close();
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
