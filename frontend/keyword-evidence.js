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

window.buildReportEvidence = buildReportEvidence;
window.evidenceFor = evidenceFor;
window.evidenceLabel = evidenceLabel;
window.sortByEvidence = sortByEvidence;
if (typeof module !== 'undefined') module.exports = { buildReportEvidence, evidenceFor, evidenceLabel, sortByEvidence, canonWord };
