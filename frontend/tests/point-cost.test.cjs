'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../point-cost.js'), 'utf8');
function load() {
  const context = vm.createContext({ window: {}, module: { exports: {} } });
  vm.runInContext(source, context);
  return context.window.actionCostText;
}
const costs = { workflow_plan: 5, export_draft: 2, demo_plan: 1 };

test('action cost shows consumption and remaining balance', () => {
  const actionCostText = load();
  const text = actionCostText(costs, 'workflow_plan', 100);
  assert.match(text, /本次消耗 5 积分/);
  assert.match(text, /当前 100 积分/);
  assert.match(text, /执行后剩余 95/);
});

test('action cost warns when balance is insufficient', () => {
  const actionCostText = load();
  const text = actionCostText(costs, 'workflow_plan', 3);
  assert.match(text, /不足以执行/);
  assert.doesNotMatch(text, /执行后剩余/);
});

test('unknown balance still shows the cost', () => {
  const actionCostText = load();
  assert.match(actionCostText(costs, 'export_draft', null), /本次消耗 2 积分/);
});

test('unknown cost is not invented', () => {
  const actionCostText = load();
  assert.equal(actionCostText({}, 'workflow_plan', 100), '');
});
