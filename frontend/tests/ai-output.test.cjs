'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the shipped SPA, substituting only browser/transport boundaries.
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function app() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} });
    return nodes.get(id);
  };
  const context = vm.createContext({
    document: { querySelector: node, querySelectorAll: () => [] },
    window: { addEventListener() {} }, localStorage: { getItem: () => null },
    FileReader: class { readAsText(file) { this.result = file.text; this.onload(); } },
    fetch: async () => { throw new Error('Unexpected network access'); },
  });
  vm.runInContext(source + '\nrenderAI = () => {}; switchTab = () => {}; window.testApi = { mergeAiJson, runAiOnline, importExpertJson };', context);
  const state = context.window.__app.state;
  state.result = { actions: [{ mt: 'exact', kw: 'existing' }], roots: [{ type: '亏损', tok: 'loss' }], st: [
    { st: 'good', cls: '优秀', sales: 10 }, { st: 'waste', cls: '无效' },
  ] };
  state.ai = { expansions: [{ word: 'old' }], intents: [], negatives: [], insights: [], done: true };
  return { ...context.window.testApi, state, node, context };
}
const response = (content, finish_reason = 'stop', reasoning_content = '{"expansions":[{"word":"reasoning"}]}') => ({ choices: [{ finish_reason, message: { content, reasoning_content } }] });
async function online(a, data) {
  a.context.fetch = async (url, options) => {
    assert.equal(url, '/api/ai/chat');
    assert.equal(options.method, 'POST');
    return { ok: true, json: async () => data };
  };
  await a.runAiOnline();
}

for (const [name, text] of [
  ['bare JSON', '{"expansions":[{"word":"final"}]}'],
  ['JSON fence', '```json\n{"expansions":[{"word":"final"}]}\n```'],
  ['explanatory text', '建议如下：\n{"expansions":[{"word":"final"}]}\n请复核。'],
]) test(name + ' uses final only and imports identically', async () => {
  const a = app();
  await online(a, response(text));
  assert.equal(a.state.ai.expansions[0].word, 'final');
  assert.equal(a.node('#aiStatus').className, 'status ok');
  a.importExpertJson({ text });
  assert.equal(a.state.ai.expansions[0].word, 'final');
});

for (const [name, data, error] of [
  ['reasoning only', response(null), /最终 content/],
  ['empty final', response('  '), /最终 content/],
  ['non-string final', response({ expansions: [] }), /最终 content/],
  ['non-JSON final with reasoning JSON', response('仍在思考'), /完整 JSON/],
  ['truncated syntax with reasoning JSON', response('{"expansions":['), /不完整/],
  ['missing choices', {}, /最终 content/],
  ['missing message', { choices: [{}] }, /最终 content/],
  ['length with valid JSON', response('{"expansions":[]}', 'length'), /已截断.*未合并.*token/],
  ['length without final', response(null, 'length'), /已截断.*未合并.*token/],
]) test(name + ' preserves previous result', async () => {
  const a = app(), before = a.state.ai, snapshot = JSON.stringify(before);
  await online(a, data);
  assert.strictEqual(a.state.ai, before);
  assert.equal(JSON.stringify(a.state.ai), snapshot);
  assert.equal(a.node('#aiStatus').className, 'status err');
  assert.match(a.node('#aiStatus').textContent, error);
});

test('missing finish reason and optional collections remain supported', async () => {
  const a = app();
  await online(a, { choices: [{ message: { content: '{"insights":[{"title":"标题"},{"detail":"详情"}]}' } }] });
  assert.equal(a.state.ai.done, true);
  assert.equal(a.state.ai.insights.length, 2);
  assert.equal(a.state.ai.expansions.length, 0);
  a.mergeAiJson({ intents: [{ intent: 'group', keywords: [] }], expansions: [], extra: true });
  assert.equal(a.state.ai.intents.length, 1);
  a.mergeAiJson({ expansions: [] });
  assert.equal(a.state.ai.expansions.length, 0);
});

const invalid = [
  null, [], 1, 'text', {}, { unknown: [] },
  ...['expansions', 'intents', 'negativeHints', 'insights'].flatMap(key =>
    [null, {}, 'bad', [null], [3]].map(value => ({ [key]: value }))),
  { expansions: [{ word: 'valid' }, { word: ' ' }] },
  { expansions: [{ word: 3 }] }, { expansions: [{ word: 'ok', type: {} }] },
  { expansions: [{ word: 'ok', reason: null }] },
  { negativeHints: [{ word: 'ok', reason: false }] },
  { negativeHints: [{ word: '\t' }] },
  { intents: [{ intent: ' ', keywords: [] }] },
  { intents: [{ intent: 'ok', keywords: 'bad' }] },
  { intents: [{ intent: 'ok', keywords: ['valid', {}] }] },
  { intents: [{ intent: 'ok', keywords: [' '] }] },
  { insights: [{}] }, { insights: [{ title: 3 }] },
  { insights: [{ title: ' ', detail: '\t' }] }, { insights: [{ title: 'ok', detail: [] }] },
];
invalid.forEach((data, i) => test('invalid structure #' + (i + 1) + ' is rejected atomically', () => {
  const a = app(), before = a.state.ai, snapshot = JSON.stringify(before);
  assert.throws(() => a.mergeAiJson(data), /必须|至少/);
  assert.strictEqual(a.state.ai, before);
  assert.equal(JSON.stringify(a.state.ai), snapshot);
}));

test('later invalid collection cannot partly replace earlier expansions through either entry', async () => {
  const a = app(), before = a.state.ai;
  const text = JSON.stringify({ expansions: [{ word: 'new' }], intents: [], negativeHints: [], insights: [{ detail: 7 }] });
  await online(a, response(text));
  assert.strictEqual(a.state.ai, before);
  assert.match(a.node('#aiStatus').textContent, /insights\[0\]\.detail/);
  a.importExpertJson({ text });
  assert.strictEqual(a.state.ai, before);
  assert.match(a.node('#aiStatus').textContent, /导入失败.*insights\[0\]\.detail/);
});

test('complete array JSON is not salvaged into a nested result', async () => {
  const a = app(), before = a.state.ai;
  const text = '[{"expansions":[{"word":"nested"}]}]';
  await online(a, response(text));
  assert.strictEqual(a.state.ai, before);
  a.importExpertJson({ text });
  assert.strictEqual(a.state.ai, before);
});

for (const text of ['```json\n[{"expansions":[]}]\n```', '```json\n{"expansions":[]\n```']) {
  test('fenced invalid root or syntax is rejected: ' + text, async () => {
    const a = app(), before = a.state.ai;
    await online(a, response(text));
    assert.strictEqual(a.state.ai, before);
    a.importExpertJson({ text });
    assert.strictEqual(a.state.ai, before);
    assert.equal(a.node('#aiStatus').className, 'status err');
  });
}

test('successful merge preserves duplicate and rule cross-check behavior', () => {
  const a = app();
  a.mergeAiJson({ expansions: [{ word: ' existing ', type: '', reason: '' }],
    negativeHints: ['waste', 'loss', 'good', 'unknown'].map(word => ({ word })),
    intents: [{ intent: 'purchase', keywords: ['good'] }], insights: [{ detail: 'review' }] });
  assert.equal(a.state.ai.expansions[0].exists, true);
  assert.equal(a.state.ai.expansions[0].word, 'existing');
  assert.equal(a.state.ai.expansions[0].type, 'AI');
  assert.match(a.state.ai.negatives[0].cross, /高置信/);
  assert.match(a.state.ai.negatives[1].cross, /高置信/);
  assert.match(a.state.ai.negatives[2].cross, /冲突/);
  assert.match(a.state.ai.negatives[3].cross, /人工复核/);
  assert.equal(a.state.ai.done, true);
});
