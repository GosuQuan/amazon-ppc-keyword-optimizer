'use strict';
/* Keep the import help text in sync with the columns the backend actually requires. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const service = fs.readFileSync(path.join(root, 'backend', 'app', 'workflow', 'service.py'), 'utf8');
const html = fs.readFileSync(path.join(root, 'frontend', 'workflow.html'), 'utf8');

function requiredColumns() {
  const match = service.match(/required = \{([^}]+)\}/);
  assert.ok(match, 'cannot find required column set in service.py');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function helpBlock() {
  const start = html.indexOf('id="import-help"');
  assert.ok(start > 0, 'import help block missing');
  const end = html.indexOf('</details>', start);
  return html.slice(start, end);
}

test('backend required column set is actually parsed', () => {
  const columns = requiredColumns();
  assert.ok(columns.length >= 9, 'parsed too few columns: ' + columns.length);
  assert.ok(columns.includes('search_term') && columns.includes('clicks'));
});

test('import help names every column the backend requires', () => {
  const help = helpBlock();
  const humanNames = {
    search_term: '客户搜索词', campaign: '广告活动', ad_group: '广告组', keyword: '关键词',
    match_type: '匹配类型', spend: '花费', sales: '销售额', orders: '订单', clicks: '点击',
  };
  for (const column of requiredColumns()) {
    const label = humanNames[column];
    assert.ok(label, 'no human label mapped for ' + column);
    assert.ok(help.includes(label), `help text missing required column: ${column} (${label})`);
  }
});

test('import help states the single-ASIN and period constraints', () => {
  const help = helpBlock();
  assert.match(help, /单个 ASIN/);
  assert.match(help, /30–60 天/);
});

test('import help does not claim to know the seller central menu path', () => {
  const help = helpBlock();
  assert.match(help, /以你自己账户的 Seller Central 为准|菜单位置会变化/);
  assert.doesNotMatch(help, /依次点击广告 → /);
});
