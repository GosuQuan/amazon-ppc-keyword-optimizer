'use strict';
(() => {
  const token = sessionStorage.getItem('ppc_token');
  if (!token) location.replace('/login.html');
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  document.getElementById('logout').addEventListener('click', () => sessionStorage.removeItem('ppc_token'));
  const status = document.getElementById('recharge-status');
  function renderAccount(account, pricing) {
    document.getElementById('balance').textContent = `剩余 ${account.points} 积分 · ${account.plan === 'enterprise' ? '企业' : '个人'}`;
    const model = pricing.modelCosts;
    document.getElementById('pricing').textContent = `个人 Flash ${model.individual.flash} 分/次，其他模型 ${model.individual.other} 分/次。企业 Flash ${model.enterprise.flash} 分/次，其他模型 ${model.enterprise.other} 分/次。生成方案 ${pricing.serviceCosts.workflow_plan} 分，首次导出 ${pricing.serviceCosts.export_draft} 分。缓存命中不扣分。`;
    const events = document.getElementById('events');
    events.replaceChildren();
    (account.recentPoints || []).forEach((item) => {
      const row = document.createElement('p');
      row.textContent = `${item.created_at} · ${item.service} · ${item.points} · 余额 ${item.balance_after}`;
      events.append(row);
    });
    if (!(account.recentPoints || []).length) events.textContent = '还没有积分流水。';
  }
  function load() {
    return Promise.all([
      fetch('/api/auth/me', { headers }).then((response) => response.json()),
      fetch('/api/auth/pricing').then((response) => response.json()),
      fetch('/api/billing/packs', { headers }).then((response) => response.json()),
    ]).then(([account, pricing, billing]) => {
      renderAccount(account, pricing);
      document.getElementById('recharge-notice').textContent = window.rechargeNotice(billing) + ' 这不是 YICOPY 的收款页面。';
      const packs = document.getElementById('packs');
      packs.replaceChildren();
      Object.entries(billing.packs || {}).forEach(([id, pack]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `${pack.title} · ¥${pack.priceCny} · ${pack.points} 积分 · ${billing.demoRecharge === true ? '演示入账' : '暂不能入账'}`;
        button.addEventListener('click', () => {
          status.textContent = '正在演示入账…';
          fetch('/api/billing/recharge', { method: 'POST', headers, body: JSON.stringify({ pack: id }) })
            .then((response) => response.json().then((body) => ({ ok: response.ok, body })))
            .then((result) => {
              status.textContent = result.ok ? `已演示入账 ${result.body.pointsAdded} 积分。未发生真实支付。` : (result.body.detail || '入账失败');
              if (result.ok) load();
            });
        });
        const note = document.createElement('p');
        note.className = 'muted';
        note.textContent = pack.basis;
        packs.append(button, note);
      });
    });
  }
  load().catch((error) => { status.textContent = error.message; });
})();
