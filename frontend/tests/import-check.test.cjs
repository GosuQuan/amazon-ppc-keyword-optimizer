'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../import-check.js'), 'utf8');
function load() {
  const context = vm.createContext({ window: {}, module: { exports: {} } });
  vm.runInContext(source, context);
  return context.window;
}

const FULL = 'Date,Campaign,Ad Group,Keyword,Match Type,Customer Search Term,Clicks,Spend,Sales,Orders';

test('complete english header passes the pre-check', () => {
  const { missingSearchColumns } = load();
  assert.equal(JSON.stringify(missingSearchColumns(FULL)), '[]');
});

test('chinese header aliases are accepted', () => {
  const { missingSearchColumns } = load();
  const header = '日期,广告活动,广告组,关键词,匹配类型,客户搜索词,点击,花费,销售额,订单';
  assert.equal(JSON.stringify(missingSearchColumns(header)), '[]');
});

test('missing columns are reported', () => {
  const { missingSearchColumns } = load();
  const missing = missingSearchColumns('Campaign,Ad Group,Keyword,Spend');
  assert.ok(missing.includes('search_term'));
  assert.ok(missing.includes('clicks'));
  assert.ok(missing.includes('orders'));
});

test('bom spaces and case are tolerated', () => {
  const { missingSearchColumns } = load();
  assert.equal(JSON.stringify(missingSearchColumns('﻿  ' + FULL.replace(/, /g, ','))), '[]');
  assert.equal(JSON.stringify(missingSearchColumns(FULL.toUpperCase())), '[]');
});

test('empty header reports everything as missing rather than passing', () => {
  const { missingSearchColumns } = load();
  assert.equal(missingSearchColumns('').length, 9);
  assert.equal(missingSearchColumns(null).length, 9);
});

test('bulk without entity is rejected outright', () => {
  const { missingBulkColumns, bulkCheckText } = load();
  const result = missingBulkColumns('Campaign,Ad Group,Keyword,Match Type,Bid');
  assert.ok(result.required.includes('entity'));
  assert.match(bulkCheckText(result), /不会被采用/);
});

test('bulk missing ids still works but warns about export', () => {
  const { missingBulkColumns, bulkCheckText } = load();
  const result = missingBulkColumns('Entity,Campaign,Ad Group,Keyword,Match Type');
  assert.equal(result.required.length, 0);
  assert.ok(result.advisory.includes('campaign_id'));
  assert.match(bulkCheckText(result), /不能导出草稿/);
});

test('complete bulk header passes with no advisory', () => {
  const { missingBulkColumns, bulkCheckText } = load();
  const header = 'Entity,Campaign,Ad Group,Keyword,Match Type,Bid,Campaign ID,Ad Group ID,Keyword ID';
  const result = missingBulkColumns(header);
  assert.equal(JSON.stringify(result), JSON.stringify({ required: [], advisory: [] }));
  assert.match(bulkCheckText(result), /预检通过/);
});

test('empty bulk header reports everything rather than passing', () => {
  const { missingBulkColumns } = load();
  assert.equal(missingBulkColumns('').required.length, 5);
  assert.equal(missingBulkColumns('').advisory.length, 4);
});

test('pre-check never presents itself as authoritative', () => {
  const { headerCheckText } = load();
  assert.match(headerCheckText([]), /以服务端校验为准/);
  assert.match(headerCheckText(['clicks']), /以服务端校验为准/);
  assert.match(headerCheckText(['clicks']), /可能缺少/);
});
