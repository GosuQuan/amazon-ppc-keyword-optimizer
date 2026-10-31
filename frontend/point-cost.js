'use strict';
function pointCostText(pricing, plan) {
  const tier = plan === 'enterprise' ? 'enterprise' : 'individual';
  const label = tier === 'enterprise' ? '企业' : '个人';
  const costs = pricing && pricing.serviceCosts || {};
  const model = pricing && pricing.modelCosts && pricing.modelCosts[tier] || {};
  const values = [costs.workflow_plan, costs.demo_plan, costs.export_draft, model.flash];
  if (values.some((value) => !Number.isInteger(value))) return '积分规则暂时无法读取。';
  return `生成方案 ${costs.workflow_plan} 积分，示例方案 ${costs.demo_plan} 积分，首次导出 ${costs.export_draft} 积分。${label} Flash 模型每次 ${model.flash} 积分。积分不是人民币；方案生成失败会退回积分。`;
}
function pointBalancePreview(pricing, balance) {
  const cost = pricing && pricing.serviceCosts && pricing.serviceCosts.workflow_plan;
  if (!Number.isInteger(cost) || !Number.isInteger(balance)) return '当前积分暂时无法读取。';
  if (balance < cost) return `当前 ${balance} 积分，不足以生成方案（需要 ${cost}）。`;
  return `当前 ${balance} 积分，生成方案后剩余 ${balance - cost}。积分不是人民币。`;
}
function rechargeNotice(billing) {
  if (!billing || typeof billing.demoRecharge !== 'boolean') return '充值状态暂时无法读取。';
  if (billing.demoRecharge) return '当前是演示充值，不会产生真实扣款。同一档位只能入账一次。';
  return '正式支付尚未接入，现在不能入账。';
}
function canAfford(balance, costs, action) {
  const cost = costs && costs[action];
  if (!Number.isInteger(balance) || !Number.isInteger(cost)) return null;
  return balance >= cost;
}
window.pointCostText = pointCostText;
window.canAfford = canAfford;
window.pointBalancePreview = pointBalancePreview;
window.rechargeNotice = rechargeNotice;
if (typeof module !== 'undefined') module.exports = { pointCostText, pointBalancePreview, canAfford, rechargeNotice };
