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

window.buildReportEvidence = buildReportEvidence;
window.evidenceFor = evidenceFor;
window.evidenceLabel = evidenceLabel;
if (typeof module !== 'undefined') module.exports = { buildReportEvidence, evidenceFor, evidenceLabel, canonWord };
