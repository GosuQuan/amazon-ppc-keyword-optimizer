'use strict';
(() => {
  const form = document.getElementById('login-form');
  const status = document.getElementById('login-status');
  async function submit(path) {
    const data = new FormData(form);
    const response = await fetch(path, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email: String(data.get('email') || ''), password: String(data.get('password') || '')}),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || '登录失败');
    sessionStorage.setItem('ppc_token', body.token);
    location.replace('/workflow.html');
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    status.textContent = '正在登录…';
    submit('/api/auth/login').catch((error) => { status.textContent = error.message; });
  });
  document.getElementById('register').addEventListener('click', () => {
    status.textContent = '正在注册…';
    submit('/api/auth/register').catch((error) => { status.textContent = error.message; });
  });
})();
