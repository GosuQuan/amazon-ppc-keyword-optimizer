'use strict';
/* Shared evidence helper: how often a suggested keyword already appears in our own
   search-term report, and how many orders those rows produced.
   This is OUR report data — never presented as competitor evidence. */

function canonWord(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[()（）#％%：:，,。·'"“”\-—–_/\\]/g, '');
}

function buildReportEvidence(stRows) {
  const map = new Map();
  for (const row of (stRows || [])) {
    const key = canonWord(row && row.st);
    if (!key) continue;
    const hit = map.get(key) || { rows: 0, orders: 0 };
    hit.rows += 1;
    hit.orders += Number(row.orders) || 0;
    map.set(key, hit);
  }
  return map;
}

function evidenceFor(map, word) {
  const hit = map && map.get ? map.get(canonWord(word)) : null;
  return { rows: hit ? hit.rows : 0, orders: hit ? hit.orders : 0 };
}

function evidenceLabel(rows, orders) {
  if (!rows) return '未出现';
  return `${rows} 条${orders ? ' / 订单 ' + orders : ''}`;
}

/* Order suggestions by how much evidence our own report gives them:
   rows with orders first, then rows with appearances, then unevidenced ones.
   Stable for equal scores (keeps the model's original order). */
function sortByEvidence(items) {
  const list = Array.isArray(items) ? items.slice() : [];
  return list
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const oa = Number(a.item && a.item.reportOrders) || 0;
      const ob = Number(b.item && b.item.reportOrders) || 0;
      if (ob !== oa) return ob - oa;
      const ra = Number(a.item && a.item.reportRows) || 0;
      const rb = Number(b.item && b.item.reportRows) || 0;
      if (rb !== ra) return rb - ra;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

/* One rule for the actionable advice label, shared by both front ends:
   orders > 0 → 优先新增；仅在报表出现 → 先观察；没有任何报表证据 → 待验证。 */
function adviceFor(rows, orders) {
  const o = Number(orders) || 0;
  const r = Number(rows) || 0;
  if (o > 0) return '优先新增';
  if (r > 0) return '先观察';
  return '待验证';
}

/* Cross-check a model-suggested negative against our own rule data.
   Order matters: a term that overlaps a good search term must be flagged as a
   conflict even if it also looks wasteful, because deleting it could cut real traffic. */
function negativeCross(word, options) {
  const opts = options || {};
  const canonOf = typeof canonWord === 'function' ? canonWord : (v) => String(v || '').toLowerCase();
  const key = canonOf(word);
  const good = opts.good || new Set();
  const waste = opts.waste || new Set();
  const loss = opts.loss || new Set();
  const containedInGood = (() => {
    if (key.length < 4) return false;
    for (const term of good) {
      if (term.length < 4 || term === key) continue;
      if (term.includes(key) || key.includes(term)) return true;
    }
    return false;
  })();
  if (good.has(key) || containedInGood) return '⚠ 与优质数据冲突，不建议否定';
  if (waste.has(key) || loss.has(key)) return '与规则一致（高置信）';
  if (opts.brandHit) return '竞品品牌，可作为否定候选，仍需确认不会误伤自有词';
  return '仅 AI 建议，需人工复核';
}

/* Character-level pre-check before a term goes anywhere near an Amazon Ads upload.
   Amazon Ads official rule for SP manual keywords: letters, numbers, or spaces only
   (? / " & \ are the documented examples of disallowed characters). Anything else is
   flagged. Advisory only: returns human-readable issues, never blocks. */
function charIssues(word) {
  const value = String(word == null ? '' : word);
  const issues = [];
  if (/[^\x00-\x7F]/.test(value)) issues.push('含非英文字符');
  if (/[^A-Za-z0-9 ]/.test(value)) issues.push('含官方外字符');
  if (value !== value.trim() || /\s{2,}/.test(value)) issues.push('含多余空格');
  return issues;
}

/* Cleaning suggestion: drop every character outside letters/digits/spaces, then
   collapse whitespace. An empty result means the term needs a manual rewrite. */
function cleanWord(word) {
  return String(word == null ? '' : word)
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Suggest a target campaign/ad group for a suggested keyword, using our own report:
   among report rows that share a word-root with the keyword (either is a substring of
   the other), pick the one with the most orders. Returns '' when nothing qualifies. */
function suggestPlacement(word, stRows) {
  const canonOf = typeof canonWord === 'function' ? canonWord : (v) => String(v || '').toLowerCase();
  const key = canonOf(word);
  if (!key || key.length < 4 || !Array.isArray(stRows)) return { camp: '', adg: '', via: '' };
  let best = null;
  for (const row of stRows) {
    const term = canonOf(row && row.st);
    if (!term || term.length < 4) continue;
    if (!term.includes(key) && !key.includes(term)) continue;
    const orders = Number(row.orders) || 0;
    if (orders <= 0) continue;
    if (!best || orders > best.orders) {
      best = { camp: String(row.camp || ''), adg: String(row.adg || ''), orders };
    }
  }
  if (!best) return { camp: '', adg: '', via: '' };
  return { camp: best.camp, adg: best.adg, via: '按词根匹配 ' + best.camp + ' / ' + best.adg + '，需人工确认' };
}

/* Fail-visibly check: verify every shared rule function this page relies on exists.
   Missing ones mean an old/partial deploy — degrade loudly instead of silently. */
function checkSharedDeps(hostId) {
  try {
    const required = ['brandHit', 'buildReportEvidence', 'evidenceFor', 'evidenceLabel', 'adviceFor', 'sortByEvidence', 'charIssues', 'negativeCross', 'suggestPlacement'];
    const missing = required.filter((name) => typeof window[name] !== 'function');
    if (!missing.length) return [];
    const host = hostId ? document.getElementById(hostId) : document.body;
    if (host) {
      const bar = document.createElement('div');
      bar.className = 'status err';
      bar.setAttribute('role', 'alert');
      bar.textContent = '⚠ 共享规则脚本缺失：' + missing.join('、') + '。业务规则已退回本地旧逻辑，请刷新页面或检查部署。';
      host.insertBefore(bar, host.firstChild);
    }
    return missing;
  } catch (error) {
    return ['check-failed'];
  }
}

/* Manual dedup (mirrors YICOPY's 自竞争检索): given already-running keywords and
   planned ones, flag conflicts by Amazon match-type semantics and return the clean set.
   Priority: exact > phrase > broad. Local string rules only — no lemmatization. */
function dedupKeywords(existing, planned) {
  const canonOf = typeof canonWord === 'function' ? canonWord : (v) => String(v || '').toLowerCase();
  const wordsOf = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const uniq = (list) => {
    const seen = new Set();
    return (list || []).map((w) => String(w == null ? '' : w).trim()).filter((w) => {
      const key = canonOf(w);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const ex = uniq(existing);
  const pl = uniq(planned);
  const conflicts = [];
  const clean = [];
  for (const p of pl) {
    const pk = canonOf(p);
    const pb = wordsOf(p);
    let worst = null;
    for (const e of ex) {
      const ek = canonOf(e);
      if (!ek) continue;
      let level = null;
      if (pk === ek) level = 'exact';
      else if (pk.includes(ek) || ek.includes(pk)) level = 'phrase';
      else {
        const eb = wordsOf(e);
        if (eb.length && eb.every((w) => pb.includes(w))) level = 'broad';
      }
      if (level && (!worst || rank(level) < rank(worst.level))) {
        worst = { planned: p, existing: e, level };
      }
      if (worst && worst.level === 'exact') break;
    }
    if (worst) conflicts.push(worst);
    else clean.push(p);
  }
  function rank(level) { return level === 'exact' ? 0 : level === 'phrase' ? 1 : 2; }
  conflicts.sort((a, b) => rank(a.level) - rank(b.level) || a.planned.localeCompare(b.planned));
  return { conflicts, clean };
}

window.buildReportEvidence = buildReportEvidence;
window.evidenceFor = evidenceFor;
window.evidenceLabel = evidenceLabel;
window.sortByEvidence = sortByEvidence;
window.adviceFor = adviceFor;
window.negativeCross = negativeCross;
window.charIssues = charIssues;
window.cleanWord = cleanWord;
window.dedupKeywords = dedupKeywords;
window.suggestPlacement = suggestPlacement;
window.checkSharedDeps = checkSharedDeps;
if (typeof module !== 'undefined') module.exports = { buildReportEvidence, evidenceFor, evidenceLabel, sortByEvidence, adviceFor, negativeCross, charIssues, cleanWord, dedupKeywords, suggestPlacement, checkSharedDeps, canonWord };
