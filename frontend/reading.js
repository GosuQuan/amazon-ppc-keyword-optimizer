'use strict';
/* Describe what the observed metrics mean. Descriptive only: no causal or savings claims. */
/* Placement-level reading (mirrors YICOPY's per-position semantics guide).
   Descriptive only: Top of Search carries the strongest intent, Rest of Search is
   the volume band, Product Pages convert differently. Never causal, never savings. */
function placementReading(rows) {
  const agg = new Map();
  for (const r of (rows || [])) {
    const key = String(r && r.placement || '').trim();
    if (!key) continue;
    const g = agg.get(key) || { clicks: 0, spend: 0, sales: 0, orders: 0 };
    g.clicks += Number(r.clicks) || 0;
    g.spend += Number(r.spend) || 0;
    g.sales += Number(r.sales) || 0;
    g.orders += Number(r.orders) || 0;
    agg.set(key, g);
  }
  if (!agg.size) return null;
  const get = (needle) => [...agg.keys()].find((k) => k.toLowerCase().includes(needle));
  const parts = [];
  const pick = (needle) => {
    const key = get(needle);
    return key ? { name: key, ...agg.get(key) } : null;
  };
  const top = pick('top of search');
  if (top) {
    parts.push(top.orders > 0
      ? `搜索顶部（${top.name}）有 ${top.orders} 单、花费 ${Number(top.spend).toFixed(2)}——流量与意图最高的位置，值得保持出价竞争力`
      : `搜索顶部（${top.name}）有 ${Number(top.spend).toFixed(2)} 花费但 0 订单——该位置意图高却未转化，需人工核对 listing 与价格竞争力`);
  }
  const rest = pick('rest of search');
  if (rest && rest.spend > 0) {
    parts.push(rest.orders > 0
      ? `其余搜索位置（${rest.name}）花费 ${Number(rest.spend).toFixed(2)}、${rest.orders} 单`
      : `其余搜索位置（${rest.name}）花费 ${Number(rest.spend).toFixed(2)} 但 0 订单，是止损优先核查区`);
  }
  const product = pick('product');
  if (product && product.spend > 0) {
    const acos = product.sales > 0 ? (product.spend / product.sales * 100).toFixed(1) + '%' : '无销售';
    parts.push(`商品页面（${product.name}）花费 ${Number(product.spend).toFixed(2)}、ACOS ${acos}——该位置流量大但转化口径不同，高 ACOS 未必等于无效，建议单独评估`);
  }
  if (!parts.length) return null;
  return parts.join('；') + '。以上是对已发生数据的分层描述，不构成因果判断或节省承诺。';
}
/* Match-type reading (mirrors YICOPY's ad-map layer 2): which match type eats the
   budget and whether its ACOS drifts above the account average. Descriptive only. */
function mtReading(rows) {
  const agg = new Map();
  let totalSpend = 0, totalSales = 0;
  for (const r of (rows || [])) {
    const key = String(r && r.mt || '').trim();
    if (!key) continue;
    const g = agg.get(key) || { spend: 0, sales: 0, orders: 0 };
    g.spend += Number(r.spend) || 0;
    g.sales += Number(r.sales) || 0;
    g.orders += Number(r.orders) || 0;
    agg.set(key, g);
    totalSpend += Number(r.spend) || 0;
    totalSales += Number(r.sales) || 0;
  }
  if (!agg.size || totalSpend <= 0) return null;
  const accountAcos = totalSales > 0 ? totalSpend / totalSales : null;
  const parts = [];
  const label = (key) => ({ exact: '精准', phrase: '词组', broad: '广泛', auto: '自动' }[key.toLowerCase()] || key);
  const sorted = [...agg.entries()].sort((a, b) => b[1].spend - a[1].spend);
  for (const [key, g] of sorted) {
    const share = (g.spend / totalSpend * 100).toFixed(1);
    const acos = g.sales > 0 ? (g.spend / g.sales * 100).toFixed(1) + '%' : '无销售';
    const drift = accountAcos && g.sales > 0 && (g.spend / g.sales) > accountAcos * 1.1 ? '，ACOS 高于整体均值' : '';
    parts.push(`${label(key)}匹配占花费 ${share}%（ACOS ${acos}${drift}）`);
  }
  if (accountAcos) parts.push(`整体 ACOS ${(accountAcos * 100).toFixed(1)}%`);
  return parts.join('；') + '。以上为花费结构描述，不构成调整承诺；广泛匹配还有语义扩展，实际触发面更大。';
}
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

/* Describe what the saved plans mean and what to do next. Descriptive only. */
function planListConclusion(plans) {
  const list = Array.isArray(plans) ? plans : [];
  if (!list.length) return '还没有方案。可以从上方「开始新方案」或「载入示例」开始。';
  let exportable = 0;
  let pending = 0;
  list.forEach((plan) => {
    if (plan && plan.export_ready) exportable += 1;
    else pending += 1;
  });
  const guidance = pending > 0
    ? `建议先处理最近的待审核方案，逐项批准后再导出`
    : `所有方案都已可导出，进入工作台下载草稿、核对列名与实体 ID 后再执行`;
  return `共 ${list.length} 个方案：可导出 ${exportable} 个、待审核 ${pending} 个。${guidance}。列表中的可核对花费是已经发生的搜索词花费，不是已节省广告费。`;
}

window.metricsReading = metricsReading;
window.placementReading = placementReading;
window.mtReading = mtReading;
window.reviewConclusion = reviewConclusion;
window.planListConclusion = planListConclusion;
if (typeof module !== 'undefined') module.exports = { metricsReading, reviewConclusion, planListConclusion };
