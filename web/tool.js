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
    result ? t(DataTable, {
      title: '互搏检测', rows: result.conflicts, max: 50, file: '亚马逊投流-互搏检测.csv',
      cols: [{ k: 'st', label: '搜索词' }, { k: 'locs', label: '位置数' }, { k: 'totClk', label: '总点击' },
        { k: 'winner', label: '最优位置' }],
    }) : null);
}

window.ToolView = ToolView;
