'use strict';
/* Aggregate candidate actions into a conclusion summary. Rules only; no effect claims. */
function actionConclusion(actions) {
  const list = Array.isArray(actions) ? actions : [];
  const byKind = { bid: 0, pause: 0, negative: 0, harvest: 0 };
  const reasonCounts = new Map();
  let blocked = 0, exportable = 0, approved = 0;
  list.forEach((action) => {
    if (byKind[action.kind] !== undefined) byKind[action.kind] += 1;
    const blockers = Array.isArray(action.blocking_reasons) ? action.blocking_reasons : [];
    blockers.forEach((reason) => {
      const text = String(reason || '').trim();
      if (text) reasonCounts.set(text, (reasonCounts.get(text) || 0) + 1);
    });
    if (blockers.length) blocked += 1;
    if (action.exportable === true && blockers.length === 0) exportable += 1;
    if (action.status === 'approved') approved += 1;
  });
  const reasons = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .slice(0, 2)
    .map(([text, count]) => ({ text, count }));
  return { total: list.length, byKind, blocked, exportable, approved, reasons };
}

function conclusionText(c, labels) {
  const kindLabels = labels || { bid: '调整出价', pause: '暂停投放', negative: '添加否定词', harvest: '收割关键词' };
  if (!c || !c.total) return '本方案还没有生成候选动作。请先导入搜索词报告。';
  const parts = Object.keys(kindLabels)
    .filter((kind) => c.byKind[kind] > 0)
    .map((kind) => `${kindLabels[kind]} ${c.byKind[kind]} 个`);
  let text = `本方案共 ${c.total} 个候选动作：${parts.join('、')}。其中 ${c.blocked} 个存在阻断原因，${c.exportable} 个当前可导出，已批准 ${c.approved} 个。`;
  if (c.blocked > 0) {
    const detail = Array.isArray(c.reasons) && c.reasons.length
      ? `（主要是：${c.reasons.map((item) => `${item.text} ${item.count} 项`).join('、')}）`
      : '';
    text += `建议先核对那 ${c.blocked} 个被阻断的动作${detail}。`;
  }
  else if (c.approved < c.exportable) text += `建议逐项审核后再批准，批准后可导出 ${c.exportable} 个动作。`;
  else text += '已批准的动作可以进入导出核对。';
  text += '这些是规则基于已发生数据生成的候选，不等于广告效果，也不构成已节省金额。';
  return text;
}

window.actionConclusion = actionConclusion;
window.conclusionText = conclusionText;
if (typeof module !== 'undefined') module.exports = { actionConclusion, conclusionText };
