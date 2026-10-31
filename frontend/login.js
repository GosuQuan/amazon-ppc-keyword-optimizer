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
    location.replace('/dashboard.html');
  }
  fetch('/api/auth/pricing').then((response) => response.json()).then((data) => {
    const model = data.modelCosts || {};
    document.getElementById('pricing').textContent = `新账号 ${data.startingPoints.individual} 积分，企业账号 ${data.startingPoints.enterprise} 积分。Flash 模型：个人 ${model.individual.flash} / 企业 ${model.enterprise.flash}；其他模型：个人 ${model.individual.other} / 企业 ${model.enterprise.other}。生成方案 ${data.serviceCosts.workflow_plan}，首次导出 ${data.serviceCosts.export_draft}。积分不是人民币。`;
  }).catch(() => { document.getElementById('pricing').textContent = '积分规则暂时无法读取。'; });
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
