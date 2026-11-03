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

function DataTable({ title, rows, cols, max, file }) {
  const list = (rows || []).slice(0, max || 100);
  if (!list.length) return null;
  return t('section', { className: 'panel anim-fade-up' },
    t('div', { className: 'section-head' },
      t('h3', null, `${title}（${list.length} 条）`),
      file ? t('button', { type: 'button', onClick: () => downloadCsv(file, cols, list) }, '导出 CSV') : null),
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

  const evidenceMap = (typeof React.useMemo === 'function')
    ? React.useMemo(() => (window.buildReportEvidence ? window.buildReportEvidence((result && result.st) || []) : null), [result])
    : null;
  const aiExpansions = (typeof window.sortByEvidence === 'function')
    ? window.sortByEvidence((aiResult && aiResult.expansions) || [])
    : ((aiResult && aiResult.expansions) || []);
  const aiIntents = (aiResult && aiResult.intents) || [];
  const aiNegatives = (aiResult && aiResult.negativeHints) || [];
  const aiInsights = (aiResult && aiResult.insights) || [];

  return t('main', null,
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
    kpi ? t('section', { className: 'panel anim-fade-up stagger-2' },
      t('h2', null, '概览'),
      t('div', { className: 'metrics' }, kpiCards.map(([label, value]) => t('div', { className: 'metric', key: label },
        t('span', null, label), t('strong', null, value == null ? '—' : String(value))))),
      result.aovAssumed ? t('p', { className: 'callout' }, '报表中没有订单，客单价按缺省值计算 —— 建议填写真实客单价后重新分析。') : null) : null,
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
      aiNegatives.length ? t('div', { className: 'panel' },
        t('h3', null, '否定预判（需确认不会误伤自有词）'),
        aiNegatives.map((item, index) => t('p', { key: index }, `${item.word} —— ${item.reason || ''}`))) : null,
      aiInsights.length ? t('div', { className: 'panel' },
        t('h3', null, '专家洞察'),
        aiInsights.map((item, index) => t('p', { key: index }, `${item.title || '洞察'}：${item.detail || ''}`))) : null) : null,
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
