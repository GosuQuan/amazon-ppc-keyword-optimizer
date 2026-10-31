/* 前端 SPA：调后端 REST API 渲染全部结果；导出与 AI 合并在浏览器本地完成。 */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function fmtN(n, d) { if (typeof d !== 'number' || !isFinite(d) || d < 0 || d > 20) d = 0; if (n == null || !isFinite(n)) return '-'; return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d }); }
const fmtMoney = n => fmtN(n, 2);
function fmtPct(x, d) { if (d === undefined) d = 1; if (x == null || !isFinite(x)) return '-'; return (x * 100).toFixed(d) + '%'; }
const fmtDelta = v => (v == null || !isFinite(v)) ? '-' : (v > 0 ? '+' : '') + Math.round(v) + '%';
const round2 = n => Math.round((n + 1e-12) * 100) / 100;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const CLS_EN = { '优秀': 'exc', '良好': 'good', '观察': 'watch', '潜力': 'pot', '偏高': 'high', '亏损': 'loss', '无效': 'bad' };
const clsBadge = c => `<span class="badge b-${CLS_EN[c] || 'watch'}">${esc(c)}</span>`;
const MT_LABEL = { broad: '广泛', phrase: '词组', exact: '精准', auto: '自动', other: '-' };
function canon(s) { return String(s == null ? '' : s).toLowerCase().replace(/[\s\u3000]+/g, '').replace(/[()（）#％%：:，,。·'"“”\-—–_/\\]/g, ''); }
function toast(msg, err) { const b = $('#errbar'); if (!err) { b.style.display = 'none'; return; } b.textContent = '⚠ ' + msg; b.style.display = 'block'; setTimeout(() => { b.style.display = 'none'; }, 8000); }
window.__errors = []; window.addEventListener('error', e => { window.__errors.push(String(e.message)); toast('脚本错误：' + e.message, true); });

const state = { result: null, ai: { expansions: [], intents: [], negatives: [], insights: [], done: false } };
let P = {};

const LS_KEY = 'amazon-ppc-tool-v3';
const LS_FIELDS = ['inTarget', 'inEcvr', 'inMinClicks', 'inAov', 'inUpCap', 'inDownCap', 'inFloor', 'inImpFloor', 'aiMode', 'aiBaseUrl', 'aiModel', 'aiDesc'];
function saveSettings() { try { const d = {}; LS_FIELDS.forEach(id => { d[id] = $('#' + id).value; }); localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch (e) {} }
function loadSettings() { try { const d = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (!d) return; LS_FIELDS.forEach(id => { const el = $('#' + id); if (el && d[id] != null && d[id] !== '') el.value = d[id]; }); } catch (e) {} }
function readParams() {
  P = { target: +$('#inTarget').value || 25, ecvr: +$('#inEcvr').value || 10, minClicks: +$('#inMinClicks').value || 8,
        aovOverride: +$('#inAov').value || 0, upCap: +$('#inUpCap').value || 30, downCap: +$('#inDownCap').value || 50,
        floor: +$('#inFloor').value || 0.05, impFloor: +$('#inImpFloor').value || 500 };
  saveSettings(); return P;
}

function withAuth(options = {}) {
  const headers = { ...(options.headers || {}) };
  if (typeof sessionStorage !== 'undefined') headers.Authorization = 'Bearer ' + (sessionStorage.getItem('ppc_token') || '');
  return { ...options, headers };
}
if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem('ppc_token') && typeof location !== 'undefined') location.replace('/login.html');
/* ---------- 数据获取 ---------- */
async function analyzeWithFiles(files) {
  const fd = new FormData(); const p = readParams();
  for (const f of files) fd.append('files', f, f.name);
  Object.entries({ target: p.target, ecvr: p.ecvr, minClicks: p.minClicks, aov: p.aovOverride, upCap: p.upCap, downCap: p.downCap, floor: p.floor, impFloor: p.impFloor })
    .forEach(([k, v]) => fd.append(k, String(v)));
  const r = await fetch('/api/analyze', withAuth({ method: 'POST', body: fd }));
  const d = await r.json();
  if (!r.ok) { renderFileList(d.files || [], d.error); toast(d.error || '分析失败', true); return; }
  applyResult(d);
}
async function analyzeDemo() {
  const p = readParams();
  const qs = new URLSearchParams({ target: p.target, ecvr: p.ecvr, minClicks: p.minClicks, aov: p.aovOverride });
  const r = await fetch('/api/demo?' + qs.toString(), withAuth());
  applyResult(await r.json());
}
function applyResult(d) {
  state.result = d; state.ai.done = false;
  renderFileList(d.files || []);
  renderAll(); switchTab('pane-overview');
  $('#secResult').style.display = 'block';
  $('#secResult').scrollIntoView({ behavior: 'smooth' });
}
function renderFileList(files, error) {
  $('#fileList').innerHTML = files.map(f => `<span class="chip">${esc(f.name)}：${f.rows ? fmtN(f.rows) + ' 行' : '<b style="color:#b91c1c">' + esc(f.error || '无数据') + '</b>'}</span>`).join('')
    + (error ? `<span class="chip"><b style="color:#b91c1c">${esc(error)}</b></span>` : '');
}

/* ---------- 表格组件 ---------- */
function mkTable(hostId, cfg) {
  const host = document.getElementById(hostId); host.innerHTML = '';
  const max = cfg.max || 200;
  const bar = document.createElement('div'); bar.className = 'tbar';
  const inp = document.createElement('input'); inp.className = 'tsearch'; inp.placeholder = '搜索过滤…';
  const cnt = document.createElement('span'); cnt.className = 'tcount';
  const btn = document.createElement('button'); btn.className = 'btn ghost mini'; btn.textContent = '导出本表 CSV';
  bar.append(inp, cnt, btn); host.append(bar);
  const wrap = document.createElement('div'); wrap.className = 'twrap'; host.append(wrap);
  let sortK = cfg.sortKey || null, sortDir = cfg.sortDir || -1, filt = '';
  const cellVal = (r, c) => c.get ? c.get(r) : (r[c.k] == null ? '' : r[c.k]);
  function compute() {
    let rows = cfg.rows();
    if (filt) { const f = filt.toLowerCase(); rows = rows.filter(r => cfg.cols.some(c => String(cellVal(r, c)).replace(/<[^>]*>/g, '').toLowerCase().includes(f))); }
    if (sortK != null) {
      const c = cfg.cols.find(x => x.k === sortK);
      rows = [...rows].sort((a, b) => {
        let va = cellVal(a, c), vb = cellVal(b, c);
        if (c.num) { va = +String(va).replace(/[^0-9.\-]/g, '') || 0; vb = +String(vb).replace(/[^0-9.\-]/g, '') || 0; return (va - vb) * sortDir; }
        return String(va).localeCompare(String(vb), 'zh') * sortDir;
      });
    }
    return rows;
  }
  function render() {
    const rows = compute();
    cnt.textContent = '共 ' + rows.length + ' 条' + (rows.length > max ? '，显示前 ' + max + ' 条' : '');
    let html = '<table><thead><tr>';
    for (const c of cfg.cols) html += `<th data-k="${esc(c.k)}" class="${c.num ? 'num' : ''}">${esc(c.label)}${sortK === c.k ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
    html += '</tr></thead><tbody>';
    rows.slice(0, max).forEach(r => {
      html += '<tr>' + cfg.cols.map(c => { const v = cellVal(r, c); return `<td class="${c.num ? 'num' : ''}">${c.fmt ? c.fmt(v, r) : esc(v)}</td>`; }).join('') + '</tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
    wrap.querySelectorAll('th').forEach(th => th.onclick = () => { const k = th.dataset.k; if (sortK === k) sortDir *= -1; else { sortK = k; sortDir = -1; } render(); });
  }
  inp.oninput = () => { filt = inp.value.trim(); render(); };
  btn.onclick = () => {
    const rows = compute();
    const csv = csvString(cfg.cols.map(c => c.label), rows.map(r => cfg.cols.map(c => c.csv ? c.csv(r) : String(cellVal(r, c)).replace(/<[^>]*>/g, ''))));
    downloadCSV((cfg.name || '导出') + '.csv', csv);
  };
  render();
}
function csvCell(v) { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function csvString(headers, rows) { return '\ufeff' + [headers.map(csvCell).join(',')].concat(rows.map(r => r.map(csvCell).join(','))).join('\r\n'); }
function downloadCSV(name, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
}

/* ---------- 渲染 ---------- */
function renderAll() {
  const R = state.result, kp = R.kpi;
  const cards = [
    ['数据行数', fmtN(kp.rows), (R.files || []).length + ' 个文件'],
    ['曝光', fmtN(kp.imp), ''], ['点击', fmtN(kp.clk), 'CTR ' + fmtPct(kp.imp > 0 ? kp.clk / kp.imp : null)],
    ['花费', fmtMoney(kp.spend), ''], ['销售额', fmtMoney(kp.sales), ''],
    ['订单', fmtN(kp.orders), '客单价 ' + fmtMoney(R.aov) + (R.aovAssumed ? '（缺省值）' : '')],
    ['整体 ACOS', fmtPct(kp.acos), '目标 ' + fmtPct(P.target / 100, 0)],
    ['搜索词 / 关键词', fmtN(kp.stCount) + ' / ' + fmtN((R.actions || []).length), ''],
  ];
  $('#kpiRow').innerHTML = cards.map(c => `<div class="kpi"><div class="k">${c[0]}</div><div class="v">${c[1]}</div>${c[2] ? `<div class="s">${c[2]}</div>` : ''}</div>`).join('');
  const ord = ['优秀', '良好', '偏高', '亏损', '无效', '潜力', '观察'];
  const distRows = ord.filter(c => R.dist[c]).map(c => { const d = R.dist[c]; return { cls: c, n: d.n, clk: d.clk, spend: d.spend, sales: d.sales, orders: d.orders, acos: d.sales > 0 ? d.spend / d.sales : null }; });
  mkTable('distHost', { name: '搜索词分级分布', rows: () => distRows, max: 10, cols: [
    { k: 'cls', label: '级别', fmt: v => clsBadge(v), csv: r => r.cls }, { k: 'n', label: '搜索词数', num: true, fmt: fmtN },
    { k: 'clk', label: '点击', num: true, fmt: fmtN }, { k: 'spend', label: '花费', num: true, fmt: fmtMoney },
    { k: 'sales', label: '销售额', num: true, fmt: fmtMoney }, { k: 'orders', label: '订单', num: true, fmt: fmtN },
    { k: 'acos', label: 'ACOS', num: true, fmt: v => fmtPct(v) }] });
  $('#distNote').innerHTML = R.aovAssumed ? '⚠ 报表中没有订单，客单价按缺省值 25 计算 —— 请在「优化参数」中填写真实客单价后重新分析。' : '';
  mkTable('tblActions', { name: '亚马逊投流-调价清单', rows: () => R.actions, max: 300, cols: [
    { k: 'prio', label: '优先级', fmt: v => `<span class="badge b-${String(v).toLowerCase()}">${esc(v)}</span>`, csv: r => r.prio },
    { k: 'cls', label: '级别', fmt: v => clsBadge(v), csv: r => r.cls }, { k: 'act', label: '建议动作' },
    { k: 'kw', label: '关键词' }, { k: 'mt', label: '匹配', get: r => MT_LABEL[r.mt] || r.mtRaw, csv: r => MT_LABEL[r.mt] || r.mtRaw },
    { k: 'camp', label: '广告活动' }, { k: 'adg', label: '广告组' },
    { k: 'delta', label: '调整幅度', num: true, fmt: v => fmtDelta(v), csv: r => fmtDelta(r.delta) },
    { k: 'newBid', label: '建议出价', num: true, fmt: v => v != null ? fmtMoney(v) : '-', csv: r => r.newBid != null ? fmtMoney(r.newBid) : '' },
    { k: 'curBid', label: '现出价(估)', num: true, fmt: fmtMoney },
    { k: 'clk', label: '点击', num: true, fmt: fmtN }, { k: 'spend', label: '花费', num: true, fmt: fmtMoney },
    { k: 'sales', label: '销售额', num: true, fmt: fmtMoney }, { k: 'orders', label: '订单', num: true, fmt: fmtN },
    { k: 'acos', label: 'ACOS', num: true, fmt: v => fmtPct(v) }, { k: 'reason', label: '理由', fmt: esc }] });
  const stValid = () => R.st.filter(s => s.st && s.st.trim() !== '—' && s.st.trim() !== '-');
  mkTable('tblSt', { name: '亚马逊投流-搜索词明细', rows: stValid, max: 300, sortKey: 'spend', cols: [
    { k: 'cls', label: '级别', fmt: v => clsBadge(v), csv: r => r.cls }, { k: 'st', label: '搜索词' },
    { k: 'camp', label: '广告活动' }, { k: 'adg', label: '广告组' }, { k: 'kw', label: '关键词' },
    { k: 'mt', label: '匹配', get: r => MT_LABEL[r.mt] || r.mtRaw, csv: r => MT_LABEL[r.mt] || r.mtRaw },
    { k: 'imp', label: '展示', num: true, fmt: fmtN }, { k: 'clk', label: '点击', num: true, fmt: fmtN },
    { k: 'ctr', label: 'CTR', num: true, fmt: v => fmtPct(v) }, { k: 'spend', label: '花费', num: true, fmt: fmtMoney },
    { k: 'sales', label: '销售额', num: true, fmt: fmtMoney }, { k: 'orders', label: '订单', num: true, fmt: fmtN },
    { k: 'acos', label: 'ACOS', num: true, fmt: v => fmtPct(v) }, { k: 'allowed', label: '允许预算', num: true, fmt: fmtMoney }] });
  mkTable('tblRoots', { name: '亚马逊投流-词根挖掘', rows: () => R.roots, max: 200, cols: [
    { k: 'type', label: '类型', fmt: v => `<span class="badge b-${v === '盈利' ? 'exc' : v === '亏损' ? 'bad' : v === '加分' ? 'good' : 'high'}">${esc(v)}</span>`, csv: r => r.type },
    { k: 'tok', label: '词根' }, { k: 'terms', label: '出现词数', num: true, fmt: fmtN },
    { k: 'clk', label: '点击', num: true, fmt: fmtN }, { k: 'spend', label: '花费', num: true, fmt: fmtMoney },
    { k: 'sales', label: '销售额', num: true, fmt: fmtMoney }, { k: 'orders', label: '订单', num: true, fmt: fmtN },
    { k: 'acos', label: 'ACOS', num: true, fmt: v => fmtPct(v) }, { k: 'sug', label: '建议', fmt: esc }] });
  mkTable('tblNew', { name: '亚马逊投流-新词候选', rows: () => newWordRows(), max: 200, cols: [
    { k: 'src', label: '来源', fmt: v => v === 'AI扩词' ? '<span class="badge b-ai">AI扩词</span>' : esc(v), csv: r => r.src },
    { k: 'word', label: '建议关键词' }, { k: 'type', label: '类型/支持' },
    { k: 'camp', label: '建议放入广告活动' }, { k: 'adg', label: '建议放入广告组' },
    { k: 'sales', label: '销售额', num: true, fmt: fmtMoney }, { k: 'orders', label: '订单', num: true, fmt: fmtN },
    { k: 'acos', label: 'ACOS', num: true, fmt: v => fmtPct(v) }, { k: 'note', label: '说明', fmt: esc }] });
  mkTable('tblConflict', { name: '亚马逊投流-互搏检测', rows: () => R.conflicts, max: 100, cols: [
    { k: 'st', label: '搜索词' }, { k: 'locs', label: '位置数', num: true, fmt: fmtN },
    { k: 'totClk', label: '总点击', num: true, fmt: fmtN }, { k: 'winner', label: '最优位置', fmt: esc },
    { k: 'losers', label: '其余位置与建议', get: r => r.losers.map(l => esc(l.camp + ' / ' + l.adg + '：' + l.sug)).join('<br>'), csv: r => r.losers.map(l => l.camp + ' / ' + l.adg + '：' + l.sug).join('；') }] });
  renderAI();
}
function newWordRows() {
  const R = state.result, rows = [];
  for (const h of R.harvest) rows.push({ src: '搜索词收割', word: h.st, type: h.sug, camp: h.camp, adg: h.adg, sales: h.sales, orders: h.orders, acos: h.acos, note: '来自' + MT_LABEL[h.srcMt] + '匹配，ACOS ' + fmtPct(h.acos) });
  for (const c of R.combos) rows.push({ src: '组合挖掘', word: c.pair, type: '组合新词', camp: '', adg: '', sales: c.sales, orders: c.orders, acos: null, note: c.evidence });
  for (const e of state.ai.expansions) rows.push({ src: 'AI扩词', word: e.word, type: e.type || 'AI', camp: '', adg: '', sales: null, orders: null, acos: null, note: e.reason + (e.exists ? '（已有精准词，注意去重）' : e.coveredByGood ? '（已包含在优质词中，不必单独新增）' : '') });
  return rows;
}

/* ---------- AI：专家导入 / 在线 ---------- */
function exactKwSet() { return new Set((state.result.actions || []).filter(a => a.mt === 'exact').map(a => canon(a.kw))); }
function wasteStSet() { return new Set(state.result.st.filter(s => s.cls === '无效' && s.st && s.st.trim() !== '—' && s.st.trim() !== '-').map(s => canon(s.st))); }
function goodStSet() { return new Set(state.result.st.filter(s => (s.cls === '优秀' || s.cls === '良好') && s.st && s.st.trim() !== '—' && s.st.trim() !== '-').map(s => canon(s.st))); }
function lossRootSet() { return new Set((state.result.roots || []).filter(r => r.type === '亏损').map(r => canon(r.tok))); }
function aiStatus(msg, cls) { const el = $('#aiStatus'); el.className = 'status ' + (cls || ''); el.textContent = msg; }
function parseAiText(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('返回缺少最终 content（非空文本）；推理内容不能作为结果');
  let txt = text.trim();
  const fenced = txt.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) txt = fenced[1].trim();
  // Parse complete JSON first so arrays/scalars cannot be mistaken for a nested result object.
  try { return JSON.parse(txt); } catch (e) {
    if (/^[\[{]/.test(txt)) throw new Error('AI JSON 不完整或格式错误，请重新生成完整结果');
  }
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('最终 content 未包含完整 JSON 对象');
  try { return JSON.parse(txt.slice(a, b + 1)); }
  catch (e) { throw new Error('AI JSON 不完整或格式错误，请重新生成完整结果'); }
}
function parseAiResponse(response) {
  const choice = response && Array.isArray(response.choices) && response.choices[0];
  if (choice && choice.finish_reason === 'length') {
    throw new Error('模型输出已截断（finish_reason=length），本次结果未合并。请减少输出量或提高输出 token 上限后重试');
  }
  return parseAiText(choice && choice.message && choice.message.content);
}
function validateAiJson(j) {
  const object = (v, path) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(path + ' 必须是对象');
  };
  const text = (v, path, required = false) => {
    if (typeof v !== 'string' || (required && !v.trim())) throw new Error(path + (required ? ' 必须是非空字符串' : ' 必须是字符串'));
  };
  const optionalText = (v, key, path) => { if (Object.prototype.hasOwnProperty.call(v, key)) text(v[key], path + '.' + key); };
  const keys = ['expansions', 'intents', 'negativeHints', 'insights'];
  object(j, 'AI 结果');
  if (!keys.some(k => Object.prototype.hasOwnProperty.call(j, k))) throw new Error('AI 结果至少需要 expansions/intents/negativeHints/insights 中一个数组');
  const result = {};
  for (const key of keys) {
    const rows = Object.prototype.hasOwnProperty.call(j, key) ? j[key] : [];
    if (!Array.isArray(rows)) throw new Error(key + ' 必须是数组');
    result[key] = rows.map((row, i) => {
      const path = key + '[' + i + ']';
      object(row, path);
      if (key === 'expansions' || key === 'negativeHints') {
        text(row.word, path + '.word', true);
        optionalText(row, 'reason', path);
        if (key === 'expansions') optionalText(row, 'type', path);
      } else if (key === 'intents') {
        text(row.intent, path + '.intent', true);
        if (!Array.isArray(row.keywords)) throw new Error(path + '.keywords 必须是数组');
        row.keywords.forEach((word, n) => text(word, path + '.keywords[' + n + ']', true));
      } else {
        optionalText(row, 'title', path); optionalText(row, 'detail', path);
        if (!(row.title || '').trim() && !(row.detail || '').trim()) throw new Error(path + ' 至少需要非空 title 或 detail');
      }
      return row;
    });
  }
  return result;
}
function expansionCoveredByGood(word, goodTerms) {
  if (word.length < 4) return false;
  for (const term of goodTerms) {
    if (term.length > word.length && term.includes(word)) return true;
  }
  return false;
}
function negativeContainedInGood(word, goodTerms) {
  if (word.length < 4) return false;
  for (const term of goodTerms) {
    if (term.length < 4 || term === word) continue;
    if (term.includes(word) || word.includes(term)) return true;
  }
  return false;
}
function mergeAiJson(j) {
  j = validateAiJson(j);
  const exact = exactKwSet(), waste = wasteStSet(), good = goodStSet(), loss = lossRootSet();
  const expansions = j.expansions.map(e => { const word = canon(e.word); return { word: e.word.trim(), type: e.type || 'AI', reason: e.reason || '', exists: exact.has(word), coveredByGood: expansionCoveredByGood(word, good) }; });
  const intents = j.intents;
  const negatives = j.negativeHints.map(e => {
    const w = canon(e.word); let cross = '仅 AI 建议，需人工复核';
    if (waste.has(w) || loss.has(w)) cross = '与规则一致（高置信）';
    else if (good.has(w) || negativeContainedInGood(w, good)) cross = '⚠ 与优质数据冲突，不建议否定';
    return { word: e.word.trim(), reason: e.reason || '', cross };
  });
  state.ai = { expansions, intents, negatives, insights: j.insights, done: true };
  aiStatus(`已合并：扩词 ${state.ai.expansions.length} 个，意图分组 ${state.ai.intents.length} 组，否定预判 ${state.ai.negatives.length} 个，洞察 ${state.ai.insights.length} 条。已并入「新词候选」与导出清单。`, 'ok');
  renderAI(); switchTab('pane-ai');
}
function importExpertJson(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      mergeAiJson(parseAiText(rd.result));
    } catch (e) { aiStatus('导入失败：' + e.message + '（需要含 expansions/intents/negativeHints/insights 至少一个数组的 JSON，可含说明文字）', 'err'); }
  };
  rd.readAsText(file, 'utf-8');
}
function aiEvidenceLine(result) {
  const kpi = result && result.kpi || {};
  const context = result && result.context || {};
  const parts = [];
  const label = (name, value) => { const text = String(value || '').trim(); if (/^[A-Za-z0-9._:-]{2,40}$/.test(text)) parts.push(name + ' ' + text); };
  const number = (name, value) => { if (typeof value === 'number' && isFinite(value)) parts.push(name + ' ' + value); };
  label('站点', context.marketplace);
  label('ASIN', context.asin);
  label('币种', context.currency);
  number('花费', kpi.spend);
  number('销售额', kpi.sales);
  number('订单', kpi.orders);
  number('点击', kpi.clk);
  if (typeof kpi.acos === 'number' && isFinite(kpi.acos)) parts.push('ACOS ' + (kpi.acos * 100).toFixed(2) + '%');
  if (typeof P.target === 'number' && isFinite(P.target)) parts.push('目标ACOS ' + P.target + '%');
  return parts.length ? '\n【已发生指标】' + parts.join('，') + '。这些是历史合计，不是预测，也不是已节省金额。' : '';
}
async function runAiOnline() {
  const mode = $('#aiMode').value;
  if (!state.result) { aiStatus('请先载入数据。', 'err'); return; }
  const top = state.result.st.filter(s => s.st && s.cls === '优秀').sort((a, b) => b.sales - a.sales).slice(0, 40).map(s => s.st);
  if (!top.length) { aiStatus('没有优秀关键词可供挖掘。', 'err'); return; }
  const roots = state.result.roots.filter(r => r.type === '盈利' || r.type === '加分').slice(0, 15).map(r => r.tok);
  const sys = '你是亚马逊广告关键词专家。根据优质搜索词、盈利词根、产品信息和已发生指标，输出严格 JSON（无 markdown）：{"expansions":[{"word":"","type":"长尾|场景|人群|规格","reason":""}],"intents":[{"intent":"","keywords":[""]}],"negativeHints":[{"word":"","reason":""}],"insights":[{"title":"","detail":""}]}。expansions 15~30 个跟随输入语言且不重复；intents 3~6 组；negativeHints 只列明显无关词。不要把历史花费写成已节省金额，也不要预测增量订单。';
  const user = '【产品信息】' + ($('#aiDesc').value || '（未填写）') + aiEvidenceLine(state.result) + '\n【优质搜索词】\n' + top.join('\n') + (roots.length ? '\n【盈利词根】' + roots.join(', ') : '');
  aiStatus('正在调用在线模型…', 'busy');
  try {
    const body = { messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], temperature: 0.3 };
    if (mode === 'direct') { body.base_url = $('#aiBaseUrl').value.trim(); body.model = $('#aiModel').value.trim(); body.api_key = $('#aiKey').value.trim(); if (!body.api_key) throw new Error('直连模式需要填写 API Key'); }
    const r = await fetch('/api/ai/chat', withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ? JSON.stringify(j.error) : 'HTTP ' + r.status);
    mergeAiJson(parseAiResponse(j));
  } catch (e) {
    let m = 'AI 调用失败：' + e.message;
    if (/401|令牌/i.test(m)) m += '\n提示：推荐改用「专家导入」模式（无需 Key）：导出优秀关键词 → 发给「亚马逊数据挖掘专家」Agent → 导入 JSON。';
    if (/Failed to fetch/i.test(m)) m += '\n提示：后端未启动或接口不可达。';
    aiStatus(m, 'err');
  }
}
function renderAI() {
  if (!state.ai.done) { $('#aiExp').innerHTML = '<p class="hint">三种方式：① <b>专家导入（推荐，无需 Key）</b>——导出优秀关键词发给「亚马逊数据挖掘专家」Agent，把返回 JSON 导入；② 在线代理/直连；③ 关闭仅用规则。</p>'; $('#aiIntent').innerHTML = ''; $('#aiNeg').innerHTML = ''; $('#aiInsight').innerHTML = ''; return; }
  mkTable('aiExp', { name: 'AI扩词', rows: () => state.ai.expansions, max: 200, cols: [
    { k: 'word', label: 'AI 建议关键词' }, { k: 'type', label: '类型', fmt: v => `<span class="badge b-ai">${esc(v)}</span>`, csv: r => r.type },
    { k: 'exists', label: '查重', get: r => r.exists ? '已有精准词，注意去重' : r.coveredByGood ? '已包含在优质词中' : '新词', csv: r => r.exists ? '已有精准词' : r.coveredByGood ? '已包含在优质词中' : '新词' }, { k: 'reason', label: '理由', fmt: esc }] });
  $('#aiIntent').innerHTML = state.ai.intents.map((g, i) => `<div class="intent-card"><b>${i + 1}. ${esc(g.intent)}</b><div>${g.keywords.map(k => `<span class="kwchip">${esc(k)}</span>`).join('')}</div></div>`).join('') || '<p class="hint">无意图分组。</p>';
  $('#aiInsight').innerHTML = state.ai.insights.map(x => `<div class="insight-card"><b>${esc(x.title || '洞察')}</b>　${esc(x.detail || '')}</div>`).join('') || '<p class="hint">无洞察。</p>';
  mkTable('aiNeg', { name: 'AI否定预判', rows: () => state.ai.negatives, max: 200, cols: [
    { k: 'word', label: 'AI 判定无关词' }, { k: 'cross', label: '与规则交叉验证' }, { k: 'reason', label: '理由', fmt: esc }] });
}
function exportKwForExpert() {
  const R = state.result;
  if (!R) { toast('请先载入数据', true); return; }
  const top = R.st.filter(s => s.st && (s.cls === '优秀' || s.cls === '良好')).sort((a, b) => b.sales - a.sales).slice(0, 40);
  const roots = (R.roots || []).filter(r => r.type === '盈利' || r.type === '加分').slice(0, 15).map(r => r.tok);
  const lines = ['【产品信息】' + ($('#aiDesc').value || '（未填写）'), '', '【优秀搜索词（按销售额排序）】', ...top.map(s => `${s.st}（ACOS ${fmtPct(s.acos)}，订单 ${s.orders}）`), '', '【盈利词根】' + roots.join(', '), '', '请按你的协作契约输出中文解读 + 严格 JSON。'];
  const text = lines.join('\n');
  downloadCSV('亚马逊优秀关键词-给专家.txt', text);
  try { navigator.clipboard.writeText(text); } catch (e) {}
  aiStatus('已导出并复制到剪贴板：把内容发给「亚马逊数据挖掘专家」Agent，拿回 JSON 后点「导入专家结果 JSON」。', 'ok');
}

/* ---------- 自检 ---------- */
async function runSelfTestBtn() {
  const host = $('#selfTestOut'); host.style.display = 'block';
  host.innerHTML = '<div class="tbar"><b>正在运行后端自检…</b></div>';
  try {
    const r = await fetch('/api/selftest', { method: 'POST' });
    const d = await r.json();
    host.innerHTML = `<div class="tbar"><b>自检结果：${d.passed} / ${d.total} 通过</b>${d.passed === d.total ? '<span class="badge b-exc">全部通过</span>' : '<span class="badge b-bad">存在失败</span>'}</div>` +
      `<div class="twrap" style="max-height:300px"><table><tbody>` + d.results.map(r => `<tr><td class="${r.passed ? 'st-pass' : 'st-fail'}" style="width:30px">${r.passed ? '✓' : '✗'}</td><td>${esc(r.name)}</td><td class="small reason">${esc(r.msg || '')}</td></tr>`).join('') + '</tbody></table></div>';
  } catch (e) { host.innerHTML = '<div class="tbar"><b class="st-fail">自检失败：后端不可达</b></div>'; }
}

/* ---------- 接线 ---------- */
function switchTab(id) { $$('.tabbtn').forEach(b => b.classList.toggle('on', b.dataset.tab === id)); $$('.pane').forEach(p => p.classList.toggle('on', p.id === id)); }
const drop = $('#drop'), fileInput = $('#fileInput');
drop.onclick = () => fileInput.click();
fileInput.onchange = e => { if (e.target.files.length) analyzeWithFiles([...e.target.files]); fileInput.value = ''; };
['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('on'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('on'); }));
drop.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) analyzeWithFiles([...e.dataTransfer.files]); });
$('#btnDemo').onclick = () => analyzeDemo().catch(e => toast('后端不可达：' + e.message, true));
$('#btnSelfTest').onclick = runSelfTestBtn;
$('#btnRecalc').onclick = () => { if (state.result) analyzeDemo.call ? null : null; if (state.result) { const files = null; if (state.result.files && state.result.files.length && state.result.files[0].name.startsWith('示例数据')) analyzeDemo(); else analyzeLastFiles(); } };
let lastFiles = null;
const _origAnalyze = analyzeWithFiles;
analyzeWithFiles = async function (files) { lastFiles = files; return _origAnalyze(files); };
function analyzeLastFiles() { if (lastFiles) analyzeWithFiles(lastFiles); else analyzeDemo(); }
$('#btnAI').onclick = runAiOnline;
$('#btnExportKw').onclick = exportKwForExpert;
$('#aiImportFile').onchange = e => { if (e.target.files.length) importExpertJson(e.target.files[0]); e.target.value = ''; };
$('#tabRow').addEventListener('click', e => { const b = e.target.closest('.tabbtn'); if (b) switchTab(b.dataset.tab); });
$$('[data-exp]').forEach(b => b.onclick = () => {
  const R = state.result; if (!R) { toast('请先载入数据', true); return; }
  const names = { actions: '调价清单', negatives: '否定词清单', newwords: '新增关键词清单', roots: '词根挖掘表', stdetail: '搜索词明细' };
  const map = {
    actions: () => csvString(['优先级','级别','建议动作','广告活动','广告组','关键词','匹配类型','当前出价(估算)','建议出价(估算)','调整幅度%','点击','花费','销售额','订单','ACOS','理由'], R.actions.map(a => [a.prio,a.cls,a.act,a.camp,a.adg,a.kw,MT_LABEL[a.mt]||a.mtRaw,fmtMoney(a.curBid),a.newBid!=null?fmtMoney(a.newBid):'',fmtDelta(a.delta),a.clk,a.spend,a.sales,a.orders,fmtPct(a.acos),a.reason])),
    negatives: () => { const ai = state.ai.negatives.map(e => ['精准否定',e.word,'','','AI预判'+(e.cross.indexOf('一致')>=0?'（与规则一致）':''),'', '', e.reason]); return csvString(['否定方式','否定词','广告活动','广告组','来源','点击','花费','理由'], R.negatives.map(n=>[n.type,n.word,n.camp,n.adg,n.source,n.clk,n.spend,n.reason]).concat(ai)); },
    newwords: () => csvString(['建议关键词','建议匹配类型','建议放入广告活动','建议放入广告组','来源','类型','说明'], newWordRows().map(r=>[r.word,'精准',r.camp,r.adg,r.src,r.type,r.note])),
    roots: () => csvString(['词根','类型','出现词数','点击','花费','销售额','订单','ACOS','建议'], R.roots.map(r=>[r.tok,r.type,r.terms,r.clk,r.spend,r.sales,r.orders,fmtPct(r.acos),r.sug])),
    stdetail: () => { const v = R.st.filter(s=>s.st&&s.st.trim()!=='—'&&s.st.trim()!=='-'); return csvString(['级别','搜索词','广告活动','广告组','关键词','匹配类型','展示','点击','CTR','花费','销售额','订单','ACOS','允许预算'], v.map(s=>[s.cls,s.st,s.camp,s.adg,s.kw,MT_LABEL[s.mt]||s.mtRaw,s.imp,s.clk,fmtPct(s.ctr,2),s.spend,s.sales,s.orders,fmtPct(s.acos),fmtMoney(s.allowed)])); },
  };
  downloadCSV('亚马逊投流-' + names[b.dataset.exp] + '.csv', map[b.dataset.exp]());
});
loadSettings();
window.__app = { state, switchTab };
