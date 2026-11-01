'use strict';
/* Describe what the observed metrics mean. Descriptive only: no causal or savings claims. */
function metricsReading(metrics, targetAcos, currency) {
  const m = metrics || {};
  const num = (value, digits) => (typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : null);
  if (num(m.spend, 2) === null || num(m.sales, 2) === null) return '本次没有可用于解读的已发生指标。';
  const unit = currency ? ' ' + currency : '';
  const parts = [];
  const acos = num(m.acos, 1);
  const target = num(targetAcos, 1);
  if (acos !== null && target !== null) {
    parts.push(Number(m.acos) > Number(targetAcos)
      ? `当前 ACOS ${acos}% 高于目标 ${target}%，动作以止损与降价为主`
      : `当前 ACOS ${acos}% 未高于目标 ${target}%`);
  }
  if (m.orders === 0 && m.spend > 0) {
    parts.push(`有 ${num(m.spend, 2)}${unit} 花费但 0 订单，相关搜索词已列入否定与观察候选`);
  } else if (typeof m.orders === 'number' && m.orders > 0) {
    parts.push(`已发生 ${m.orders} 个订单，出单词的收割候选已在动作清单中`);
  }
  if (!parts.length) parts.push(`花费 ${num(m.spend, 2)}${unit}，销售额 ${num(m.sales, 2)}${unit}，请结合下方动作逐项核对`);
  return parts.join('；') + '。以上只是对已发生数据的描述性解读，不构成因果判断，也不代表已节省广告费。';
}

/* Describe what a period-over-period review shows. Descriptive only: never causal, never savings. */
function reviewConclusion(review) {
  if (!review || !review.before || !review.after) return '还没有可解读的周期复盘结果。';
  const num = (value, digits) => (typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : null);
  const before = review.before;
  const after = review.after;
  const parts = [];
  if (num(before.spend, 2) !== null && num(after.spend, 2) !== null) {
    const diff = after.spend - before.spend;
    parts.push(`花费由 ${before.spend.toFixed(2)} 变为 ${after.spend.toFixed(2)}（${diff >= 0 ? '增加' : '减少'} ${Math.abs(diff).toFixed(2)}）`);
  }
  if (num(before.acos, 1) !== null && num(after.acos, 1) !== null) {
    const down = after.acos < before.acos;
    parts.push(`ACOS 由 ${before.acos.toFixed(1)}% 变为 ${after.acos.toFixed(1)}%（${down ? '下降' : '上升'} ${Math.abs(after.acos - before.acos).toFixed(1)} 个百分点）`);
  }
  if (typeof before.orders === 'number' && typeof after.orders === 'number') {
    parts.push(`订单由 ${before.orders} 变为 ${after.orders}`);
  }
  const comparison = review.comparison || {};
  const baselineDays = comparison.baseline_days;
  const reviewDays = comparison.declared_review_days;
  const lengths = [];
  if (typeof baselineDays === 'number') lengths.push(`基线 ${baselineDays} 天`);
  if (typeof reviewDays === 'number') lengths.push(`复盘 ${reviewDays} 天`);
  const lengthNote = lengths.length === 2 && baselineDays !== reviewDays
    ? `两个周期长度不同（${lengths.join('、')}），总量对比受周期长度影响。`
    : lengths.length ? `对比周期：${lengths.join('、')}。` : '';
  const body = parts.length ? parts.join('；') + '。' : '本次复盘没有可比较的数值指标。';
  return body + lengthNote + '这是前后两个周期的描述性对比，受季节、流量、归因延迟与周期长度影响，不能证明调整造成了结果，也不构成已节省的广告费。';
}

window.metricsReading = metricsReading;
window.reviewConclusion = reviewConclusion;
if (typeof module !== 'undefined') module.exports = { metricsReading, reviewConclusion };
