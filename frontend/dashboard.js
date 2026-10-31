'use strict';
(() => {
  const token = sessionStorage.getItem('ppc_token');
  if (!token) location.replace('/login.html');
  const headers = { Authorization: 'Bearer ' + token };
  document.getElementById('logout').addEventListener('click', () => sessionStorage.removeItem('ppc_token'));
  const text = (id, value) => { document.getElementById(id).textContent = value; };
  Promise.all([
    fetch('/api/auth/me', { headers }).then((response) => { if (response.status === 401) location.replace('/login.html'); return response.json(); }),
    fetch('/api/workflow/plans', { headers }).then((response) => response.json()),
    fetch('/api/billing/packs', { headers }).then((response) => response.json()),
  ]).then(([account, plans, billing]) => {
    document.getElementById('recharge-notice').textContent = window.rechargeNotice(billing);
    const list = Array.isArray(plans) ? plans : [];
    text('welcome', (account.plan === 'enterprise' ? '企业' : '个人') + '仪表盘');
    text('account', `${account.email} · 剩余 ${account.points} 积分。积分不是人民币，也不能当成已节省的广告费。`);
    const summary = document.getElementById('summary');
    const cards = [['方案', list.length], ['可导出', list.filter((item) => item.export_ready).length], ['积分', account.points]];
    summary.replaceChildren(...cards.map(([label, value]) => {
      const card = document.createElement('div');
      const small = document.createElement('small');
      small.textContent = label;
      const strong = document.createElement('p');
      strong.textContent = String(value);
      card.append(small, strong);
      return card;
    }));
    const root = document.getElementById('plans');
    root.replaceChildren();
    if (!list.length) root.append('还没有方案。进入广告工作台导入搜索词报告。');
    list.slice(0, 8).forEach((plan) => {
      const row = document.createElement('p');
      const link = document.createElement('a');
      link.href = window.planLink(plan.id);
      const claim = typeof plan.claimable_observed_spend === 'number' ? ` · 可核对历史花费 ${plan.claimable_observed_spend}` : '';
      link.textContent = `${plan.context?.asin || plan.id} · ${plan.export_ready ? '可导出' : '待审核'}${claim}`;
      row.append(link);
      root.append(row);
    });
  }).catch((error) => text('account', error.message));
})();
