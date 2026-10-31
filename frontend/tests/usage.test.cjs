'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../usage.js'), 'utf8');
async function render(data, ok = true) {
  const nodes = new Map();
  function node() { return { textContent: '', children: [], append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; }, addEventListener() {} }; }
  const urls = [];
  const context = vm.createContext({ document: {
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); }, createElement: node,
  }, AbortController, setTimeout, clearTimeout, fetch: async url => {
    urls.push(url); return { ok, status: ok ? 200 : 503, json: async () => data };
  } });
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return { nodes, urls };
}
function text(node) { return node.textContent + node.children.map(text).join(' '); }
test('missing usage and price are unknown, request only reads ledger', async () => {
  const { nodes, urls } = await render({summary: {calls: 1, successes: 1, failures: 0, prompt_tokens: null, completion_tokens: null, total_tokens: null, usage_known_calls: 0, prompt_known_calls: 0, completion_known_calls: 0}, records: []});
  assert.deepEqual(urls, ['/api/ai/usage']);
  assert.match(text(nodes.get('usage-summary')), /未知/);
  assert.match(nodes.get('usage-status').textContent, /1 次调用未返回有效总 token/);
});
test('read error is visible and refresh becomes available', async () => {
  const { nodes } = await render({}, false);
  assert.match(nodes.get('usage-status').textContent, /读取失败.*503/);
  assert.equal(nodes.get('refresh-usage').disabled, false);
});
test('ledger text is rendered literally including hostile model names', async () => {
  const model = '<img src=x onerror=alert(1)>';
  const { nodes } = await render({summary: {calls: 1, usage_known_calls: 1}, records: [{model, total_tokens: 12, success: false}]});
  assert.match(text(nodes.get('usage-records')), /接口失败/);
  assert.match(text(nodes.get('usage-records')), /<img src=x onerror=alert\(1\)>/);
  assert.equal(nodes.get('usage-records').children[0].innerHTML, undefined);
});
