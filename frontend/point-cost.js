'use strict';
function pointCostText(pricing) {
  const costs = pricing && pricing.serviceCosts || {};
  const model = pricing && pricing.modelCosts && pricing.modelCosts.individual || {};
  const values = [costs.workflow_plan, costs.demo_plan, costs.export_draft, model.flash];
  if (values.some((value) => !Number.isInteger(value))) return '积分规则暂时无法读取。';
  return `生成方案 ${costs.workflow_plan} 积分，示例方案 ${costs.demo_plan} 积分，首次导出 ${costs.export_draft} 积分。个人 Flash 模型每次 ${model.flash} 积分。积分不是人民币；方案生成失败会退回积分。`;
}
window.pointCostText = pointCostText;
if (typeof module !== 'undefined') module.exports = { pointCostText };
