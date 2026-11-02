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
  const text = String(line || '');
  // Amazon bulk downloads are often tab-separated; choose the delimiter that actually appears more.
  const tabs = (text.match(/\t/g) || []).length;
  const commas = (text.match(/,/g) || []).length;
  const delimiter = tabs > commas ? '\t' : ',';
  return text.split(delimiter).map((cell) => normalizeHeader(cell.replace(/^"|"$/g, '')));
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

const BULK_REQUIRED = {
  entity: ['entity', '实体'],
  campaign: ['campaign', 'campaign name', '广告活动', '广告活动名称'],
  ad_group: ['ad group', 'ad group name', '广告组', '广告组名称'],
  keyword: ['keyword', 'keyword text', '关键词', 'targeting', '投放词'],
  match_type: ['match type', '匹配类型', '匹配方式'],
};

const BULK_ADVISORY = {
  campaign_id: ['campaign id', '广告活动id'],
  ad_group_id: ['ad group id', '广告组id'],
  keyword_id: ['keyword id', '关键词id'],
  bid: ['bid', 'keyword bid', '出价', '关键词出价'],
};

const PRODUCTS_REQUIRED = {
  asin: ['asin', 'advertised asin', '广告商品asin', '推广的asin', '推广的商品asin'],
  campaign: ['campaign', 'campaign name', '广告活动', '广告活动名称'],
  ad_group: ['ad group', 'ad group name', '广告组', '广告组名称'],
};

const PLACEMENTS_REQUIRED = {
  placement: ['placement', '广告位', '投放位置'],
  campaign: ['campaign', 'campaign name', '广告活动', '广告活动名称'],
};

function missingSimpleColumns(headerLine, map) {
  const cells = splitHeaderLine(headerLine);
  if (!cells.some(Boolean)) return Object.keys(map);
  return Object.keys(map).filter((key) => {
    const aliases = map[key].map(normalizeHeader);
    return !cells.some((cell) => aliases.includes(cell));
  });
}

function optionalReportCheckText(missing, label) {
  if (!Array.isArray(missing)) return '';
  if (!missing.length) return `${label}预检通过：必需列都已找到。最终仍以服务端校验为准。`;
  return `${label}预检：缺少必需列（${missing.join('、')}）。缺少时这份报告不会被采用；它是可选的，不上传也能生成方案。最终以服务端校验为准。`;
}

function missingBulkColumns(headerLine) {
  const cells = splitHeaderLine(headerLine);
  const find = (map) => Object.keys(map).filter((key) => {
    const aliases = map[key].map(normalizeHeader);
    return !cells.some((cell) => aliases.includes(cell));
  });
  if (!cells.some(Boolean)) return { required: Object.keys(BULK_REQUIRED), advisory: Object.keys(BULK_ADVISORY) };
  return { required: find(BULK_REQUIRED), advisory: find(BULK_ADVISORY) };
}

function bulkCheckText(result) {
  if (!result) return '';
  if (result.required.length) {
    return `批量报告预检：缺少必需列（${result.required.join('、')}）。没有 Entity 或名称列时，这份文件不会被采用。最终以服务端校验为准。`;
  }
  if (result.advisory.length) {
    return `批量报告预检：缺少 ${result.advisory.join('、')}。动作仍会生成，但缺少实体 ID 或真实出价时不能导出草稿。最终以服务端校验为准。`;
  }
  return '批量报告预检通过：实体、名称、ID 与出价列都已找到。最终仍以服务端校验为准。';
}

function headerCheckText(missing) {
  if (!Array.isArray(missing)) return '';
  if (!missing.length) return '表头预检通过：必需列都已找到。最终仍以服务端校验为准。';
  return `表头预检：可能缺少 ${missing.length} 个必需列（${missing.join('、')}）。请对照上方帮助核对列名；这是基于已知表头别名的预检，最终以服务端校验为准。`;
}

window.missingSearchColumns = missingSearchColumns;
window.headerCheckText = headerCheckText;
window.missingBulkColumns = missingBulkColumns;
window.bulkCheckText = bulkCheckText;
window.missingSimpleColumns = missingSimpleColumns;
window.optionalReportCheckText = optionalReportCheckText;
window.PRODUCTS_REQUIRED = PRODUCTS_REQUIRED;
window.PLACEMENTS_REQUIRED = PLACEMENTS_REQUIRED;
if (typeof module !== 'undefined') module.exports = { missingSearchColumns, headerCheckText, missingBulkColumns, bulkCheckText, missingSimpleColumns, optionalReportCheckText, PRODUCTS_REQUIRED, PLACEMENTS_REQUIRED, REQUIRED };
