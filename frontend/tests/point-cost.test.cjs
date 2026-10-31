'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
global.window = {};
const { pointCostText } = require('../point-cost.js');

test('point hint uses the published service costs', () => {
  const text = pointCostText({ serviceCosts: { workflow_plan: 5, demo_plan: 1, export_draft: 2 }, modelCosts: { individual: { flash: 10 } } });
  assert.match(text, /生成方案 5 积分/);
  assert.match(text, /示例方案 1 积分/);
  assert.match(text, /首次导出 2 积分/);
  assert.match(text, /Flash 模型每次 10 积分/);
  assert.match(text, /不是人民币/);
});

test('incomplete pricing does not invent a cost', () => {
  assert.equal(pointCostText({}), '积分规则暂时无法读取。');
  assert.equal(pointCostText({ serviceCosts: { workflow_plan: 5.5, demo_plan: 1, export_draft: 2 }, modelCosts: { individual: { flash: 10 } } }), '积分规则暂时无法读取。');
});
