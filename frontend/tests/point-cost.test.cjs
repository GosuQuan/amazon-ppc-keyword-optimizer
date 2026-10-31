'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
global.window = {};
const { pointCostText, pointBalancePreview, canAfford } = require('../point-cost.js');

test('point hint uses the published service costs', () => {
  const text = pointCostText({ serviceCosts: { workflow_plan: 5, demo_plan: 1, export_draft: 2 }, modelCosts: { individual: { flash: 10 } } });
  assert.match(text, /生成方案 5 积分/);
  assert.match(text, /示例方案 1 积分/);
  assert.match(text, /首次导出 2 积分/);
  assert.match(text, /Flash 模型每次 10 积分/);
  assert.match(text, /不是人民币/);
});

test('balance preview refuses an unaffordable plan without inventing numbers', () => {
  const pricing = { serviceCosts: { workflow_plan: 5 } };
  assert.equal(pointBalancePreview(pricing, 4), '当前 4 积分，不足以生成方案（需要 5）。');
  assert.equal(pointBalancePreview(pricing, 5), '当前 5 积分，生成方案后剩余 0。积分不是人民币。');
  assert.equal(pointBalancePreview(pricing, 1.5), '当前积分暂时无法读取。');
});

test('unknown balance does not block an action', () => {
  assert.equal(canAfford(4, { workflow_plan: 5, demo_plan: 1, export_draft: 2 }, 'workflow_plan'), false);
  assert.equal(canAfford(5, { workflow_plan: 5 }, 'workflow_plan'), true);
  assert.equal(canAfford(null, { demo_plan: 1 }, 'demo_plan'), null);
  assert.equal(canAfford(3, {}, 'export_draft'), null);
});

test('incomplete pricing does not invent a cost', () => {
  assert.equal(pointCostText({}), '积分规则暂时无法读取。');
  assert.equal(pointCostText({ serviceCosts: { workflow_plan: 5.5, demo_plan: 1, export_draft: 2 }, modelCosts: { individual: { flash: 10 } } }), '积分规则暂时无法读取。');
});
