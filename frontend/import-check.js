'use strict';
/* Pre-upload header check. Advisory only: the server remains authoritative. */

const REQUIRED = {
  search_term: ['customer search term', 'search term', '搜索词', '客户搜索词'],
  campaign: ['campaign', 'campaign name', '广告活动', '广告活动名称'],
  ad_group: ['ad group', 'ad group name', '广告组', '广告组名称'],
  keyword: ['keyword', 'keyword text', '关键词', 'targeting', '投放词'],
  match_type: ['match type', '匹配类型', '匹配方式'],
  spend: ['spend', 'cost', '花费', '总花费'],
  sales: ['sales', '7 day total sales', '14 day total sales', '销售额', '7天总销售额', '七天总销售额'],
  orders: ['orders', '7 day total orders (#)', '7 day total orders', '14 day total orders', '订单', '订单数', '七天总订单数（#）', '七天总订单数'],
  clicks: ['clicks', '点击量', '点击次数', '点击'],
};

function normalizeHeader(value) {
  return String(value == null ? '' : value)
    .replace(/^﻿/, '')
    .toLowerCase()
    .replace(/[\s_]+/g, ' ')
    .replace(/[()（）#]/g, '')
    .trim();
}

function splitHeaderLine(line) {
  return String(line || '').split(',').map((cell) => normalizeHeader(cell.replace(/^"|"$/g, '')));
}

function missingSearchColumns(headerLine) {
  const cells = splitHeaderLine(headerLine);
  if (!cells.some(Boolean)) return Object.keys(REQUIRED);
  const missing = [];
  Object.keys(REQUIRED).forEach((key) => {
    const aliases = REQUIRED[key].map(normalizeHeader);
    if (!cells.some((cell) => aliases.includes(cell))) missing.push(key);
  });
  return missing;
}

function headerCheckText(missing) {
  if (!Array.isArray(missing)) return '';
  if (!missing.length) return '表头预检通过：必需列都已找到。最终仍以服务端校验为准。';
  return `表头预检：可能缺少 ${missing.length} 个必需列（${missing.join('、')}）。请对照上方帮助核对列名；这是基于已知表头别名的预检，最终以服务端校验为准。`;
}

window.missingSearchColumns = missingSearchColumns;
window.headerCheckText = headerCheckText;
if (typeof module !== 'undefined') module.exports = { missingSearchColumns, headerCheckText, REQUIRED };
