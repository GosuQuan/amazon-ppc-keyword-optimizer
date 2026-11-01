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

window.metricsReading = metricsReading;
if (typeof module !== 'undefined') module.exports = { metricsReading };
