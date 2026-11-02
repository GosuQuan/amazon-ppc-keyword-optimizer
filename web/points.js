'use strict';
/* React version of the points page: balance, pricing, ledger and demo recharge. */
function PointsView({ token, account }) {
  const [pricing, setPricing] = useState(null);
  const [billing, setBilling] = useState(null);
  const [me, setMe] = useState(account);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  const load = useCallback(() => {
    setLoading(true);
    return Promise.all([
      fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } }).then((r) => r.json()),
      fetch('/api/auth/pricing').then((r) => r.json()),
      fetch('/api/billing/packs', { headers: { Authorization: 'Bearer ' + token } }).then((r) => r.json()),
    ]).then(([meBody, pricingBody, billingBody]) => {
      setMe(meBody);
      setPricing(pricingBody);
      setBilling(billingBody);
      setLoading(false);
    });
  }, [token]);

  useEffect(() => { load().catch(() => setLoading(false)); }, [load]);

  const recharge = useCallback((packId) => {
    setBusy(true);
    setStatus('正在演示入账…');
    fetch('/api/billing/recharge', { method: 'POST', headers, body: JSON.stringify({ pack: packId }) })
      .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
      .then((result) => {
        setStatus(result.ok
          ? `已演示入账 ${result.body.pointsAdded} 积分。未发生真实支付。`
          : (result.body.detail || '入账失败'));
        if (result.ok) return load();
        return null;
      })
      .catch((e) => setStatus(e.message || '入账失败'))
      .finally(() => setBusy(false));
  }, [load]);

  const packs = (billing && billing.packs) || {};
  const model = pricing && pricing.modelCosts;
  const events = (me && me.recentPoints) || [];

  return h('main', null,
    h('section', { className: 'panel anim-fade-up' },
      h('p', { className: 'eyebrow' }, '积分'),
      h('h1', null, '积分与充值'),
      loading ? h('p', { className: 'muted' }, '正在加载…') : h(React.Fragment, null,
        h('p', { className: 'muted' },
          `剩余 ${me.points} 积分 · ${me.plan === 'enterprise' ? '企业' : '个人'}。积分不是人民币，也不是已节省的广告费。`),
        h('p', { className: 'callout' }, window.rechargeNotice(billing) + ' 这不是 YICOPY 的收款页面。'),
        model ? h('p', { className: 'muted small' },
          `个人 Flash ${model.individual.flash} 分/次，其他模型 ${model.individual.other} 分/次。企业 Flash ${model.enterprise.flash} 分/次，其他模型 ${model.enterprise.other} 分/次。生成方案 ${pricing.serviceCosts.workflow_plan} 分，首次导出 ${pricing.serviceCosts.export_draft} 分。缓存命中不扣分。`) : null)),
    h('section', { className: 'panel anim-fade-up stagger-2' },
      h('h2', null, '充值档位'),
      h('p', { className: 'muted' }, '价格量级对齐 YICOPY 公开档位，但本平台积分与 YICOPY 算力不可兑换，也不代表同样的服务内容。'),
      loading ? null : Object.keys(packs).map((id, index) => {
        const pack = packs[id];
        return h('div', { className: 'action-card anim-fade-up stagger-' + ((index % 3) + 1), key: id },
          h('b', null, `${pack.title} · ¥${pack.priceCny} · ${pack.points} 积分`),
          h('small', null, pack.basis),
          h('div', { className: 'row' },
            h('button', {
              type: 'button',
              disabled: busy || billing.demoRecharge !== true,
              onClick: () => recharge(id),
            }, billing.demoRecharge === true ? '演示入账' : '暂不能入账')));
      }),
      status ? h('p', { className: 'callout', role: 'status' }, status) : null),
    h('section', { className: 'panel anim-fade-up stagger-3' },
      h('h2', null, '最近积分流水'),
      events.length
        ? h('table', null,
            h('thead', null, h('tr', null,
              h('th', null, '时间'), h('th', null, '项目'), h('th', null, '积分'), h('th', null, '余额'))),
            h('tbody', null, events.map((item, index) => h('tr', { key: index },
              h('td', null, item.created_at),
              h('td', null, item.service),
              h('td', null, String(item.points)),
              h('td', null, String(item.balance_after))))))
        : h('p', { className: 'muted' }, '还没有积分流水。')));
}

window.PointsView = PointsView;
