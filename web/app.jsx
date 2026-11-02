'use strict';
/* React front-end prototype. Business rules still come from the shared plain-JS helpers. */
const { useState, useEffect, useCallback } = React;

function Spinner() { return React.createElement('span', { className: 'spinner', 'aria-hidden': 'true' }); }

function TopBar({ email, plan, points, onLogout }) {
  return (
    <header className="topbar">
      <a className="brand" href="/web/index.html">PPC <span>平台</span></a>
      <nav>
        <a href="/workflow.html">广告工作台</a>
        <a href="/points.html">积分</a>
        {email && <a href="#logout" onClick={(e) => { e.preventDefault(); onLogout(); }}>{email} · {plan === 'enterprise' ? '企业' : '个人'} · 剩余 {points} 积分 · 退出</a>}
      </nav>
    </header>
  );
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

  return (
    <section className="panel auth-card anim-fade-up" data-shake={shake ? 'yes' : 'no'}>
      <p className="eyebrow">账号</p>
      <h1>登录广告优化工作台</h1>
      <p className="muted">这是本工具的账号，不是亚马逊账号。登录后只能看到自己的方案。系统不会自动修改广告后台。</p>
      <form onSubmit={(e) => { e.preventDefault(); submit('/api/auth/login'); }}>
        <label>邮箱
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        </label>
        <label>密码
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="current-password" />
        </label>
        <div className="row">
          <button className="primary" type="submit" disabled={busy}>{busy ? '正在登录…' : '登录'}{busy ? <Spinner /> : null}</button>
          <button type="button" onClick={() => submit('/api/auth/register')} disabled={busy}>注册并进入</button>
        </div>
      </form>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <p className="muted small">
        {pricing
          ? `新账号 ${pricing.startingPoints.individual} 积分，企业账号 ${pricing.startingPoints.enterprise} 积分。生成方案 ${pricing.serviceCosts.workflow_plan}，首次导出 ${pricing.serviceCosts.export_draft}。积分不是人民币。`
          : '正在读取积分规则…'}
      </p>
      <p className="callout">不想注册？<a href="/workflow.html?demo=1">先看示例方案演示</a> —— 会跳到登录后再进入工作台并自动载入示例报表。</p>
    </section>
  );
}

function Dashboard({ token, account, onLogout }) {
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

  const list = plans;
  const cards = [
    { key: 'new', title: '开始新方案', desc: '上传搜索词报告，生成可审核的优化动作', href: '/workflow.html' },
    { key: 'continue', title: '继续最近的方案', desc: list.length ? `最近：${list[0].context?.asin || list[0].id} · ${list[0].export_ready ? '可导出' : '待审核'}` : '还没有方案，先创建一个吧', href: list.length ? window.planLink(list[0].id) : null },
    { key: 'demo', title: '载入示例', desc: '不导报表，先看完整调用过程', href: '/workflow.html?demo=1' },
  ];

  return (
    <main>
      <section className="panel anim-fade-up">
        <p className="eyebrow">登录后的主页</p>
        <h1>{account.plan === 'enterprise' ? '企业' : '个人'}仪表盘</h1>
        <p className="muted">{account.email} · 剩余 {account.points} 积分。积分不是人民币，也不能当成已节省的广告费。</p>
        <p className="callout">{window.rechargeNotice(billing)}</p>
        <div className="action-cards">
          {cards.map((card, index) => (
            <a key={card.key} className={'action-card anim-fade-up stagger-' + (index + 1) + (card.href ? '' : ' disabled-card')}
               href={card.href || undefined} aria-disabled={card.href ? undefined : 'true'}>
              <b>{card.title}</b><small>{card.desc}</small>
            </a>
          ))}
        </div>
      </section>
      <section className="panel anim-fade-up stagger-4">
        <h2>最近方案</h2>
        {loading ? <p className="muted">正在加载…</p> : (
          <React.Fragment>
            <p className="callout">{window.planListConclusion(list)}</p>
            {list.length ? (
              <table>
                <thead><tr><th>ASIN</th><th>状态</th><th>可核对花费</th><th>更新时间</th></tr></thead>
                <tbody>
                  {list.slice(0, 8).map((plan) => (
                    <tr key={plan.id}>
                      <td><a href={window.planLink(plan.id)}>{plan.context?.asin || plan.id}</a></td>
                      <td>{plan.export_ready ? '可导出' : '待审核'}</td>
                      <td>{typeof plan.claimable_observed_spend === 'number' ? plan.claimable_observed_spend : '—'}</td>
                      <td>{plan.updated_at || plan.created_at || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted">还没有方案。点击上方「开始新方案」或「载入示例」开始。</p>}
          </React.Fragment>
        )}
      </section>
      <p className="muted small">React 原型版 · 与原原生页面共用同一套后端接口与业务函数。</p>
    </main>
  );
}

function App() {
  const [token, setToken] = useState(sessionStorage.getItem('ppc_token') || '');
  const [account, setAccount] = useState(null);

  useEffect(() => {
    if (!token) { setAccount(null); return; }
    fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('会话已失效'))))
      .then(setAccount)
      .catch(() => { sessionStorage.removeItem('ppc_token'); setToken(''); setAccount(null); });
  }, [token]);

  const logout = useCallback(() => { sessionStorage.removeItem('ppc_token'); setToken(''); setAccount(null); }, []);

  if (!token || !account) {
    return (
      <React.Fragment>
        <TopBar onLogout={logout} />
        <main className="auth-layout"><LoginCard onAuth={setToken} /></main>
      </React.Fragment>
    );
  }
  return (
    <React.Fragment>
      <TopBar email={account.email} plan={account.plan} points={account.points} onLogout={logout} />
      <Dashboard token={token} account={account} onLogout={logout} />
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
