/* 用户体系前端：登录/注册门 + 携带 token 的 fetch。演示环境验证码直显（后端注明）。 */
const TOKEN_KEY = 'ppc_token';
const USER_KEY = 'ppc_user';

export function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
export function setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); }
export function currentUser() { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; } }
function saveUser(u) { u ? localStorage.setItem(USER_KEY, JSON.stringify(u)) : localStorage.removeItem(USER_KEY); renderChip(); }

export function authFetch(url, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  const t = getToken();
  if (t) headers['Authorization'] = 'Bearer ' + t;
  return fetch(url, Object.assign({}, opts, { headers })).then(r => {
    if (r.status === 401) { setToken(''); saveUser(null); showGate(); throw new Error('请先登录'); }
    return r;
  });
}

function renderChip() {
  const host = document.getElementById('userChip');
  if (!host) return;
  const u = currentUser();
  host.innerHTML = u
    ? `<span class="chip">👤 ${esc(u.displayName)} · AI额度 ${u.aiCredits}</span> <button class="btn mini ghost" id="btnLogout">退出</button>`
    : '';
  const b = document.getElementById('btnLogout');
  if (b) b.onclick = () => { setToken(''); saveUser(null); location.reload(); };
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

let gateResolve = null;
function showGate() {
  document.getElementById('authGate').style.display = 'flex';
  switchTab('login');
  return new Promise(res => { gateResolve = res; });
}
function closeGate() { document.getElementById('authGate').style.display = 'none'; if (gateResolve) { gateResolve(); gateResolve = null; } }
function switchTab(which) {
  document.getElementById('tabLogin').classList.toggle('on', which === 'login');
  document.getElementById('tabReg').classList.toggle('on', which === 'reg');
  document.getElementById('paneLogin').style.display = which === 'login' ? 'block' : 'none';
  document.getElementById('paneReg').style.display = which === 'reg' ? 'block' : 'none';
}
function setMsg(id, msg, ok) { const el = document.getElementById(id); el.className = 'status ' + (ok ? 'ok' : 'err'); el.textContent = msg; }

async function doLogin() {
  const account = document.getElementById('loginAccount').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!account || !password) return setMsg('authMsgLogin', '请填写账号与密码', false);
  try {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account, password }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || '登录失败');
    setToken(d.token); saveUser(d.user); closeGate();
  } catch (e) { setMsg('authMsgLogin', e.message, false); }
}
let sentCode = '';
async function doSendCode() {
  const tt = document.getElementById('regType').value;
  const target = document.getElementById('regTarget').value.trim();
  if (!target) return setMsg('authMsgReg', '请先填写邮箱或手机号', false);
  try {
    const r = await fetch('/api/auth/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_type: tt, target }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || '发送失败');
    sentCode = d.code || '';
    setMsg('authMsgReg', (d.note || '') + (d.demo ? ` 演示验证码：${d.code}` : ''), true);
  } catch (e) { setMsg('authMsgReg', e.message, false); }
}
async function doRegister() {
  const tt = document.getElementById('regType').value;
  const target = document.getElementById('regTarget').value.trim();
  const code = document.getElementById('regCode').value.trim();
  const password = document.getElementById('regPassword').value;
  if (!target || !code || !password) return setMsg('authMsgReg', '请填写完整', false);
  try {
    const r = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_type: tt, target, code, password }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || '注册失败');
    setToken(d.token); saveUser(d.user); closeGate();
  } catch (e) { setMsg('authMsgReg', e.message, false); }
}

export async function ensureAuth() {
  renderChip();
  if (getToken()) {
    const r = await fetch('/api/auth/me', { headers: { 'Authorization': 'Bearer ' + getToken() } });
    if (r.ok) { saveUser(await r.json()); return; }
    setToken(''); saveUser(null);
  }
  await showGate();
}

export function initAuthUI() {
  document.getElementById('tabLogin').onclick = () => switchTab('login');
  document.getElementById('tabReg').onclick = () => switchTab('reg');
  document.getElementById('btnLogin').onclick = doLogin;
  document.getElementById('btnSendCode').onclick = doSendCode;
  document.getElementById('btnRegister').onclick = doRegister;
  document.getElementById('regType').onchange = e => {
    const t = e.target.value;
    document.getElementById('regTarget').placeholder = t === 'email' ? 'you@example.com' : '13800000000';
  };
}
