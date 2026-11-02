'use strict';
/* React front-end (no JSX, no build step). Shares business rules with the plain-JS helpers. */
const { useState, useEffect, useCallback } = React;
const h = React.createElement;

/* Error boundary: show render failures on the page instead of a blank screen. */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    if (window.console) console.error('React boundary caught:', error, info);
  }
  render() {
    if (this.state.error) {
      return h('div', { className: 'panel anim-fade-up' },
        h('h2', null, '页面渲染出错'),
        h('p', { className: 'error', role: 'alert' },
          String((this.state.error && this.state.error.message) || this.state.error)),
        h('p', { className: 'muted' }, '错误已被错误边界捕获，界面没有白屏。请刷新重试；若持续出现，请查看浏览器控制台的完整堆栈。'));
    }
    return this.props.children;
  }
}

function Spinner() { return h('span', { className: 'spinner', 'aria-hidden': 'true' }); }

function TopBar({ email, plan, points, onLogout }) {
  return h('header', { className: 'topbar' },
    h('a', { className: 'brand', href: '/web/index.html' }, 'PPC ', h('span', null, '平台')),
    h('nav', null,
      h('a', { href: '/web/index.html#/workflow' }, '广告工作台（React）'),
      h('a', { href: '/web/index.html#/points' }, '积分'),
      email
        ? h('a', { href: '#logout', onClick: (e) => { e.preventDefault(); onLogout(); } },
            `${email} · ${plan === 'enterprise' ? '企业' : '个人'} · 剩余 ${points} 积分 · 退出`)
        : null));
}

function LoginCard({ onAuth }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [pricing, setPricing] = useState(null);

  useEffect(() => {
    fetch('/api/auth/pricing').then((r) => r.json()).then(setPricing).catch(() => setPricing(null));
  }, []);

  const submit = useCallback(async (path) => {
    setBusy(true); setError('');
    try {
      const res = await fetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || '登录失败');
      sessionStorage.setItem('ppc_token', body.token);
      onAuth(body.token);
    } catch (e) {
      setError(e.message || '登录失败');
      setShake(true);
      setTimeout(() => setShake(false), 500);
    } finally { setBusy(false); }
  }, [email, password, onAuth]);

  return h('section', { className: 'panel auth-card anim-fade-up', 'data-shake': shake ? 'yes' : 'no' },
    h('p', { className: 'eyebrow' }, '账号'),
    h('h1', null, '登录广告优化工作台'),
    h('p', { className: 'muted' }, '这是本工具的账号，不是亚马逊账号。登录后只能看到自己的方案。系统不会自动修改广告后台。'),
    h('form', { onSubmit: (e) => { e.preventDefault(); submit('/api/auth/login'); } },
      h('label', null, '邮箱',
        h('input', { type: 'email', value: email, onChange: (e) => setEmail(e.target.value), required: true, autoComplete: 'username' })),
      h('label', null, '密码',
        h('input', { type: 'password', value: password, onChange: (e) => setPassword(e.target.value), required: true, minLength: 8, autoComplete: 'current-password' })),
      h('div', { className: 'row' },
        h('button', { className: 'primary', type: 'submit', disabled: busy }, busy ? '正在登录…' : '登录', busy ? h(Spinner) : null),
        h('button', { type: 'button', onClick: () => submit('/api/auth/register'), disabled: busy }, '注册并进入'))),
    error ? h('p', { className: 'error', role: 'alert' }, error) : null,
    h('p', { className: 'muted small' }, pricing
      ? `新账号 ${pricing.startingPoints.individual} 积分，企业账号 ${pricing.startingPoints.enterprise} 积分。生成方案 ${pricing.serviceCosts.workflow_plan}，首次导出 ${pricing.serviceCosts.export_draft}。积分不是人民币。`
      : '正在读取积分规则…'),
    h('p', { className: 'callout' }, '不想注册？', h('a', { href: '/workflow.html?demo=1' }, '先看示例方案演示'), ' —— 会跳到登录后再进入工作台并自动载入示例报表。'));
}

function Dashboard({ token, account }) {
  const [plans, setPlans] = useState([]);
  const [billing, setBilling] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const headers = { Authorization: 'Bearer ' + token };
    Promise.all([
      fetch('/api/workflow/plans', { headers }).then((r) => r.json()).catch(() => []),
      fetch('/api/billing/packs', { headers }).then((r) => r.json()).catch(() => null),
    ]).then(([list, packs]) => {
      setPlans(Array.isArray(list) ? list : []);
      setBilling(packs);
      setLoading(false);
    });
  }, [token]);

  const cards = [
    { key: 'new', title: '开始新方案', desc: '上传搜索词报告，生成可审核的优化动作', href: '/web/index.html#/workflow' },
    { key: 'continue', title: '继续最近的方案',
      desc: plans.length ? `最近：${plans[0].context && plans[0].context.asin || plans[0].id} · ${plans[0].export_ready ? '可导出' : '待审核'}` : '还没有方案，先创建一个吧',
      href: plans.length ? window.planLink(plans[0].id) : null },
    { key: 'demo', title: '载入示例', desc: '不导报表，先看完整调用过程', href: '/workflow.html?demo=1' },
  ];

  return h('main', null,
    h('section', { className: 'panel anim-fade-up' },
      h('p', { className: 'eyebrow' }, '登录后的主页'),
      h('h1', null, (account.plan === 'enterprise' ? '企业' : '个人') + '仪表盘'),
      h('p', { className: 'muted' }, `${account.email} · 剩余 ${account.points} 积分。积分不是人民币，也不能当成已节省的广告费。`),
      h('p', { className: 'callout' }, window.rechargeNotice(billing)),
      h('div', { className: 'action-cards' },
        cards.map((card, index) => h('a', {
          key: card.key,
          className: 'action-card anim-fade-up stagger-' + (index + 1) + (card.href ? '' : ' disabled-card'),
          href: card.href || undefined,
          'aria-disabled': card.href ? undefined : 'true',
        }, h('b', null, card.title), h('small', null, card.desc))))),
    h('section', { className: 'panel anim-fade-up stagger-4' },
      h('h2', null, '最近方案'),
      loading
        ? h('p', { className: 'muted' }, '正在加载…')
        : h('div', null,
            h('p', { className: 'callout' }, window.planListConclusion(plans)),
            plans.length
              ? h('table', null,
                  h('thead', null,
                    h('tr', null,
                      h('th', null, 'ASIN'),
                      h('th', null, '状态'),
                      h('th', null, '可核对花费'),
                      h('th', null, '更新时间'))),
                  h('tbody', null,
                    plans.slice(0, 8).map((plan) => h('tr', { key: plan.id },
                      h('td', null, h('a', { href: window.planLink(plan.id) }, (plan.context && plan.context.asin) || plan.id)),
                      h('td', null, plan.export_ready ? '可导出' : '待审核'),
                      h('td', null, typeof plan.claimable_observed_spend === 'number' ? String(plan.claimable_observed_spend) : '—'),
                      h('td', null, plan.updated_at || plan.created_at || '—')))))
              : h('p', { className: 'muted' }, '还没有方案。点击上方「开始新方案」或「载入示例」开始。'))));
}

function useHash() {
  const [hash, setHash] = useState(window.location.hash || '#/dashboard');
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/dashboard');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

function App() {
  const [token, setToken] = useState(sessionStorage.getItem('ppc_token') || '');
  const [account, setAccount] = useState(null);
  const hash = useHash();

  useEffect(() => {
    if (!token) { setAccount(null); return; }
    fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('会话失效'))))
      .then(setAccount)
      .catch(() => { sessionStorage.removeItem('ppc_token'); setToken(''); setAccount(null); });
  }, [token]);

  const logout = useCallback(() => { sessionStorage.removeItem('ppc_token'); setToken(''); setAccount(null); }, []);

  if (!token || !account) {
    return h(React.Fragment, null,
      h(TopBar, { onLogout: logout }),
      h('main', { className: 'auth-layout' }, h(LoginCard, { onAuth: setToken })));
  }
  return h(React.Fragment, null,
    h(TopBar, { email: account.email, plan: account.plan, points: account.points, onLogout: logout }),
    hash === '#/workflow' && window.WorkflowView
      ? h(window.WorkflowView, { token })
      : hash === '#/points' && window.PointsView
        ? h(window.PointsView, { token, account })
        : h(Dashboard, { token, account }));
}

try {
  ReactDOM.createRoot(document.getElementById('root')).render(h(ErrorBoundary, null, h(App)));
} catch (e) {
  const root = document.getElementById('root');
  if (root) root.textContent = 'React 启动失败：' + (e && e.message ? e.message : String(e));
  throw e;
}
