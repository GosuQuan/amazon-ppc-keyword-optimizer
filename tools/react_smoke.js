'use strict';
/* Smoke test for the React front end. Needs a Chrome with --remote-debugging-port.
   Usage: CDP_PORT=9333 node tools/react_smoke.js
   Exits non-zero on any failed assertion, so it can gate a commit or CI run. */
const port = process.env.CDP_PORT || '9333';
const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:8790';
// Default: React served under /web (classic default). With PPC_DEFAULT_APP=react use the site root.
const APP = process.env.SMOKE_APP || (BASE + '/web/index.html');
const EMAIL = process.env.SMOKE_EMAIL || 'real-run@example.com';
const PASSWORD = process.env.SMOKE_PASSWORD || 'password1';

let nextId = 1;
function cdp(ws, method, params = {}, sessionId) {
  const id = nextId++;
  const message = { id, method, params };
  if (sessionId) message.sessionId = sessionId;
  ws.send(JSON.stringify(message));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout ' + method)), 30000);
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
function check(name, condition, detail) {
  if (condition) { console.log('PASS ' + name); return true; }
  failures.push(name + (detail ? ' -> ' + detail : ''));
  console.log('FAIL ' + name + (detail ? ' -> ' + detail : ''));
  return false;
}

(async () => {
  let pages;
  try {
    pages = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  } catch (e) {
    console.error('无法连接 CDP（端口 ' + port + '）。请用 --remote-debugging-port=' + port + ' 启动 Chrome。');
    process.exit(2);
  }
  const page = pages.find((p) => p.type === 'page');
  if (!page) { console.error('没有可用页面'); process.exit(2); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId: page.id, flatten: true });
  await cdp(ws, 'Page.enable', {}, sessionId);
  await cdp(ws, 'Runtime.enable', {}, sessionId);
  await cdp(ws, 'Network.enable', {}, sessionId).catch(() => {});
  await cdp(ws, 'Network.setCacheDisabled', { cacheDisabled: true }, sessionId).catch(() => {});

  const errors = [];
  ws.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (data.method === 'Runtime.exceptionThrown') {
      const ex = data.params.exceptionDetails || {};
      errors.push((ex.exception && ex.exception.description ? ex.exception.description : ex.text || '').slice(0, 200));
    }
    if (data.method === 'Log.entryAdded' && ['error'].includes((data.params.entry || {}).level)) {
      errors.push(((data.params.entry || {}).text || '').slice(0, 200));
    }
  });
  await cdp(ws, 'Log.enable', {}, sessionId).catch(() => {});
  const ev = async (expr) => {
    const r = await cdp(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
    return r.result ? r.result.value : undefined;
  };

  // 1. Login page renders through React (start from a clean session).
  await cdp(ws, 'Page.navigate', { url: BASE + '/web/index.html?v=' + Date.now() }, sessionId);
  await sleep(4000);
  await ev(`sessionStorage.removeItem('ppc_token')`);
  await cdp(ws, 'Page.navigate', { url: BASE + '/web/index.html?v=' + Date.now() }, sessionId);
  await sleep(7000);
  const onLogin = await ev(`!!document.querySelector('input[type=email]') && !!document.querySelector('input[type=password]')`);
  const loginHeading = await ev(`document.querySelector('h1') ? document.querySelector('h1').textContent : ''`);
  check('登录页渲染（React 挂载）', onLogin && String(loginHeading).includes('登录'), 'heading=' + loginHeading);

  // 2. Log in and reach the dashboard with its conclusion sentence.
  if (onLogin) {
    await ev(`(() => {
      const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set; d.call(el, v); el.dispatchEvent(new Event('input', {bubbles:true})); };
      set(document.querySelector('input[type=email]'), ${JSON.stringify(EMAIL)});
      set(document.querySelector('input[type=password]'), ${JSON.stringify(PASSWORD)});
      document.querySelector('button.primary').click();
      return 'ok';
    })()`);
    await sleep(9000);
  }
  const dash = await ev(`(() => ({
    cards: document.querySelectorAll('.action-card').length,
    conclusion: [...document.querySelectorAll('.callout')].map(c => c.textContent).join(' '),
    heading: document.querySelector('h1') ? document.querySelector('h1').textContent : ''
  }))()`);
  const dashObj = typeof dash === 'string' ? JSON.parse(dash) : dash;
  check('仪表盘三张行动卡', dashObj.cards === 3, 'cards=' + dashObj.cards);
  check('仪表盘显示方案结论句', /方案/.test(dashObj.conclusion || ''), (dashObj.conclusion || '').slice(0, 60));

  // 3. Workbench: form, pre-check slots and five-step progress.
  await cdp(ws, 'Page.navigate', { url: BASE + '/web/index.html#/workflow' }, sessionId);
  await sleep(8000);
  const bench = await ev(`(() => ({
    fileInputs: document.querySelectorAll('input[type=file]').length,
    steps: document.querySelectorAll('.steps li').length,
    heading: document.querySelector('h1') ? document.querySelector('h1').textContent : ''
  }))()`);
  const benchObj = typeof bench === 'string' ? JSON.parse(bench) : bench;
  // 导入区四份报告：搜索词、批量、推广商品、广告位（复盘报告在生成方案后才出现）。
  check('工作台四份报告字段', benchObj.fileInputs >= 4, 'fileInputs=' + benchObj.fileInputs);
  check('五步进度条渲染', benchObj.steps === 5, 'steps=' + benchObj.steps);

  // 4. Points page: balance, packs and ledger.
  await cdp(ws, 'Page.navigate', { url: BASE + '/web/index.html#/points' }, sessionId);
  await sleep(8000);
  const points = await ev(`(() => ({
    heading: document.querySelector('h1') ? document.querySelector('h1').textContent : '',
    packs: document.querySelectorAll('.action-card').length,
    rows: document.querySelectorAll('tbody tr').length
  }))()`);
  const pointsObj = typeof points === 'string' ? JSON.parse(points) : points;
  check('积分页渲染', String(pointsObj.heading).includes('积分'), 'heading=' + pointsObj.heading);
  check('积分页显示充值档位', pointsObj.packs === 3, 'packs=' + pointsObj.packs);

  // 5. Legacy AI tool page still reachable and error-free under /classic.
  await cdp(ws, 'Page.navigate', { url: BASE + '/classic/index.html?v=' + Date.now() }, sessionId);
  await sleep(6000);
  const legacy = await ev(`(() => ({
    title: document.title,
    hasLegacyUi: !!document.querySelector('#drop') || !!document.querySelector('#aiStatus')
  }))()`);
  const legacyObj = typeof legacy === 'string' ? JSON.parse(legacy) : legacy;
  check('旧版工具页在 /classic 可用', String(legacyObj.title).includes('关键词优化') && legacyObj.hasLegacyUi,
    'title=' + legacyObj.title);

  check('全程无未捕获错误', errors.length === 0, errors.slice(0, 2).join(' | '));

  ws.close();
  if (failures.length) {
    console.error('\n冒烟测试失败 ' + failures.length + ' 项：\n- ' + failures.join('\n- '));
    process.exit(1);
  }
  console.log('\n冒烟测试全部通过');
})().catch((error) => { console.error('ERROR', error.message); process.exit(2); });
