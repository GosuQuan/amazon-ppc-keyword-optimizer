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
    document.getElementById('plans-conclusion').textContent = window.planListConclusion(list);
    const continueCard = document.getElementById('continue-card');
    const continueNote = document.getElementById('continue-note');
    const intro = document.createElement('p');
    intro.className = 'muted';
    intro.textContent = '可核对历史花费来自已经发生的搜索词，不是已节省广告费。';
    if (!list.length) {
      const empty = document.createElement('p');
      empty.textContent = '还没有方案。点击上方「开始新方案」或「载入示例」开始。';
      root.append(intro, empty);
      continueCard.removeAttribute('href');
      continueCard.classList.add('disabled-card');
      continueCard.setAttribute('aria-disabled', 'true');
      continueNote.textContent = '还没有方案，先创建一个吧';
    } else {
      const latest = list[0];
      continueCard.href = window.planLink(latest.id);
      continueNote.textContent = `最近：${latest.context?.asin || latest.id} · ${latest.export_ready ? '可导出' : '待审核'}`;
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      ['ASIN', '状态', '可核对花费', '更新时间'].forEach((label) => {
        const th = document.createElement('th'); th.textContent = label; headRow.append(th);
      });
      thead.append(headRow);
      const tbody = document.createElement('tbody');
      list.slice(0, 8).forEach((plan) => {
        const row = document.createElement('tr');
        const asinCell = document.createElement('td');
        const link = document.createElement('a');
        link.href = window.planLink(plan.id);
        link.textContent = plan.context?.asin || plan.id;
        asinCell.append(link);
        const statusCell = document.createElement('td');
        statusCell.textContent = plan.export_ready ? '可导出' : '待审核';
        const spendCell = document.createElement('td');
        spendCell.textContent = typeof plan.claimable_observed_spend === 'number' ? String(plan.claimable_observed_spend) : '—';
        const timeCell = document.createElement('td');
        timeCell.textContent = plan.updated_at || plan.created_at || '—';
        row.append(asinCell, statusCell, spendCell, timeCell);
        tbody.append(row);
      });
      table.append(thead, tbody);
      root.append(intro, table);
    }
  }).catch((error) => text('account', error.message));
})();
