'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../reading.js'), 'utf8');
function load() {
  const context = vm.createContext({ window: {}, module: { exports: {} } });
  vm.runInContext(source, context);
  return context.window;
}

test('missing metrics are not invented', () => {
  const { metricsReading } = load();
  assert.match(metricsReading(null, 25), /没有可用于解读/);
  assert.match(metricsReading({ spend: 10 }, 25), /没有可用于解读/);
});

test('acos above target steers toward stopping loss', () => {
  const { metricsReading } = load();
  const text = metricsReading({ spend: 100, sales: 50, orders: 1, acos: 200 }, 25, 'USD');
  assert.match(text, /ACOS 200\.0% 高于目标 25\.0%/);
  assert.match(text, /止损与降价/);
});

test('acos at or below target is not called overspending', () => {
  const { metricsReading } = load();
  const text = metricsReading({ spend: 100, sales: 500, orders: 10, acos: 20 }, 25, 'USD');
  assert.match(text, /未高于目标/);
  assert.doesNotMatch(text, /止损/);
});

test('spend without orders is surfaced as negative candidates', () => {
  const { metricsReading } = load();
  const text = metricsReading({ spend: 60, sales: 0, orders: 0, acos: null }, 25, 'USD');
  assert.match(text, /0 订单/);
  assert.match(text, /否定与观察候选/);
});

test('missing review is not invented', () => {
  const { reviewConclusion } = load();
  assert.match(reviewConclusion(null), /还没有可解读/);
});

test('review describes direction without claiming savings', () => {
  const { reviewConclusion } = load();
  const text = reviewConclusion({
    before: { spend: 100, sales: 200, orders: 5, acos: 50 },
    after: { spend: 60, sales: 240, orders: 8, acos: 25 },
    comparison: { baseline_days: 10, declared_review_days: 10 },
  });
  assert.match(text, /花费由 100\.00 变为 60\.00/);
  assert.match(text, /ACOS 由 50\.0% 变为 25\.0%/);
  assert.match(text, /订单由 5 变为 8/);
  assert.match(text, /不能证明调整造成了结果/);
  assert.doesNotMatch(text, /节省 [0-9]|已节省 ?[0-9]|带来 [0-9]|提升 [0-9]/);
});

test('unequal period lengths are called out', () => {
  const { reviewConclusion } = load();
  const text = reviewConclusion({
    before: { spend: 100, sales: 200, orders: 5, acos: 50 },
    after: { spend: 60, sales: 240, orders: 8, acos: 25 },
    comparison: { baseline_days: 10, declared_review_days: 30 },
  });
  assert.match(text, /两个周期长度不同/);
  assert.match(text, /基线 10 天/);
  assert.match(text, /复盘 30 天/);
});

test('empty plan list points to the next action', () => {
  const { planListConclusion } = load();
  assert.match(planListConclusion([]), /还没有方案/);
  assert.match(planListConclusion([]), /开始新方案/);
});

test('plan list counts readiness and prioritises pending work', () => {
  const { planListConclusion } = load();
  const text = planListConclusion([
    { id: 'a', export_ready: true },
    { id: 'b', export_ready: false },
    { id: 'c', export_ready: false },
  ]);
  assert.match(text, /共 3 个方案/);
  assert.match(text, /可导出 1 个、待审核 2 个/);
  assert.match(text, /先处理最近的待审核方案/);
});

test('all exportable plans shift guidance to downloading', () => {
  const { planListConclusion } = load();
  const text = planListConclusion([{ id: 'a', export_ready: true }]);
  assert.match(text, /所有方案都已可导出/);
  assert.match(text, /核对列名与实体 ID/);
});

test('plan list never calls historical spend a saving', () => {
  const { planListConclusion } = load();
  const text = planListConclusion([{ id: 'a', export_ready: true, claimable_observed_spend: 100 }]);
  assert.match(text, /不是已节省广告费/);
  assert.doesNotMatch(text, /已节省 ?[0-9]/);
});

test('review always carries the non-causal disclaimer', () => {
  const { reviewConclusion } = load();
  const text = reviewConclusion({
    before: { spend: 100, sales: 200, orders: 5, acos: 50 },
    after: { spend: 60, sales: 240, orders: 8, acos: 25 },
  });
  assert.match(text, /不能证明调整造成了结果/);
  assert.match(text, /不构成已节省的广告费/);
});

test('reading never claims savings or causality', () => {
  const { metricsReading } = load();
  const text = metricsReading({ spend: 100, sales: 500, orders: 10, acos: 20 }, 25, 'USD');
  assert.match(text, /不构成因果判断/);
  assert.match(text, /不代表已节省广告费/);
  assert.doesNotMatch(text, /已节省 \d|节省 \d|预计|预测/);
});
