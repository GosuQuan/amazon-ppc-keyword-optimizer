'use strict';
/* React version of the legacy report-analysis tool: params, upload, KPI and the five lists.
   Uses its own createElement alias (t) so it can load before app.js. */
const t = React.createElement;

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function downloadCsv(filename, cols, rows) {
  const lines = [cols.map((c) => csvCell(c.label)).join(',')];
  (rows || []).forEach((r) => {
    lines.push(cols.map((c) => {
      const raw = c.get ? c.get(r) : r[c.k];
      return csvCell(c.fmt ? c.fmt(raw, r) : raw);
    }).join(','));
  });
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DataTable({ title, rows, cols, max, file, note }) {
  const list = (rows || []).slice(0, max || 100);
  if (!list.length) return null;
  return t('section', { className: 'panel anim-fade-up' },
    t('div', { className: 'section-head' },
      t('h3', null, `${title}（${list.length} 条）`),
      file ? t('button', { type: 'button', onClick: () => downloadCsv(file, cols, list) }, '导出 CSV') : null),
    note ? t('p', { className: 'hint' }, note) : null,
    t('table', null,
      t('thead', null, t('tr', null, cols.map((c) => t('th', { key: c.k }, c.label)))),
      t('tbody', null, list.map((r, index) => t('tr', { key: index },
        cols.map((c) => {
          const raw = c.get ? c.get(r) : r[c.k];
          const value = c.fmt ? c.fmt(raw, r) : raw;
          return t('td', { key: c.k }, (value === null || value === undefined || value === '') ? '—' : String(value));
        }))))));
}

/* ACOS is returned as a ratio; render it as a percentage like the classic table does. */
const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? (v * 100).toFixed(1) + '%' : '—');
const acosCol = (label) => ({ k: 'acos', label: label || 'ACOS', fmt: pct });

function ToolView({ token, account }) {
  const [params, setParams] = useState({
    target: 25, ecvr: 10, min_clicks: 8, aov: '', up_cap: 30, down_cap: 50, floor: 0.05, imp_floor: 500,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const update = (key) => (event) => setParams((prev) => Object.assign({}, prev, { [key]: event.target.value }));

  const onSubmit = async (event) => {
    event.preventDefault();
    const input = document.getElementById('tool-files');
    const picked = input && input.files ? [...input.files] : [];
    if (!picked.length) { setError('请先选择至少一个报表文件（CSV / TXT）。'); return; }
    setBusy(true); setError('');
    try {
      const data = new FormData();
      picked.forEach((file) => data.append('files', file, file.name));
      Object.keys(params).forEach((key) => { if (params[key] !== '') data.append(key, String(params[key])); });
      const res = await fetch('/api/analyze', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: data });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || body.detail || '分析失败');
      setResult(body);
    } catch (e) {
      setError(e.message || '分析失败');
    } finally { setBusy(false); }
  };

  const kpi = result && result.kpi ? result.kpi : null;
  const kpiCards = kpi ? [
    ['数据行数', kpi.rows], ['曝光', kpi.imp], ['点击', kpi.clk], ['花费', kpi.spend],
    ['销售额', kpi.sales], ['订单', kpi.orders], ['整体 ACOS', pct(kpi.acos)], ['搜索词数', kpi.stCount],
  ] : [];

  const [dedupState, setDedupState] = useState({ existing: '', planned: '', result: null });
  const runDedup = () => {
    const existing = dedupState.existing.split(/[\n,，;；]/).map((s) => s.trim()).filter(Boolean);
    const planned = dedupState.planned.split(/[\n,，;；]/).map((s) => s.trim()).filter(Boolean);
    const result = window.dedupKeywords ? window.dedupKeywords(existing, planned) : { conflicts: [], clean: [] };
    setDedupState((s) => ({ ...s, result }));
  };

  const [ai, setAi] = useState({
    mode: 'expert', baseUrl: '', model: '', apiKey: '', desc: '', brands: '',
  });
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiResult, setAiResult] = useState(null);

  const updateAi = (key) => (event) => setAi((prev) => Object.assign({}, prev, { [key]: event.target.value }));

  const stripFence = (text) => {
    const trimmed = String(text || '').trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const body = fenced ? fenced[1] : trimmed;
    try { return JSON.parse(body); } catch (e) { /* fall through */ }
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(body.slice(start, end + 1));
    throw new Error('模型最终内容不是完整 JSON，本次结果未合并');
  };

  const acceptAiJson = (parsed) => {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('AI 结果必须是对象');
    const keys = ['expansions', 'intents', 'negativeHints', 'insights'];
    if (!keys.some((k) => Object.prototype.hasOwnProperty.call(parsed, k))) {
      throw new Error('AI 结果至少需要 expansions/intents/negativeHints/insights 中一个数组');
    }
    setAiResult(parsed);
  };

  // Reuse the single shared implementation so multi-word brands behave the same
  // as in the classic tool page.
  const hitsBrand = (word) => (typeof window.brandHit === 'function' ? window.brandHit(word, ai.brands) : false);

  const importExpert = (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    setAiError('');
    const reader = new FileReader();
    reader.onload = () => {
      try { acceptAiJson(JSON.parse(String(reader.result || ''))); }
      catch (e) { setAiError('导入失败：' + (e.message || '不是合法 JSON')); }
    };
    reader.readAsText(file);
  };

  const runOnline = async () => {
    setAiBusy(true); setAiError('');
    try {
      if (!result) throw new Error('请先完成一次报表分析，AI 挖掘需要基于分析结果');
      const top = (result.st || []).filter((s) => s.cls === '优秀' || s.cls === '良好')
        .slice(0, 40).map((s) => s.st);
      const body = {
        messages: [
          { role: 'system', content: '你是亚马逊广告关键词专家。输出严格 JSON（无 markdown）：{"expansions":[{"word":"","type":"长尾|场景|人群|规格","reason":""}],"intents":[{"intent":"","keywords":[""]}],"negativeHints":[{"word":"","reason":""}],"insights":[{"title":"","detail":""}]}。不要把历史花费写成已节省金额。' },
          { role: 'user', content: `【产品信息】${ai.desc || '（未填写）'}\n【优秀搜索词】\n${top.join('\n')}` },
        ],
        temperature: 0.3,
        thinking: false,
      };
      if (ai.model) body.model = ai.model;
      if (ai.baseUrl) body.base_url = ai.baseUrl;
      if (ai.apiKey) body.api_key = ai.apiKey;
      const res = await fetch('/api/ai/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'AI 调用失败');
      const choice = (payload.choices || [])[0] || {};
      if (choice.finish_reason === 'length') throw new Error('模型输出已截断，本次结果未合并');
      acceptAiJson(stripFence(choice.message && choice.message.content));
    } catch (e) {
      setAiError(e.message || 'AI 挖掘失败');
    } finally { setAiBusy(false); }
  };

  const exportTopKeywords = () => {
    if (!result) return;
    const top = (result.st || []).filter((s) => s.cls === '优秀' || s.cls === '良好').slice(0, 40);
    const roots = (result.roots || []).filter((r) => r.type === '盈利' || r.type === '加分').slice(0, 15).map((r) => r.tok);
    const lines = ['【产品信息】' + (ai.desc || '（未填写）'), '', '【优秀搜索词】', ...top.map((s) => `${s.st}（订单 ${s.orders ?? '—'}）`), '', '【盈利词根】' + roots.join(', ')];
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '优秀关键词-喂给专家.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Same normalisation the shared evidence/negative helpers use (strip spaces AND punctuation),
  // otherwise a term like "cell phone" would not match "cell phone stand".
  const canonOf = (v) => String(v == null ? '' : v)
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[()（）#％%：:，,。·'"“”\-—–_/\\]/g, '');
  const evidenceMap = (typeof React.useMemo === 'function')
    ? React.useMemo(() => (window.buildReportEvidence ? window.buildReportEvidence((result && result.st) || []) : null), [result])
    : null;
  const aiExpansions = (typeof window.sortByEvidence === 'function')
    ? window.sortByEvidence((aiResult && aiResult.expansions) || [])
    : ((aiResult && aiResult.expansions) || []);
  const aiIntents = (aiResult && aiResult.intents) || [];
  const aiNegatives = (aiResult && aiResult.negativeHints) || [];
  const aiInsights = (aiResult && aiResult.insights) || [];

  // Build the new-word candidate list from our own analysis plus any AI expansions.
  const newWordRows = (() => {
    const list = [];
    const seen = new Set();
    const push = (row) => {
      const key = canonOf(row.word);
      if (!key || seen.has(key)) return;
      seen.add(key);
      list.push(row);
    };
    for (const h of (result && result.harvest) || []) {
      if (h.exists) continue;
      push({ word: h.st, src: '搜索词收割', type: h.sug || '新增精准词',
        advice: window.adviceFor ? window.adviceFor(h.orders ? 1 : 0, h.orders) : '先观察',
        orders: h.orders == null ? '' : h.orders, note: '来自' + (h.srcMt || '') + ' 匹配' });
    }
    for (const c of (result && result.combos) || []) {
      const place = window.suggestPlacement ? window.suggestPlacement(c.pair, (result && result.st) || []) : { camp: '', adg: '', via: '' };
      push({ word: c.pair, src: '组合挖掘', type: '组合新词', camp: place.camp, adg: place.adg,
        advice: window.adviceFor ? window.adviceFor(c.orders ? 1 : 0, c.orders) : '先观察',
        orders: c.orders == null ? '' : c.orders, note: (place.via ? place.via + '　' : '') + (c.evidence || '') });
    }
    for (const e of aiExpansions) {
      if (e.competitorBrand || e.coveredByGood || e.exists) continue;
      const ev = (window.evidenceFor && evidenceMap) ? window.evidenceFor(evidenceMap, e.word) : { rows: 0, orders: 0 };
      const issues = window.charIssues ? window.charIssues(e.word) : [];
      let charNote = '';
      if (issues.length) {
        const cleaned = window.cleanWord ? window.cleanWord(e.word) : '';
        charNote = '⚠字符: ' + issues.join('、') + (cleaned ? '，清洗建议「' + cleaned + '」' : '，清洗后为空需人工改写') + '　';
      }
      const place = window.suggestPlacement ? window.suggestPlacement(e.word, (result && result.st) || []) : { camp: '', adg: '', via: '' };
      push({ word: e.word, src: 'AI扩词', type: e.type || 'AI', camp: place.camp, adg: place.adg,
        advice: window.adviceFor ? window.adviceFor(ev.rows, ev.orders) : '待验证',
        orders: ev.orders || '', note: charNote + (place.via ? place.via + '　' : '') + (e.reason || '') });
    }
    const rank = { '优先新增': 0, '先观察': 1, '待验证': 2 };
    return list.slice().sort((a, b) => (rank[a.advice] ?? 3) - (rank[b.advice] ?? 3));
  })();

  const distRows = (() => {
    const dist = (result && result.dist) || {};
    const order = ['优秀', '良好', '偏高', '亏损', '无效', '潜力', '观察'];
    return order.filter((cls) => dist[cls]).map((cls) => {
      const d = dist[cls];
      return {
        cls,
        n: d.n,
        clk: d.clk,
        spend: d.spend,
        sales: d.sales,
        orders: d.orders,
        acos: d.sales > 0 ? d.spend / d.sales : null,
      };
    });
  })();

  const [focusGrade, setFocusGrade] = (typeof React.useState === 'function')
    ? React.useState(null)
    : [null, () => {}];
  const focusQuestions = [
    ['钱主要花在哪一档？', ['偏高', '亏损']],
    ['哪一档最亏（有花费没订单）？', ['亏损', '无效']],
    ['哪一档该优先保住？', ['优秀', '良好']],
  ];

  const splitRows = (() => {
    const groups = new Map();
    for (const s of (result && result.st) || []) {
      if (!s.camp && !s.adg) continue;
      const key = canonOf(s.camp) + '||' + canonOf(s.adg);
      const g = groups.get(key) || { camp: s.camp, adg: s.adg, terms: new Set(), clk: 0, spend: 0, sales: 0, orders: 0 };
      if (s.st && s.st.trim() !== '—' && s.st.trim() !== '-') g.terms.add(canonOf(s.st));
      g.clk += Number(s.clk) || 0;
      g.spend += Number(s.spend) || 0;
      g.sales += Number(s.sales) || 0;
      g.orders += Number(s.orders) || 0;
      groups.set(key, g);
    }
    return [...groups.values()]
      .map((g) => ({ camp: g.camp, adg: g.adg, termCount: g.terms.size, clk: g.clk, spend: g.spend, sales: g.sales, orders: g.orders, acos: g.sales > 0 ? g.spend / g.sales : null }))
      .sort((a, b) => b.spend - a.spend);
  })();

  const kwRows = (() => {
    const groups = new Map();
    for (const s of (result && result.st) || []) {
      const kw = s.kw && s.kw.trim() !== '—' && s.kw.trim() !== '-' ? s.kw : null;
      if (!kw) continue;
      const key = canonOf(kw);
      const g = groups.get(key) || { kw, campCount: new Set(), adgCount: new Set(), clk: 0, spend: 0, sales: 0, orders: 0 };
      if (s.camp) g.campCount.add(canonOf(s.camp));
      if (s.adg) g.adgCount.add(canonOf(s.adg));
      g.clk += Number(s.clk) || 0;
      g.spend += Number(s.spend) || 0;
      g.sales += Number(s.sales) || 0;
      g.orders += Number(s.orders) || 0;
      groups.set(key, g);
    }
    return [...groups.values()]
      .map((g) => ({ kw: g.kw, campCount: g.campCount.size, adgCount: g.adgCount.size, clk: g.clk, spend: g.spend, sales: g.sales, orders: g.orders, acos: g.sales > 0 ? g.spend / g.sales : null }))
      .sort((a, b) => b.spend - a.spend);
  })();

  const mtRows = (() => {
    const groups = new Map();
    for (const s of (result && result.st) || []) {
      if (!s.mt) continue;
      const key = String(s.mt);
      const g = groups.get(key) || { mt: key, clk: 0, spend: 0, sales: 0, orders: 0, terms: new Set() };
      g.clk += Number(s.clk) || 0;
      g.spend += Number(s.spend) || 0;
      g.sales += Number(s.sales) || 0;
      g.orders += Number(s.orders) || 0;
      if (s.st && s.st.trim() !== '—' && s.st.trim() !== '-') g.terms.add(canonOf(s.st));
      groups.set(key, g);
    }
    return [...groups.values()]
      .map((g) => ({ mt: g.mt, termCount: g.terms.size, clk: g.clk, spend: g.spend, sales: g.sales, orders: g.orders, acos: g.sales > 0 ? g.spend / g.sales : null }))
      .sort((a, b) => b.spend - a.spend);
  })();

  const budgetRows = (() => {
    const groups = new Map();
    const keyOf = (camp, adg) => canonOf(camp) + '||' + canonOf(adg);
    for (const s of (result && result.st) || []) {
      if (!s.camp && !s.adg) continue;
      const key = keyOf(s.camp, s.adg);
      const g = groups.get(key) || { camp: s.camp, adg: s.adg, spend: 0, sales: 0, orders: 0, clk: 0 };
      g.spend += Number(s.spend) || 0;
      g.sales += Number(s.sales) || 0;
      g.orders += Number(s.orders) || 0;
      g.clk += Number(s.clk) || 0;
      groups.set(key, g);
    }
    let min = null, max = null;
    for (const s of (result && result.st) || []) {
      const m = String((s && s.date) || '').match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (!m) continue;
      const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
      if (min === null || t < min) min = t;
      if (max === null || t > max) max = t;
    }
    const days = (min === null || max === null) ? null : Math.max(1, Math.round((max - min) / 86400000) + 1);
    return [...groups.values()]
      .map((g) => ({ camp: g.camp, adg: g.adg, spend: g.spend, sales: g.sales, orders: g.orders,
        days: days || null, daily: days ? g.spend / days : null, acos: g.sales > 0 ? g.spend / g.sales : null }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 20);
  })();

  const missingDeps = (typeof window.checkSharedDeps === 'function')
    ? window.checkSharedDeps(null)
    : ['checkSharedDeps'];

  const depWarning = missingDeps.length
    ? t('p', { className: 'status err', role: 'alert' },
        '⚠ 共享规则脚本缺失：' + missingDeps.join('、') + '。业务规则已退回本地旧逻辑，请刷新页面或检查部署。')
    : null;

  return t('main', null,
    depWarning,
    t('section', { className: 'panel anim-fade-up' },
      t('p', { className: 'eyebrow' }, '旧工具页 · 报表分析'),
      t('h1', null, '导入报表并分析'),
      t('p', { className: 'callout' },
        '这是与工作台并行的旧分析入口：直接对搜索词报告做规则分析并给出五类清单。本次分析消耗积分；解析不到有效数据行不扣积分。'),
      t('form', { onSubmit },
        t('div', { className: 'form-grid' },
          t('label', null, '目标 ACOS（%）', t('input', { type: 'number', value: params.target, onChange: update('target') })),
          t('label', null, '预期转化率（%）', t('input', { type: 'number', value: params.ecvr, onChange: update('ecvr') })),
          t('label', null, '最少判断点击数', t('input', { type: 'number', value: params.min_clicks, onChange: update('min_clicks') })),
          t('label', null, '客单价（留空=自动）', t('input', { type: 'number', value: params.aov, onChange: update('aov'), placeholder: '自动' })),
          t('label', null, '单次提价上限（%）', t('input', { type: 'number', value: params.up_cap, onChange: update('up_cap') })),
          t('label', null, '单次降价上限（%）', t('input', { type: 'number', value: params.down_cap, onChange: update('down_cap') })),
          t('label', null, '最低出价', t('input', { type: 'number', value: params.floor, onChange: update('floor') })),
          t('label', null, '低曝光阈值', t('input', { type: 'number', value: params.imp_floor, onChange: update('imp_floor') })),
          t('label', { className: 'file-field' }, '广告报表（可多选）',
            t('input', { id: 'tool-files', type: 'file', multiple: true, accept: '.csv,.txt' }))),
        t('button', { className: 'primary', type: 'submit', disabled: busy },
          busy ? '正在分析…' : '开始分析', busy ? t('span', { className: 'spinner' }) : null)),
      error ? t('p', { className: 'error', role: 'alert' }, error) : null),
    t('section', { className: 'panel anim-fade-up stagger-1' },
      t('h2', null, '投放前去重（本地规则，数据不出本机）'),
      t('p', { className: 'hint' }, '已投放 = 现在正在跑的关键词；待投放 = 准备新开的关键词。冲突口径：精准（完全相同）> 词组（包含且顺序一致）> 广泛（包含全部词、顺序无关）。不做词形还原（lamp/lamps 算不同词），广泛匹配的语义扩展无法本地检测——结果需人工复核。'),
      t('div', { className: 'form-grid' },
        t('label', null, '已投放关键词（逗号/换行分隔）',
          t('textarea', { value: dedupState.existing, onChange: (e) => setDedupState((s) => ({ ...s, existing: e.target.value })), rows: 4, placeholder: '例如：\ncell phone stand\nphone holder' })),
        t('label', null, '待投放关键词（逗号/换行分隔）',
          t('textarea', { value: dedupState.planned, onChange: (e) => setDedupState((s) => ({ ...s, planned: e.target.value })), rows: 4, placeholder: '例如：\ncell phone\nlaptop stand' }))),
      t('div', { className: 'row' },
        t('button', { type: 'button', className: 'primary', onClick: runDedup }, '开始去重')),
      dedupState.result ? t('div', null,
        t('h3', null, `冲突 ${dedupState.result.conflicts.length} 组 / 干净 ${dedupState.result.clean.length} 个`),
        dedupState.result.conflicts.length ? t(DataTable, {
          title: '冲突明细', rows: dedupState.result.conflicts, max: 100,
          cols: [{ k: 'planned', label: '待投放词' }, { k: 'level', label: '冲突级别' },
            { k: 'existing', label: '与已投放冲突' }],
          note: '建议：精准/词组冲突的待投放词不要重复创建；广泛冲突说明两词覆盖同一批搜索，二选一即可。',
        }) : t('p', { className: 'muted' }, '没有冲突，全部待投放词都干净。'),
        dedupState.result.clean.length ? t('p', { className: 'muted' }, '干净待投放词：' + dedupState.result.clean.join('、')) : null) : null),
    kpi ? t('section', { className: 'panel anim-fade-up stagger-2' },
      t('h2', null, '概览'),
      t('div', { className: 'metrics' }, kpiCards.map(([label, value]) => t('div', { className: 'metric', key: label },
        t('span', null, label), t('strong', null, value == null ? '—' : String(value))))),
      result.aovAssumed ? t('p', { className: 'callout' }, '报表中没有订单，客单价按缺省值计算 —— 建议填写真实客单价后重新分析。') : null) : null,
    result ? t('section', { className: 'panel anim-fade-up stagger-2' },
      t('h2', null, '相关性四档（广告表现口径）'),
      t('div', { className: 'row' },
        focusQuestions.map(([q, grades]) => t('button', {
          type: 'button', key: q, className: focusGrade && grades.includes(focusGrade) ? 'primary' : '',
          onClick: () => setFocusGrade(focusGrade && grades.includes(focusGrade) ? null : grades[0]),
        }, q))),
      focusGrade ? t('p', { className: 'hint' }, '已聚焦「' + focusGrade + '」档，下表对应行加粗显示。') : null,
      t('div', { className: 'metrics' },
        [
          ['强认可（优秀+良好）', distRows.filter((d) => d.cls === '优秀' || d.cls === '良好').reduce((s, d) => s + d.n, 0), '更容易获得曝光与订单'],
          ['需优化（偏高）', distRows.filter((d) => d.cls === '偏高').reduce((s, d) => s + d.n, 0), '有转化但成本偏高'],
          ['高风险（亏损+无效）', distRows.filter((d) => d.cls === '亏损' || d.cls === '无效').reduce((s, d) => s + d.n, 0), '转化差或无转化，优先处理'],
          ['观察（潜力+观察）', distRows.filter((d) => d.cls === '潜力' || d.cls === '观察').reduce((s, d) => s + d.n, 0), '数据不足，继续积累'],
        ].map(([label, n, hint]) => t('div', { className: 'metric', key: label },
          t('span', null, label), t('strong', null, String(n)), t('small', null, hint))))) : null,
    result ? t(DataTable, {
      title: '搜索词分级分布' + (focusGrade ? '（聚焦：' + focusGrade + '）' : ''), rows: distRows.map((d) => ({
        ...d, cls: focusGrade === d.cls ? '★ ' + d.cls : d.cls,
      })), max: 10, file: '亚马逊投流-分级分布.csv',
      cols: [{ k: 'cls', label: '级别' }, { k: 'n', label: '搜索词数' }, { k: 'clk', label: '点击' },
        { k: 'spend', label: '花费' }, { k: 'sales', label: '销售额' }, { k: 'orders', label: '订单' },
        acosCol()],
    }) : null,
    result ? t(DataTable, {
      title: '调价清单', rows: result.actions, max: 100, file: '亚马逊投流-调价清单.csv',
      cols: [{ k: 'prio', label: '优先级' }, { k: 'cls', label: '级别' }, { k: 'act', label: '建议动作' },
        { k: 'kw', label: '关键词' }, { k: 'camp', label: '广告活动' }, { k: 'adg', label: '广告组' },
        { k: 'spend', label: '花费' }, { k: 'sales', label: '销售额' }, { k: 'orders', label: '订单' },
        acosCol()],
    }) : null,
    result ? t(DataTable, {
      title: '搜索词明细', rows: result.st, max: 100, file: '亚马逊投流-搜索词明细.csv',
      cols: [{ k: 'cls', label: '级别' }, { k: 'st', label: '搜索词' }, { k: 'kw', label: '关键词' },
        { k: 'clk', label: '点击' }, { k: 'spend', label: '花费' }, { k: 'sales', label: '销售额' },
        { k: 'orders', label: '订单' }, acosCol()],
    }) : null,
    result ? t(DataTable, {
      title: '词根挖掘', rows: result.roots, max: 100, file: '亚马逊投流-词根挖掘.csv',
      cols: [{ k: 'type', label: '类型' }, { k: 'tok', label: '词根' }, { k: 'terms', label: '出现词数' },
        { k: 'spend', label: '花费' }, { k: 'sales', label: '销售额' }, acosCol(), { k: 'sug', label: '建议' }],
    }) : null,
    result ? t(DataTable, {
      title: '投放关键词按活动拆分', rows: kwRows, max: 50, file: '亚马逊投流-投放关键词按活动拆分.csv',
      cols: [{ k: 'kw', label: '投放关键词' }, { k: 'campCount', label: '出现活动数' },
        { k: 'adgCount', label: '出现广告组数' }, { k: 'clk', label: '点击' },
        { k: 'spend', label: '花费' }, { k: 'orders', label: '订单' },
        { k: 'sales', label: '销售额' }, acosCol()],
      note: '出现活动数 ≥2 的词是潜在内耗点（与互搏检测互补：那张表只列冲突，这张给全景）。',
    }) : null,
    result ? t(DataTable, {
      title: '按匹配方式聚合（钱投给哪种？）', rows: mtRows, max: 10, file: '亚马逊投流-按匹配方式聚合.csv',
      cols: [{ k: 'mt', label: '匹配类型' }, { k: 'termCount', label: '搜索词数' },
        { k: 'clk', label: '点击' }, { k: 'spend', label: '花费' }, { k: 'orders', label: '订单' },
        { k: 'sales', label: '销售额' }, acosCol()],
      note: window.mtReading
        ? (window.mtReading(mtRows) || '按搜索词报表的匹配类型聚合——对应「花费主要花在哪里」的下钻口径。')
        : '按搜索词报表的匹配类型聚合——对应「花费主要花在哪里」的下钻口径。',
    }) : null,
    result ? t(DataTable, {
      title: '预算参考（事实数据，非建议）', rows: budgetRows, max: 20, file: '亚马逊投流-预算参考.csv',
      cols: [{ k: 'camp', label: '广告活动' }, { k: 'adg', label: '广告组' },
        { k: 'days', label: '覆盖天数', get: (r) => (r.days == null ? '未知' : r.days + ' 天') },
        { k: 'spend', label: '期间花费' }, { k: 'daily', label: '日均花费', get: (r) => (r.daily == null ? '—' : String(Math.round(r.daily * 100) / 100)) },
        { k: 'clk', label: '点击' }, { k: 'orders', label: '订单' },
        { k: 'sales', label: '销售额' }, acosCol()],
    }) : null,
    result ? t(DataTable, {
      title: '搜索词按活动拆分', rows: splitRows, max: 50, file: '亚马逊投流-搜索词按活动拆分.csv',
      cols: [{ k: 'camp', label: '广告活动' }, { k: 'adg', label: '广告组' },
        { k: 'termCount', label: '搜索词数' }, { k: 'clk', label: '点击' },
        { k: 'spend', label: '花费' }, { k: 'orders', label: '订单' },
        { k: 'sales', label: '销售额' }, acosCol()],
    }) : null,
    result ? t(DataTable, {
      title: '互搏检测', rows: result.conflicts, max: 50, file: '亚马逊投流-互搏检测.csv',
      cols: [{ k: 'st', label: '搜索词' }, { k: 'locs', label: '位置数' },
        { k: 'totClk', label: '总点击' }, { k: 'winner', label: '最优位置' },
        { k: 'losers', label: '其余位置与建议', get: (r) => (r.losers || []).map((l) => `${l.camp} / ${l.adg}：${l.sug}`).join('；') }],
      note: '匹配口径（对齐 Amazon 规则）：精准=完全相同（含 close variants）；词组=包含且顺序一致；广泛=包含全部词且顺序无关，另有语义扩展——实际内耗范围比字符串判断更大，否定前请人工确认。',
    }) : null,
    aiResult ? t('section', { className: 'panel anim-fade-up stagger-3' },
      t('h3', null, 'AI 结果（仅供参考，需人工复核）'),
      aiExpansions.length ? t(DataTable, {
        title: 'AI 扩词', rows: aiExpansions, max: 50,
        cols: [{ k: 'word', label: '关键词' }, { k: 'type', label: '类型' },
          { k: 'word', label: '本报表出现', get: (r) => {
            const ev = (window.evidenceFor && evidenceMap) ? window.evidenceFor(evidenceMap, r.word) : { rows: 0, orders: 0 };
            return window.evidenceLabel ? window.evidenceLabel(ev.rows, ev.orders) : '未出现';
          } },
          { k: 'word', label: '建议', get: (r) => {
            const ev = (window.evidenceFor && evidenceMap) ? window.evidenceFor(evidenceMap, r.word) : { rows: 0, orders: 0 };
            return window.adviceFor ? window.adviceFor(ev.rows, ev.orders) : '待验证';
          } },
          { k: 'reason', label: '理由' },
          { k: 'word', label: '命中复核品牌', get: (r) => (hitsBrand(r.word) ? '是' : '') }],
      }) : null,
      aiIntents.length ? t('div', { className: 'panel' },
        t('h3', null, '意图分组'),
        aiIntents.map((group, index) => t('p', { key: index },
          `${index + 1}. ${group.intent}：${(group.keywords || []).join('、')}`))) : null,
      aiNegatives.length ? t(DataTable, {
        title: 'AI 否定预判', rows: aiNegatives, max: 100,
        cols: [{ k: 'word', label: '否定候选' },
          { k: 'word', label: '与规则交叉验证', get: (r) => {
            // Protect any search term that actually produced orders, not only those the
            // rule engine happened to grade 优秀/良好 — matching the backend's protection.
            const protect = (s) => s.cls === '优秀' || s.cls === '良好' || Number(s.orders) > 0;
            const goodSet = new Set((result.st || []).filter(protect).map((s) => canonOf(s.st)));
            const wasteSet = new Set((result.st || []).filter((s) => s.cls === '无效').map((s) => canonOf(s.st)));
            const lossSet = new Set((result.roots || []).filter((x) => x.type === '亏损').map((x) => canonOf(x.tok)));
            return window.negativeCross
              ? window.negativeCross(r.word, { good: goodSet, waste: wasteSet, loss: lossSet, brandHit: hitsBrand(r.word) })
              : '仅 AI 建议，需人工复核';
          } },
          { k: 'reason', label: '理由' }],
      }) : null,
      aiInsights.length ? t('div', { className: 'panel' },
        t('h3', null, '专家洞察'),
        aiInsights.map((item, index) => t('p', { key: index }, `${item.title || '洞察'}：${item.detail || ''}`))) : null) : null,
    aiResult ? t('section', { className: 'panel anim-fade-up stagger-3' },
      t('h3', null, '新词候选（合并收割、组合与 AI 扩词，已去重）'),
      newWordRows.length
        ? t(DataTable, {
            title: '新词候选', rows: newWordRows, max: 100, file: '亚马逊投流-新词候选.csv',
            cols: [{ k: 'word', label: '建议关键词' }, { k: 'advice', label: '建议' },
              { k: 'camp', label: '建议活动' }, { k: 'adg', label: '建议组' },
              { k: 'src', label: '来源' }, { k: 'type', label: '类型' },
              { k: 'orders', label: '订单' }, { k: 'note', label: '说明' }],
          })
        : t('p', { className: 'muted' }, '没有可新增的候选（都已被过滤或去重）。')) : null,
    result ? t('section', { className: 'panel anim-fade-up stagger-4' },
      t('p', { className: 'eyebrow' }, 'AI 挖掘'),
      t('h2', null, '在线挖掘或导入专家结果'),
      t('p', { className: 'callout' }, '在线模式会调用模型并消耗积分；专家导入不调用模型。品牌复核名单只在当前页面有效，修改后会清除已合并的 AI 结果。'),
      t('div', { className: 'form-grid' },
        t('label', null, '接入方式',
          t('select', { value: ai.mode, onChange: updateAi('mode') },
            t('option', { value: 'expert' }, '专家导入（推荐，无需 Key）'),
            t('option', { value: 'proxy' }, '本机在线代理'),
            t('option', { value: 'direct' }, '直连（需 Key）'),
            t('option', { value: 'off' }, '关闭'))),
        t('label', null, '接口地址', t('input', { value: ai.baseUrl, onChange: updateAi('baseUrl'), placeholder: '默认使用本机配置' })),
        t('label', null, '模型', t('input', { value: ai.model, onChange: updateAi('model'), placeholder: '默认使用本机配置' })),
        t('label', null, 'API Key（不落盘）', t('input', { type: 'password', value: ai.apiKey, onChange: updateAi('apiKey'), placeholder: 'sk-...' })),
        t('label', null, '产品 / 品类信息', t('input', { value: ai.desc, onChange: updateAi('desc'), placeholder: '例：无线充电器，适用 iPhone 15' })),
        t('label', null, '需复核品牌（逗号分隔，可留空）', t('input', { value: ai.brands, onChange: (e) => { updateAi('brands')(e); setAiResult(null); }, placeholder: '例：品牌A, 品牌B' }))),
      t('div', { className: 'row' },
        t('button', { type: 'button', onClick: exportTopKeywords }, '导出优秀关键词'),
        t('label', { className: 'file-field' }, '导入专家结果 JSON', t('input', { type: 'file', accept: '.json', onChange: importExpert })),
        t('button', {
          type: 'button', className: 'primary', onClick: runOnline, disabled: aiBusy || ai.mode === 'off',
        }, aiBusy ? '正在调用模型…' : '在线 AI 挖掘', aiBusy ? t('span', { className: 'spinner' }) : null)),
      aiError ? t('p', { className: 'error', role: 'alert' }, aiError) : null) : null);
}

window.ToolView = ToolView;
