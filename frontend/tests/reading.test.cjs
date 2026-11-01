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

test('reading never claims savings or causality', () => {
  const { metricsReading } = load();
  const text = metricsReading({ spend: 100, sales: 500, orders: 10, acos: 20 }, 25, 'USD');
  assert.match(text, /不构成因果判断/);
  assert.match(text, /不代表已节省广告费/);
  assert.doesNotMatch(text, /已节省 \d|节省 \d|预计|预测/);
});
