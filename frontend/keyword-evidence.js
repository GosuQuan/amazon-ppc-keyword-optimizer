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

window.buildReportEvidence = buildReportEvidence;
window.evidenceFor = evidenceFor;
window.evidenceLabel = evidenceLabel;
window.sortByEvidence = sortByEvidence;
window.adviceFor = adviceFor;
window.negativeCross = negativeCross;
if (typeof module !== 'undefined') module.exports = { buildReportEvidence, evidenceFor, evidenceLabel, sortByEvidence, adviceFor, negativeCross, canonWord };
